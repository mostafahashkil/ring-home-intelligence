"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { createUser, deleteUser, ForbiddenError, listUsers, Permission, revokeUserSessions } from "@/lib/auth/core";
import { requirePermission } from "@/lib/auth/session";
import { resetDemo, seedDemo } from "@/lib/bootstrap";
import {
  EVENT_CATEGORIES,
  EventCategory,
  NOTIFY_MODES,
  NotifyMode,
  RULE_ACTIONS,
  RuleAction,
  SEVERITIES,
  Severity,
  User,
} from "@/lib/domain/types";
import { clearProfileAssociations, confirmEventProfile, labelEvent, rejectEventProfile } from "@/lib/household/feedback";
import { ingest } from "@/lib/pipeline";
import { deleteAllDemoData, deleteEventHistory, deleteEverything, disconnectRing } from "@/lib/privacy/data";
import { applyRetention } from "@/lib/privacy/retention";
import { DEMO_TEMPLATES, buildDemoEvent } from "@/lib/providers/demo";
import { syncProvider } from "@/lib/providers/registry";
import { audit } from "@/lib/repo/audit";
import { getCamera, setCameraZone } from "@/lib/repo/cameras";
import { markAllRead } from "@/lib/repo/notifications";
import { deleteProfile, getProfile, listProfiles, saveProfile } from "@/lib/repo/profiles";
import { deleteRule, getRule, listRules, saveRule } from "@/lib/repo/rules";
import { getSettings, updateSettings } from "@/lib/repo/settings";
import { listCameras } from "@/lib/repo/cameras";
import { evaluate } from "@/lib/rules/engine";
import { composeNotification } from "@/lib/notifications/compose";
import { isValidTimeZone, minutesOfDay } from "@/lib/util/time";
import { log } from "@/lib/util/log";

type Handler = (user: User, form: FormData) => Promise<ActionResult> | ActionResult;

async function guarded(permission: Permission, form: FormData, fn: Handler): Promise<ActionResult> {
  try {
    const user = await requirePermission(permission);
    return await fn(user, form);
  } catch (err) {
    if (err instanceof ForbiddenError) return fail(err.message);
    if (err instanceof ZodError) return fail(`Check the form: ${err.issues[0]?.path.join(".")} — ${err.issues[0]?.message}`);
    if (err instanceof Error && /NEXT_REDIRECT/.test(err.message)) throw err;
    log.error("action.failed", { err: err as Error });
    return fail(err instanceof Error ? err.message : "Something went wrong.");
  }
}

const str = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === "string" ? v.trim() : "";
};
const optStr = (f: FormData, k: string) => str(f, k) || null;
const list = (f: FormData, k: string) => f.getAll(k).filter((v): v is string => typeof v === "string" && v !== "");
const timeWindow = (f: FormData, prefix: string) => {
  const start = str(f, `${prefix}Start`);
  const end = str(f, `${prefix}End`);
  return start && end ? { start, end } : null;
};
const pct = (f: FormData, k: string) => {
  const v = str(f, k);
  return v === "" ? null : Math.min(100, Math.max(0, Number(v))) / 100;
};

// ---------- Events & feedback ----------

export async function simulateDemoEvent(_p: ActionResult | null, form: FormData) {
  return guarded("demo:simulate", form, async (user, f) => {
    if (!(await getSettings()).demoEnabled) return fail("Turn on demo data to simulate events.");
    const key = str(f, "template");
    if (!(key in DEMO_TEMPLATES)) return fail("Pick a sample event.");
    const r = await ingest(buildDemoEvent(key as keyof typeof DEMO_TEMPLATES, Date.now()));
    if (r.status !== "created") return fail("The sample event couldn't be created.");
    await audit(user.id, "demo.event_simulated", r.event.id, { template: key });
    revalidatePath("/", "layout");
    const extra = r.derived.length ? ` (+${r.derived.length} safety pattern${r.derived.length > 1 ? "s" : ""})` : "";
    return ok(`Demo event added: “${r.event.summary}” → ${r.event.decision?.channel.replace("_", " ")}${extra}.`);
  });
}

export async function confirmProfileAction(_p: ActionResult | null, form: FormData) {
  return guarded("events:feedback", form, async (user, f) => {
    const e = await confirmEventProfile(str(f, "eventId"), str(f, "profileId"), user.id);
    revalidatePath("/", "layout");
    return ok(`Labeled: ${e.summary}.`);
  });
}

export async function rejectProfileAction(_p: ActionResult | null, form: FormData) {
  return guarded("events:feedback", form, async (user, f) => {
    await rejectEventProfile(str(f, "eventId"), user.id);
    revalidatePath("/", "layout");
    return ok("Association removed. The person is now shown as not identified.");
  });
}

