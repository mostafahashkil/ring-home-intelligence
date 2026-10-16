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
import { claimMeta, deleteMeta, getMeta, getSettings, setMeta } from "./repo/settings";

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

export async function ensureInitialized(): Promise<void> {
  if ((await getMeta("initialized")) === "1") {
    await maybeApplyRetention();
    return;
  }
  initializing ??= (async () => {
    try {
      // Claim first-run setup atomically: with several server instances, only one seeds.
      if (!(await claimMeta("init.claimed", String(Date.now())))) return;
      try {
        for (const r of DEFAULT_RULES) await saveRule(r);
        if ((await getSettings()).demoEnabled) await seedDemo("system");
        await setMeta("initialized", "1");
        await audit("system", "app.initialized");
      } catch (err) {
        await deleteMeta("init.claimed");
        throw err;
      }
    } finally {
      initializing = null;
    }
  })();
  await initializing;
}

export async function seedDemo(actor: string, now = Date.now()) {
  for (const c of DEMO_CAMERAS) await upsertCamera({ ...c, provider: "demo", demo: true });
  const existing = new Set((await listProfiles()).filter((p) => p.demo).map((p) => p.displayName));
  for (const [i, p] of DEMO_PROFILES.entries()) {
    if (existing.has(p.displayName)) continue;
    await saveProfile({
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
  }
  const profiles = (await listProfiles()).filter((p) => p.demo);
  for (const s of DEMO_SEED) {
    const ts = now - s.minutesAgo * 60_000;
    const result = await ingest(buildDemoEvent(s.template, ts), { now: ts });
    if (s.confirmProfile && result.status === "created") {
      const profile = profiles.find((p) => p.displayName === s.confirmProfile);
      if (profile) await confirmEventProfile(result.event.id, profile.id, "demo-seed", ts + 60_000);
    }
  }
  await audit(actor, "demo.seeded", null, { events: DEMO_SEED.length });
}

export async function resetDemo(actor: string) {
  await deleteAllDemoData(actor);
  await seedDemo(actor);
}
