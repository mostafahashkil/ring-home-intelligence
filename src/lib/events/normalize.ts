/**
 * Event normalization: maps validated provider input into the common NormalizedEvent schema.
 *
 * Ring mapping is limited to what the Ring Partner API documents:
 *  - motion_detected sub_type: motion | human | vehicle | package_delivery | other_motion (open vocabulary;
 *    unknown values pass through as generic motion). History adds motion.animal.
 *  - button_press / history "ding" → doorbell
 *  - device_online / device_offline / device_added / device_removed → camera status
 * Ring does not identify people, describe clothing, or name delivery carriers, so real events never get
 * those details. Demo events may, and are always flagged `demo: true`.
 */
import {
  EventCategory,
  Evidence,
  Inference,
  NormalizedEvent,
  Observation,
  ProviderEventInput,
  Severity,
} from "../domain/types";
import { newId } from "../util/id";

export interface Description {
  category: EventCategory;
  summary: string;
  observations: Observation[];
  inference: Inference | null;
  severity: Severity;
  confidence: number | null;
  providerType: string | null;
}

const DEFAULT_CLIP_MS = 30_000;
const MIN_CLIP_MS = 5_000;
const MAX_CLIP_MS = 120_000;

export function describeRingEvent(input: ProviderEventInput, cameraName: string): Description {
  const sub = input.subType ?? null;
  switch (input.kind) {
    case "motion": {
      const providerType = `motion${sub ? `.${sub}` : ""}`;
      switch (sub) {
        case "human":
          return {
            category: "visitor",
            summary: `Person detected at ${cameraName} — not identified`,
            observations: [{ text: "Ring Smart Alert classified this motion as a person.", source: "provider" }],
            inference: null,
            severity: "low",
            confidence: null,
            providerType,
          };
        case "package_delivery":
          return {
            category: "package",
            summary: `Possible delivery at ${cameraName}`,
            observations: [{ text: "Ring Smart Alert reported package-delivery motion.", source: "provider" }],
            inference: {
              label: "Package activity detected; delivery company not confirmed.",
              basis: "Based only on Ring's package_delivery motion classification. No carrier is identified.",
            },
            severity: "low",
            confidence: null,
            providerType,
          };
        case "vehicle":
          return {
            category: "vehicle",
            summary: `Vehicle detected at ${cameraName}`,
            observations: [{ text: "Ring Smart Alert classified this motion as a vehicle.", source: "provider" }],
            inference: null,
            severity: "low",
            confidence: null,
            providerType,
          };
        case "animal":
          return {
            category: "motion",
            summary: `Animal motion at ${cameraName}`,
            observations: [{ text: "Ring classified this motion as an animal.", source: "provider" }],
            inference: null,
            severity: "low",
            confidence: null,
            providerType,
          };
        default:
          return {
            category: "motion",
            summary: `Motion detected at ${cameraName}`,
            observations: [
              {
                text:
                  sub && sub !== "motion" && sub !== "other_motion"
                    ? `Ring reported motion (sub-type “${sub}”).`
                    : "Ring reported motion without a more specific classification.",
                source: "provider",
              },
            ],
            inference: null,
            severity: "low",
            confidence: null,
            providerType,
          };
      }
    }
    case "doorbell":
      return {
        category: "doorbell",
        summary: `Doorbell pressed at ${cameraName}`,
        observations: [{ text: "Ring reported a doorbell button press.", source: "provider" }],
        inference: null,
        severity: "low",
        confidence: null,
        providerType: "button_press",
      };
    case "device_offline":
      return {
        category: "device",
        summary: `${cameraName} went offline`,
        observations: [{ text: "Ring reported the device offline.", source: "provider" }],
        inference: null,
        severity: "attention",
        confidence: null,
        providerType: "device_offline",
      };
    case "device_online":
      return {
        category: "device",
        summary: `${cameraName} is back online`,
        observations: [{ text: "Ring reported the device online.", source: "provider" }],
        inference: null,
        severity: "low",
        confidence: null,
        providerType: "device_online",
      };
    case "device_added":
      return {
        category: "device",
        summary: `${cameraName} was shared with this app`,
        observations: [{ text: "Ring reported a device was added to this integration.", source: "provider" }],
        inference: null,
        severity: "low",
        confidence: null,
        providerType: "device_added",
      };
    case "device_removed":
      return {
        category: "device",
        summary: `${cameraName} was removed from this app`,
        observations: [{ text: "Ring reported a device was removed from this integration.", source: "provider" }],
        inference: null,
        severity: "attention",
        confidence: null,
        providerType: "device_removed",
      };
  }
}

export function describeDemoEvent(input: ProviderEventInput, cameraName: string): Description {
  const base = describeRingEvent(input, cameraName);
  const d = input.demoDetails;
  if (!d) return base;
  return {
    category: d.category ?? base.category,
    summary: d.summary ?? base.summary,
    observations: d.observations?.length
      ? d.observations.map((text) => ({ text, source: "demo" as const }))
      : base.observations.map((o) => ({ ...o, source: "demo" as const })),
    inference: d.inference ?? base.inference,
    severity: d.severity ?? base.severity,
    confidence: d.confidence ?? null,
    providerType: base.providerType,
  };
}

/** Only motion and doorbell events have recordings behind them (per Ring docs). */
export function evidenceFor(input: ProviderEventInput): Evidence | null {
  if (input.demo) return { kind: "demo", note: "Demo event — no recording exists." };
  if (input.provider !== "ring" || (input.kind !== "motion" && input.kind !== "doorbell")) return null;
  const span = input.endTimestamp ? input.endTimestamp - input.timestamp : DEFAULT_CLIP_MS;
  return {
    kind: "ring_recording",
    deviceId: input.providerDeviceId,
    timestamp: input.timestamp,
    durationMs: Math.min(MAX_CLIP_MS, Math.max(MIN_CLIP_MS, span)),
    componentId: input.componentIds?.[0] ?? null,
  };
}

export function normalize(
  input: ProviderEventInput,
  ctx: { cameraId: string | null; cameraName: string; zone: string | null; now: number },
): NormalizedEvent {
  const d = input.demo ? describeDemoEvent(input, ctx.cameraName) : describeRingEvent(input, ctx.cameraName);
  const signals = input.demo ? (input.demoDetails?.signals ?? []) : [];
  return {
    id: newId("evt"),
    provider: input.provider,
    providerEventId: input.providerEventId,
    timestamp: input.timestamp,
    endTimestamp: input.endTimestamp ?? null,
    cameraId: ctx.cameraId,
    zoneId: ctx.zone,
    eventType: d.category,
    providerType: d.providerType,
    summary: d.summary,
    observations: d.observations,
    inference: d.inference,
    confidence: d.confidence,
    severity: d.severity,
    association: null,
    householdProfileId: null,
    evidenceReference: evidenceFor(input),
    signals,
    ruleId: null,
    decision: null,
    feedback: [],
    derivedFrom: [],
    demo: input.demo,
    createdAt: ctx.now,
  };
}