export async function labelEventAction(_p: ActionResult | null, form: FormData) {
  return guarded("events:feedback", form, async (user, f) => {
    const label = str(f, "label");
    if (!["not_delivery", "false_alarm", "helpful", "not_helpful"].includes(label)) return fail("Unknown label.");
    await labelEvent(str(f, "eventId"), label as "not_delivery", user.id);
    revalidatePath(`/activity/${str(f, "eventId")}`);
    return ok("Thanks — feedback saved. It's used to tune your preferences, not to train any model.");
  });
}

export async function markNotificationsRead() {
  await requirePermission("events:read");
  await markAllRead();
  revalidatePath("/", "layout");
}

// ---------- Household ----------

export async function saveProfileAction(_p: ActionResult | null, form: FormData) {
  return guarded("household:manage", form, async (user, f) => {
    const id = optStr(f, "id");
    const existing = id ? await getProfile(id) : null;
    if (id && !existing) return fail("Profile not found.");
    const notifyMode = str(f, "notifyMode") as NotifyMode;
    if (!NOTIFY_MODES.includes(notifyMode)) return fail("Choose a notification preference.");
    const consent = str(f, "consentStatus") as "granted" | "pending" | "withdrawn";
    const cameraIds = list(f, "cameraIds");
    const saved = await saveProfile({
      id: existing?.id,
      createdAt: existing?.createdAt,
      demo: existing?.demo ?? false,
      displayName: str(f, "displayName"),
      relationship: optStr(f, "relationship"),
      enabled: f.get("enabled") === "on",
      consentStatus: ["granted", "pending", "withdrawn"].includes(consent) ? consent : "pending",
      notifyMode,
      cameraIds: cameraIds.length ? cameraIds : null,
      activeWindow: timeWindow(f, "active"),
      reviewThreshold: pct(f, "reviewThreshold"),
    });
    let note = "";
    if (existing && existing.consentStatus !== "withdrawn" && saved.consentStatus === "withdrawn") {
      const n = await clearProfileAssociations(saved.id, user.id);
      note = ` Consent withdrawn — removed ${n} past association${n === 1 ? "" : "s"}.`;
    }
    await audit(user.id, existing ? "profile.updated" : "profile.created", saved.id, {
      consentStatus: saved.consentStatus,
      notifyMode: saved.notifyMode,
      enabled: saved.enabled,
    });
    revalidatePath("/", "layout");
    return ok(`Saved ${saved.displayName}.${note}`);
  });
}

export async function deleteProfileAction(_p: ActionResult | null, form: FormData) {
  return guarded("household:manage", form, async (user, f) => {
    const p = await getProfile(str(f, "id"));
    if (!p) return fail("Profile not found.");
    await clearProfileAssociations(p.id, user.id);
    await deleteProfile(p.id);
    await audit(user.id, "profile.deleted", p.id);
    revalidatePath("/", "layout");
    return ok(`Deleted ${p.displayName} and removed their event associations.`);
  });
}

// ---------- Cameras & integrations ----------

export async function saveZoneAction(_p: ActionResult | null, form: FormData) {
  return guarded("settings:manage", form, async (user, f) => {
    const cam = await getCamera(str(f, "id"));
    if (!cam) return fail("Camera not found.");
    const zone = optStr(f, "zone");
    if (zone && zone.length > 40) return fail("Keep zone names under 40 characters.");
    await setCameraZone(cam.id, zone);
    await audit(user.id, "camera.zone_updated", cam.id, { zone });
    revalidatePath("/cameras");
    return ok(`Updated ${cam.name}.`);
  });
}

export async function syncRingAction(_p: ActionResult | null, form: FormData) {
  return guarded("integrations:manage", form, async (user) => {
    try {
      const r = await syncProvider("ring", user.id);
      revalidatePath("/", "layout");
      return ok(`Synced ${r.cameras} device${r.cameras === 1 ? "" : "s"}: ${r.created} new event${r.created === 1 ? "" : "s"}, ${r.merged} merged, ${r.duplicate} already known.`);
    } catch (err) {
      revalidatePath("/", "layout");
      return fail((err as Error).message || "Ring sync failed.");
    }
  });
}

export async function disconnectRingAction(_p: ActionResult | null, form: FormData) {
  return guarded("integrations:manage", form, async (user) => {
    await disconnectRing(user.id);
    revalidatePath("/", "layout");
    return ok("Ring tokens deleted from this app. To fully remove access, also remove the integration in the Ring app.");
  });
}

// ---------- Rules ----------

