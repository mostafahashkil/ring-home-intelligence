import { beforeEach, describe, expect, it } from "vitest";
import { ensureInitialized, resetDemo, DEFAULT_RULES } from "@/lib/bootstrap";
import { ingest } from "@/lib/pipeline";
import { buildDemoEvent } from "@/lib/providers/demo";
import { listEvents, getEvent } from "@/lib/repo/events";
import { listNotifications, notificationsForEvent } from "@/lib/repo/notifications";
import { listProfiles, saveProfile } from "@/lib/repo/profiles";
import { listRules } from "@/lib/repo/rules";
import { listAudit } from "@/lib/repo/audit";
import { updateSettings } from "@/lib/repo/settings";
import { confirmEventProfile, clearProfileAssociations, rejectEventProfile } from "@/lib/household/feedback";
import { freshDb } from "./helpers";

beforeEach(async () => {
  await freshDb();
  await updateSettings({ timezone: "UTC", quietHours: { enabled: false, start: "22:00", end: "06:00" } });
});

describe("first-run initialization", () => {
  it("creates default rules and a clearly-flagged demo household", async () => {
    await ensureInitialized();
    expect(await listRules()).toHaveLength(DEFAULT_RULES.length);
    const profiles = await listProfiles();
    expect(profiles.map((p) => p.displayName)).toEqual(["Alex", "Emily", "Jack", "Sarah"]);
    expect(profiles.every((p) => p.demo)).toBe(true);
    const { events } = await listEvents({ limit: 100 });
    expect(events.length).toBeGreaterThan(10);
    expect(events.every((e) => e.demo)).toBe(true);
    // Running again is a no-op.
    await ensureInitialized();
    expect(await listRules()).toHaveLength(DEFAULT_RULES.length);
  });

  it("produces the expected sample experiences", async () => {
    await ensureInitialized();
    const titles = (await listNotifications({ limit: 100 })).map((n) => n.title);
    expect(titles).toContain("Alex arrived home");
    expect(titles).toContain("Sarah arrived home");
    expect(titles).toContain("Jack may have arrived — match uncertain. Review event.");
    expect(titles.some((t) => /Possible delivery/.test(t))).toBe(true);
    expect(titles.some((t) => /Repeated attempts to open the door/.test(t))).toBe(true);
    const { events } = await listEvents({ limit: 100 });
    const jack = events.find((e) => e.summary.startsWith("Jack"))!;
    expect(jack.decision?.channel).toBe("review");
    expect(jack.summary).toMatch(/may have arrived/);
    // Emily's preference is "quiet log" → her confirmed arrival is not a push.
    const emily = events.find((e) => e.summary === "Emily arrived home")!;
    expect(emily.association?.method).toBe("user_confirmed");
    // No event anywhere calls someone suspicious or a criminal.
    expect(events.some((e) => /suspicious|criminal|intruder|thief/i.test(e.summary))).toBe(false);
  });

  it("reset demo data only touches demo rows", async () => {
    await ensureInitialized();
    await ingest({ provider: "ring", providerEventId: "real1", timestamp: Date.now(), providerDeviceId: "dev", kind: "motion", subType: "human", demo: false });
    await resetDemo("tester");
    expect((await listEvents({ includeDemo: false })).events).toHaveLength(1);
    expect((await listEvents({ limit: 100 })).events.filter((e) => e.demo).length).toBeGreaterThan(10);
  });
});

