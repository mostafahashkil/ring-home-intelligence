/**
 * First-run initialization: default rules and (when demo mode is on) the sample household,
 * cameras and timeline. Idempotent; safe to call on every request.
 */
import { Rule } from "./domain/types";
import { confirmEventProfile } from "./household/feedback";
import { ingest } from "./pipeline";
import { maybeApplyRetention } from "./privacy/retention";
import { deleteAllDemoData } from "./privacy/data";
import { DEMO_CAMERAS, DEMO_PROFILES, DEMO_SEED, buildDemoEvent } from "./providers/demo";
import { audit } from "./repo/audit";
import { upsertCamera } from "./repo/cameras";
import { listProfiles, saveProfile } from "./repo/profiles";
import { saveRule } from "./repo/rules";
import { getMeta, getSettings, setMeta } from "./repo/settings";

export const DEFAULT_RULES: Omit<Rule, "id" | "createdAt">[] = [
  { name: "Safety: needs attention or higher", enabled: true, priority: 80, categories: ["behavior"], cameraIds: [], profileIds: [], minConfidence: null, minSeverity: "attention", timeWindow: null, action: "push" },
  { name: "Household arrivals", enabled: true, priority: 60, categories: ["arrival"], cameraIds: [], profileIds: [], minConfidence: null, minSeverity: null, timeWindow: null, action: "push" },
  { name: "Package activity", enabled: true, priority: 50, categories: ["package"], cameraIds: [], profileIds: [], minConfidence: null, minSeverity: null, timeWindow: null, action: "push" },
  { name: "Doorbell presses", enabled: true, priority: 50, categories: ["doorbell"], cameraIds: [], profileIds: [], minConfidence: null, minSeverity: null, timeWindow: null, action: "push" },
  { name: "Unrecognized visitors", enabled: true, priority: 40, categories: ["visitor"], cameraIds: [], profileIds: [], minConfidence: null, minSeverity: null, timeWindow: null, action: "in_app" },
  { name: "Camera status changes", enabled: true, priority: 30, categories: ["device"], cameraIds: [], profileIds: [], minConfidence: null, minSeverity: null, timeWindow: null, action: "in_app" },
  { name: "Routine motion & vehicles", enabled: true, priority: 10, categories: ["motion", "vehicle"], cameraIds: [], profileIds: [], minConfidence: null, minSeverity: null, timeWindow: null, action: "quiet_log" },
];

let initializing: Promise<void> | null = null;

export function ensureInitialized(): Promise<void> {
  if (getMeta("initialized") === "1") {
    maybeApplyRetention();
    return Promise.resolve();
  }
  initializing ??= (async () => {
    try {
      for (const r of DEFAULT_RULES) saveRule(r);
      if (getSettings().demoEnabled) await seedDemo("system");
      setMeta("initialized", "1");
      audit("system", "app.initialized");
    } finally {
      initializing = null;
    }
  })();
  return initializing;
}

export async function seedDemo(actor: string, now = Date.now()) {
  for (const c of DEMO_CAMERAS) upsertCamera({ ...c, provider: "demo", demo: true });
  const existing = new Set(listProfiles().filter((p) => p.demo).map((p) => p.displayName));
  DEMO_PROFILES.forEach((p, i) => {
    if (existing.has(p.displayName)) return;
    saveProfile({
      displayName: p.displayName,
      relationship: p.relationship,
      enabled: true,
      consentStatus: "granted",
      notifyMode: p.displayName === "Emily" ? "quiet_log" : "each_arrival",
      cameraIds: null,
      activeWindow: null,
      reviewThreshold: null,
      demo: true,
      createdAt: now - (10 - i) * 1000,
    });
  });
  const profiles = listProfiles().filter((p) => p.demo);
  for (const s of DEMO_SEED) {
    const ts = now - s.minutesAgo * 60_000;
    const result = await ingest(buildDemoEvent(s.template, ts), { now: ts });
    if (s.confirmProfile && result.status === "created") {
      const profile = profiles.find((p) => p.displayName === s.confirmProfile);
      if (profile) confirmEventProfile(result.event.id, profile.id, "demo-seed", ts + 60_000);
    }
  }
  audit(actor, "demo.seeded", null, { events: DEMO_SEED.length });
}

export async function resetDemo(actor: string) {
  deleteAllDemoData(actor);
  await seedDemo(actor);
}
