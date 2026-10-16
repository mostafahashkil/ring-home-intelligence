/**
 * Ingest pipeline: provider input → validation → normalization → household association →
 * rules decision → storage + notification + audit → behavior detection (derived events).
 * Every provider (demo, Ring webhook, Ring history sync) goes through this one path.
 */
import { getDb } from "./db";
import {
  CATEGORY_LABELS,
  EventCategory,
  NormalizedEvent,
  ProviderEventInput,
  ProviderEventInputSchema,
} from "./domain/types";
import { detectBehavior } from "./behavior/detect";
import { normalize } from "./events/normalize";
import { applySimulatedMatch } from "./household/association";
import { composeNotification } from "./notifications/compose";
import { audit } from "./repo/audit";
import { findCameraByDevice, getCamera, listCameras, setCameraStatus, upsertCamera } from "./repo/cameras";
import {
  findByProviderEventId,
  findNearDuplicate,
  insertEvent,
  recentEventsAtCamera,
  updateEvent,
} from "./repo/events";
import { insertNotification, recentNotifications } from "./repo/notifications";
import { listProfiles } from "./repo/profiles";
import { listRules } from "./repo/rules";
import { getSettings } from "./repo/settings";
import { dedupKey, evaluate, reviewThresholdFor } from "./rules/engine";
import { newId } from "./util/id";
import { log } from "./util/log";

export type IngestResult =
  | { status: "created"; event: NormalizedEvent; derived: NormalizedEvent[] }
  | { status: "duplicate"; event: NormalizedEvent }
  | { status: "merged"; event: NormalizedEvent }
  | { status: "invalid"; error: string };

const MERGE_TOLERANCE_MS = 5_000;
/** Categories a webhook event and the matching history record could each map to. */
const MERGEABLE: Partial<Record<EventCategory, EventCategory[]>> = {
  visitor: ["visitor", "arrival", "package", "motion"],
  package: ["package", "visitor", "motion"],
  vehicle: ["vehicle", "motion"],
  motion: ["motion", "visitor", "vehicle", "package"],
  doorbell: ["doorbell"],
};

/** Events older than this when imported (e.g. from Ring history) are logged without alerting. */
export const STALE_ALERT_MS = 15 * 60_000;

export async function ingest(raw: unknown, opts: { now?: number } = {}): Promise<IngestResult> {
  const now = opts.now ?? Date.now();
  const parsed = ProviderEventInputSchema.safeParse(raw);
  if (!parsed.success) {
    log.warn("ingest.invalid", { issues: parsed.error.issues.slice(0, 3).map((i) => i.path.join(".")) });
    return { status: "invalid", error: "Event payload failed validation." };
  }
  const input = parsed.data;
  if (input.demo !== (input.provider === "demo")) return { status: "invalid", error: "Demo flag mismatch." };

  const existing = findByProviderEventId(input.provider, input.providerEventId);
  if (existing) return { status: "duplicate", event: existing };

  const camera = resolveCamera(input);
  if (input.kind === "device_offline") setCameraStatus(camera.id, "offline");
  if (input.kind === "device_online") setCameraStatus(camera.id, "online");
  if (input.kind === "device_removed") setCameraStatus(camera.id, "removed");

  let event = normalize(input, { cameraId: camera.id, cameraName: camera.name, zone: camera.zone, now });

  // Webhook + history describe the same real event with different ids: merge instead of duplicating.
  if (input.provider === "ring" && MERGEABLE[event.eventType]) {
    const near = findNearDuplicate("ring", camera.id, MERGEABLE[event.eventType]!, event.timestamp, MERGE_TOLERANCE_MS);
    if (near) {
      const merged = mergeInto(near, event);
      updateEvent(merged);
      return { status: "merged", event: merged };
    }
  }

  const settings = getSettings();
  const profiles = listProfiles();

  if (input.demo && input.demoDetails?.profileName) {
    const profile = profiles.find((p) => p.demo && p.displayName === input.demoDetails!.profileName);
    event = applySimulatedMatch(event, profile, input.demoDetails.matchConfidence ?? 0, reviewThresholdFor(profile, settings));
  }

  const stored = decideAndStore(event, now);
  const derived = await runBehavior(stored, now);
  return { status: "created", event: stored, derived };
}