function parseRule(f: FormData) {
  const action = str(f, "action") as RuleAction;
  if (!RULE_ACTIONS.includes(action)) throw new Error("Choose an action.");
  const minSeverity = optStr(f, "minSeverity") as Severity | null;
  return {
    name: str(f, "name"),
    enabled: f.get("enabled") === "on",
    priority: Math.round(Number(str(f, "priority") || 50)),
    categories: list(f, "categories").filter((c): c is EventCategory => (EVENT_CATEGORIES as readonly string[]).includes(c)),
    cameraIds: list(f, "cameraIds"),
    profileIds: list(f, "profileIds"),
    minConfidence: pct(f, "minConfidence"),
    minSeverity: minSeverity && SEVERITIES.includes(minSeverity) ? minSeverity : null,
    timeWindow: timeWindow(f, "window"),
    action,
  };
}

export async function saveRuleAction(_p: ActionResult | null, form: FormData) {
  return guarded("rules:manage", form, async (user, f) => {
    const id = optStr(f, "id");
    const existing = id ? await getRule(id) : null;
    if (id && !existing) return fail("Rule not found.");
    const saved = await saveRule({ ...parseRule(f), id: existing?.id, createdAt: existing?.createdAt });
    await audit(user.id, existing ? "rule.updated" : "rule.created", saved.id, { name: saved.name, action: saved.action, enabled: saved.enabled });
    revalidatePath("/rules");
    return ok(`Saved rule “${saved.name}”.`);
  });
}

export async function deleteRuleAction(_p: ActionResult | null, form: FormData) {
  return guarded("rules:manage", form, async (user, f) => {
    const r = await getRule(str(f, "id"));
    if (!r) return fail("Rule not found.");
    await deleteRule(r.id);
    await audit(user.id, "rule.deleted", r.id, { name: r.name });
    revalidatePath("/rules");
    return ok(`Deleted “${r.name}”.`);
  });
}

/** Test mode: evaluates a hypothetical event against the current rules. Nothing is stored or sent. */
export async function previewRulesAction(_p: ActionResult | null, form: FormData) {
  return guarded("events:read", form, async (_user, f) => {
    const settings = await getSettings();
    const category = str(f, "category") as EventCategory;
    if (!EVENT_CATEGORIES.includes(category)) return fail("Choose a category.");
    const severity = (str(f, "severity") || "low") as Severity;
    const [h, m] = (str(f, "time") || "12:00").split(":").map(Number);
    const now = Date.now();
    // Today at the chosen local time in the household's time zone.
    const target = (h ?? 12) * 60 + (m ?? 0);
    const timestamp = now - (minutesOfDay(now, settings.timezone) - target) * 60_000;
    const profileId = optStr(f, "profileId");
    const conf = pct(f, "confidence");
    const event = {
      eventType: category,
      cameraId: optStr(f, "cameraId"),
      householdProfileId: profileId,
      association: profileId
        ? { profileId, method: conf === null ? ("user_confirmed" as const) : ("demo_simulated" as const), confidence: conf, status: "confirmed" as const }
        : null,
      confidence: profileId ? null : conf,
      severity: SEVERITIES.includes(severity) ? severity : "low",
      timestamp,
    };
    const cameras = await listCameras();
    const profiles = await listProfiles();
    const decision = evaluate({
      event,
      rules: await listRules(),
      profiles,
      settings,
      recent: f.get("simulateRecent") === "on" ? [{ channel: "push", dedupKey: [category, event.cameraId ?? "-", profileId ?? "-"].join("|"), createdAt: now - 60_000 }] : [],
      now,
      cameraName: (id) => cameras.find((c) => c.id === id)?.name ?? "camera",
    });
    const profile = profiles.find((p) => p.id === profileId);
    const camName = cameras.find((c) => c.id === event.cameraId)?.name ?? "Any camera";
    const summary = profile ? `${profile.displayName} arrived home` : `Sample ${category} event`;
    const copy = composeNotification({ ...event, summary }, decision, profile, camName, settings.timezone);
    return ok("Preview ready — nothing was stored or sent.", { decision, copy });
  });
}

// ---------- Settings ----------