describe("ingest", () => {
  it("is idempotent per provider event id", async () => {
    const input = { provider: "ring" as const, providerEventId: "same", timestamp: Date.now(), providerDeviceId: "dev", kind: "doorbell" as const, demo: false };
    expect((await ingest(input)).status).toBe("created");
    expect((await ingest(input)).status).toBe("duplicate");
    expect((await listEvents()).total).toBe(1);
  });

  it("rejects invalid payloads and demo-flag spoofing", async () => {
    expect((await ingest({ nope: true })).status).toBe("invalid");
    expect((await ingest({ provider: "ring", providerEventId: "x", timestamp: 1, providerDeviceId: "d", kind: "motion", demo: true })).status).toBe("invalid");
  });

  it("never associates real events with profiles automatically", async () => {
    await ensureInitialized();
    const r = await ingest({
      provider: "ring",
      providerEventId: "r1",
      timestamp: Date.now(),
      providerDeviceId: "dev",
      kind: "motion",
      subType: "human",
      demo: false,
      demoDetails: { profileName: "Alex", matchConfidence: 0.99 },
    });
    expect(r.status === "created" && r.event.householdProfileId).toBeNull();
    expect(r.status === "created" && r.event.eventType).toBe("visitor");
  });

  it("does not simulate matches for profiles without consent", async () => {
    await ensureInitialized();
    const alex = (await listProfiles()).find((p) => p.displayName === "Alex")!;
    await saveProfile({ ...alex, consentStatus: "withdrawn" });
    const r = await ingest(buildDemoEvent("arrival_alex", Date.now()));
    expect(r.status === "created" && r.event.householdProfileId).toBeNull();
    expect(r.status === "created" && r.event.summary).toMatch(/not identified/);
  });

  it("derives a repeated-visits behavior event after the configured count", async () => {
    await updateSettings({ behavior: { loiterSeconds: 180, repeatVisitsCount: 3, repeatVisitsWindowMinutes: 60 } });
    const now = Date.now();
    const visit = (i: number) => ({ provider: "ring" as const, providerEventId: `v${i}`, timestamp: now - (30 - i * 10) * 60_000, providerDeviceId: "dev", kind: "doorbell" as const, demo: false });
    await ingest(visit(0), { now: now - 30 * 60_000 });
    await ingest(visit(1), { now: now - 20 * 60_000 });
    const third = await ingest(visit(2), { now: now - 10 * 60_000 });
    expect(third.status === "created" && third.derived.map((d) => d.summary)).toEqual(["Repeated visits at New Ring device"]);
    const fourth = await ingest({ ...visit(3), timestamp: now - 5 * 60_000 }, { now: now - 5 * 60_000 });
    expect(fourth.status === "created" && fourth.derived).toHaveLength(0); // not re-flagged inside the window
  });

  it("derives prolonged activity from event duration", async () => {
    const now = Date.now();
    const r = await ingest({ provider: "ring", providerEventId: "long", timestamp: now - 300_000, endTimestamp: now - 60_000, providerDeviceId: "dev", kind: "motion", subType: "human", demo: false }, { now: now - 60_000 });
    expect(r.status === "created" && r.derived[0]?.summary).toMatch(/Prolonged activity/);
    expect(r.status === "created" && r.derived[0]?.inference?.label).toMatch(/not an accusation/);
  });

  it("writes an audit entry for triggered automations", async () => {
    await ensureInitialized();
    await ingest(buildDemoEvent("delivery", Date.now()));
    expect((await listAudit()).some((a) => a.action === "automation.triggered")).toBe(true);
  });
});

describe("feedback and consent", () => {
  it("lets a household member confirm or reject an association", async () => {
    await ensureInitialized();
    const r = await ingest({ provider: "ring", providerEventId: "p1", timestamp: Date.now(), providerDeviceId: "dev", kind: "motion", subType: "human", demo: false });
    const me = await saveProfile({ displayName: "Riley", relationship: null, enabled: true, consentStatus: "granted", notifyMode: "each_arrival", cameraIds: null, activeWindow: null, reviewThreshold: null, demo: false });
    if (r.status !== "created") throw new Error("expected created");
    const confirmed = await confirmEventProfile(r.event.id, me.id, "usr_1");
    expect(confirmed.summary).toBe("Riley arrived home");
    expect(confirmed.association?.method).toBe("user_confirmed");
    const rejected = await rejectEventProfile(r.event.id, "usr_1");
    expect(rejected.householdProfileId).toBeNull();
    expect(rejected.feedback.map((f) => f.label)).toEqual(["confirmed_profile", "not_profile"]);
  });

  it("refuses to mix demo profiles with real events", async () => {
    await ensureInitialized();
    const r = await ingest({ provider: "ring", providerEventId: "p2", timestamp: Date.now(), providerDeviceId: "dev", kind: "motion", subType: "human", demo: false });
    const demoAlex = (await listProfiles()).find((p) => p.demo)!;
    if (r.status !== "created") throw new Error("expected created");
    await expect(confirmEventProfile(r.event.id, demoAlex.id, "u")).rejects.toThrow(/Demo events/);
  });

  it("clears past associations when consent is withdrawn", async () => {
    await ensureInitialized();
    const alex = (await listProfiles()).find((p) => p.displayName === "Alex")!;
    const before = (await listEvents({ profileId: alex.id })).events;
    expect(before.length).toBeGreaterThan(0);
    await clearProfileAssociations(alex.id, "u");
    expect((await listEvents({ profileId: alex.id })).events).toHaveLength(0);
    expect((await getEvent(before[0]!.id))?.summary).toMatch(/not identified/);
    expect((await notificationsForEvent(before[0]!.id)).length).toBeGreaterThan(0);
  });
});