function resolveCamera(input: ProviderEventInput) {
  const found = findCameraByDevice(input.provider, input.providerDeviceId);
  if (found) return found;
  return upsertCamera({
    provider: input.provider,
    providerDeviceId: input.providerDeviceId,
    name: input.provider === "ring" ? "New Ring device" : input.providerDeviceId,
    zone: null,
    status: "unknown",
    supportsClips: input.provider === "ring",
    componentIds: input.componentIds ?? [],
    demo: input.demo,
  });
}

function mergeInto(existing: NormalizedEvent, incoming: NormalizedEvent): NormalizedEvent {
  const end = incoming.endTimestamp ?? existing.endTimestamp;
  const evidence =
    existing.evidenceReference?.kind === "ring_recording" && end
      ? {
          ...existing.evidenceReference,
          durationMs: Math.min(120_000, Math.max(5_000, end - existing.timestamp)),
          componentId: existing.evidenceReference.componentId ?? (incoming.evidenceReference?.kind === "ring_recording" ? incoming.evidenceReference.componentId : null),
        }
      : existing.evidenceReference;
  return { ...existing, endTimestamp: end, evidenceReference: evidence };
}

/** Evaluate rules, then persist the event, its notification record and audit entries atomically. */
export function decideAndStore(event: NormalizedEvent, now: number): NormalizedEvent {
  const settings = getSettings();
  const profiles = listProfiles();
  const rules = listRules();
  const cameras = new Map(listCameras().map((c) => [c.id, c]));
  const lookback = Math.max(settings.dedupWindowMinutes, settings.cooldown.windowMinutes) * 60_000;
  const decision = evaluate({
    event,
    rules,
    profiles,
    settings,
    recent: recentNotifications(now - lookback),
    now,
    cameraName: (id) => cameras.get(id)?.name ?? "camera",
  });
  if (now - event.timestamp > STALE_ALERT_MS && decision.channel !== "quiet_log") {
    decision.explanation.push("Imported after the fact (older than 15 min) — logged without alerting.");
    decision.channel = "quiet_log";
  }
  const final: NormalizedEvent = { ...event, decision, ruleId: decision.ruleId };
  const profile = profiles.find((p) => p.id === final.householdProfileId);
  const cameraName = (final.cameraId && cameras.get(final.cameraId)?.name) || "Unknown camera";
  const copy = composeNotification(final, decision, profile, cameraName, settings.timezone);

  getDb().transaction(() => {
    insertEvent(final);
    if (decision.channel !== "none") {
      insertNotification({
        eventId: final.id,
        ruleId: decision.ruleId,
        channel: decision.channel,
        title: copy.title,
        body: copy.body,
        explanation: decision.explanation.join(" "),
        severity: final.severity,
        createdAt: now,
        demo: final.demo,
        dedupKey: dedupKey(final),
        cameraId: final.cameraId,
      });
    }
    if (decision.channel === "push" || decision.requiresConfirmation || decision.saveClip) {
      audit("system", "automation.triggered", final.id, {
        channel: decision.channel,
        ruleId: decision.ruleId,
        category: CATEGORY_LABELS[final.eventType],
        requiresConfirmation: decision.requiresConfirmation,
        demo: final.demo,
      });
    }
  })();
  return final;
}

async function runBehavior(event: NormalizedEvent, now: number): Promise<NormalizedEvent[]> {
  if (!event.cameraId) return [];
  const settings = getSettings();
  const since = event.timestamp - settings.behavior.repeatVisitsWindowMinutes * 60_000;
  const recent = recentEventsAtCamera(event.cameraId, since, ["visitor", "doorbell", "behavior"]);
  const cameraName = getCamera(event.cameraId)?.name ?? "camera";
  const findings = detectBehavior(event, recent, settings, cameraName);
  const out: NormalizedEvent[] = [];
  for (const f of findings) {
    const derived: NormalizedEvent = {
      ...event,
      id: newId("evt"),
      providerEventId: event.providerEventId ? `${event.providerEventId}:behavior:${f.kind}` : null,
      eventType: "behavior",
      providerType: `derived.${f.kind}`,
      summary: f.summary,
      observations: f.observations.map((text) => ({ text, source: event.demo ? ("demo" as const) : ("system" as const) })),
      inference: { label: "Pattern worth a look — not an accusation.", basis: f.basis },
      confidence: null,
      severity: f.severity,
      association: null,
      householdProfileId: null,
      signals: [f.kind],
      ruleId: null,
      decision: null,
      feedback: [],
      derivedFrom: [event.id],
      createdAt: now,
    };
    out.push(decideAndStore(derived, now));
  }
  return out;
}