export async function saveNotificationSettingsAction(_p: ActionResult | null, form: FormData) {
  return guarded("settings:manage", form, async (user, f) => {
    const tz = str(f, "timezone");
    if (!isValidTimeZone(tz)) return fail("Unknown time zone.");
    const next = await updateSettings({
      timezone: tz,
      quietHours: { enabled: f.get("quietEnabled") === "on", start: str(f, "quietStart") || "22:30", end: str(f, "quietEnd") || "06:30" },
      dedupWindowMinutes: Number(str(f, "dedupWindowMinutes")),
      cooldown: { maxPush: Number(str(f, "cooldownMax")), windowMinutes: Number(str(f, "cooldownWindow")) },
      defaultReviewThreshold: pct(f, "defaultReviewThreshold") ?? 0.8,
      behavior: {
        loiterSeconds: Number(str(f, "loiterSeconds")),
        repeatVisitsCount: Number(str(f, "repeatVisitsCount")),
        repeatVisitsWindowMinutes: Number(str(f, "repeatVisitsWindowMinutes")),
      },
      ladder: {
        low: str(f, "ladderLow") === "in_app" ? "in_app" : "quiet_log",
        attention: str(f, "ladderAttention") === "in_app" ? "in_app" : "push",
        high: "push",
        emergency: "push",
      },
    });
    await audit(user.id, "settings.notifications_updated", null, { quietHours: next.quietHours, dedup: next.dedupWindowMinutes, cooldown: next.cooldown });
    revalidatePath("/", "layout");
    return ok("Notification settings saved.");
  });
}

export async function saveRetentionAction(_p: ActionResult | null, form: FormData) {
  return guarded("data:delete", form, async (user, f) => {
    const next = await updateSettings({ retentionDays: Number(str(f, "retentionDays")), auditRetentionDays: Number(str(f, "auditRetentionDays")) });
    await audit(user.id, "settings.retention_updated", null, { retentionDays: next.retentionDays, auditRetentionDays: next.auditRetentionDays });
    const r = await applyRetention(Date.now(), user.id);
    revalidatePath("/", "layout");
    return ok(`Retention saved. Removed ${r.events} expired event${r.events === 1 ? "" : "s"}.`);
  });
}

export async function setDemoEnabledAction(_p: ActionResult | null, form: FormData) {
  return guarded("settings:manage", form, async (user, f) => {
    const enabled = f.get("demoEnabled") === "on";
    const hide = f.get("hideDemoData") === "on";
    const before = await getSettings();
    await updateSettings({ demoEnabled: enabled, hideDemoData: hide });
    if (!enabled && before.demoEnabled) await deleteAllDemoData(user.id);
    if (enabled && !before.demoEnabled) await seedDemo(user.id);
    await audit(user.id, "settings.demo_updated", null, { demoEnabled: enabled, hideDemoData: hide });
    revalidatePath("/", "layout");
    return ok(enabled ? "Demo data is on." : "Demo data turned off and removed.");
  });
}

export async function resetDemoAction(_p: ActionResult | null, form: FormData) {
  return guarded("settings:manage", form, async (user) => {
    if (!(await getSettings()).demoEnabled) return fail("Demo data is off.");
    await resetDemo(user.id);
    revalidatePath("/", "layout");
    return ok("Demo data reset to the original samples.");
  });
}

export async function deleteDataAction(_p: ActionResult | null, form: FormData) {
  return guarded("data:delete", form, async (user, f) => {
    const what = str(f, "what");
    if (what === "events") {
      const n = await deleteEventHistory(user.id);
      revalidatePath("/", "layout");
      return ok(`Deleted ${n} events and their notifications.`);
    }
    if (what === "everything") {
      if (str(f, "confirmText") !== "DELETE") return fail('Type DELETE to confirm.');
      await deleteEverything(user.id);
      revalidatePath("/", "layout");
      return ok("All household data, settings and Ring tokens were deleted.");
    }
    return fail("Unknown deletion.");
  });
}

// ---------- Members ----------

export async function addMemberAction(_p: ActionResult | null, form: FormData) {
  return guarded("members:manage", form, async (user, f) => {
    const role = str(f, "role") === "owner" ? "owner" : "member";
    const created = await createUser(str(f, "email"), str(f, "password"), role);
    await audit(user.id, "member.added", created.id, { role });
    revalidatePath("/settings");
    return ok(`Added ${created.email} as ${role}. Share the temporary password with them privately.`);
  });
}

export async function removeMemberAction(_p: ActionResult | null, form: FormData) {
  return guarded("members:manage", form, async (user, f) => {
    const id = str(f, "id");
    if (id === user.id) return fail("You can't remove yourself.");
    const users = await listUsers();
    const target = users.find((u) => u.id === id);
    if (!target) return fail("Account not found.");
    if (target.role === "owner" && users.filter((u) => u.role === "owner").length <= 1) return fail("Keep at least one owner.");
    await revokeUserSessions(id);
    await deleteUser(id);
    await audit(user.id, "member.removed", id);
    revalidatePath("/settings");
    return ok("Account removed and signed out.");
  });
}
