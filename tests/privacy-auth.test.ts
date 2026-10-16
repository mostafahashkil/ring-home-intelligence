import { beforeEach, describe, expect, it } from "vitest";
import { applyRetention } from "@/lib/privacy/retention";
import { deleteEverything, exportData } from "@/lib/privacy/data";
import { ingest } from "@/lib/pipeline";
import { listEvents } from "@/lib/repo/events";
import { audit, listAudit } from "@/lib/repo/audit";
import { updateSettings } from "@/lib/repo/settings";
import { saveCredentials } from "@/lib/providers/ring/auth";
import {
  assertCan,
  can,
  createSessionToken,
  createUser,
  ForbiddenError,
  hashPassword,
  revokeSessionToken,
  SESSION_TTL_MS,
  userForSessionToken,
  verifyLogin,
  verifyPassword,
} from "@/lib/auth/core";
import { open, seal } from "@/lib/util/secretbox";
import { redact } from "@/lib/util/log";
import { getDb } from "@/lib/db";
import { freshDb } from "./helpers";

beforeEach(() => {
  freshDb();
});

describe("retention", () => {
  it("deletes events and notifications older than the retention window", async () => {
    updateSettings({ retentionDays: 7 });
    const now = Date.now();
    const mk = (id: string, daysAgo: number) =>
      ingest({ provider: "ring", providerEventId: id, timestamp: now - daysAgo * 86_400_000, providerDeviceId: "dev", kind: "doorbell", demo: false }, { now: now - daysAgo * 86_400_000 });
    await mk("old", 10);
    await mk("edge", 6.9);
    await mk("new", 0);
    const r = applyRetention(now);
    expect(r.events).toBe(1);
    expect(r.notifications).toBe(1);
    expect(listEvents().events.map((e) => e.providerEventId).sort()).toEqual(["edge", "new"]);
    expect(listAudit().some((a) => a.action === "retention.applied")).toBe(true);
  });

  it("expires sessions and old webhook receipts", () => {
    const now = Date.now();
    const u = createUser("owner@example.com", "a-long-password", "owner");
    createSessionToken(u.id, now - SESSION_TTL_MS - 1);
    getDb().prepare("INSERT INTO webhook_receipts VALUES ('r1', ?)").run(now - 2 * 86_400_000);
    const r = applyRetention(now);
    expect(r.sessions).toBe(1);
    expect(r.webhookReceipts).toBe(1);
  });
});

describe("export and deletion", () => {
  it("exports data without secrets", async () => {
    createUser("owner@example.com", "a-long-password", "owner");
    saveCredentials({ accountId: "acct", accessToken: "tok-abc", refreshToken: "ref-xyz", accessExpiresAt: 1, status: "connected", source: "oauth" });
    await ingest({ provider: "ring", providerEventId: "e", timestamp: Date.now(), providerDeviceId: "dev", kind: "doorbell", demo: false });
    const text = JSON.stringify(exportData());
    expect(text).toContain("owner@example.com");
    expect(text).not.toMatch(/tok-abc|ref-xyz|password_hash|scrypt\$/);
  });

  it("factory reset removes household data but keeps accounts", async () => {
    createUser("owner@example.com", "a-long-password", "owner");
    await ingest({ provider: "ring", providerEventId: "e", timestamp: Date.now(), providerDeviceId: "dev", kind: "doorbell", demo: false });
    deleteEverything("u");
    expect(listEvents().total).toBe(0);
    expect((getDb().prepare("SELECT COUNT(*) n FROM users").get() as { n: number }).n).toBe(1);
  });
});

describe("permissions", () => {
  it("owners can do everything; members can only view and give feedback", () => {
    expect(can("owner", "rules:manage")).toBe(true);
    expect(can("member", "events:read")).toBe(true);
    expect(can("member", "events:feedback")).toBe(true);
    for (const p of ["rules:manage", "household:manage", "settings:manage", "integrations:manage", "data:export", "data:delete", "members:manage"] as const) {
      expect(can("member", p)).toBe(false);
    }
    expect(can(null, "events:read")).toBe(false);
  });

  it("assertCan throws ForbiddenError for missing users or permissions", () => {
    expect(() => assertCan(null, "events:read")).toThrow(ForbiddenError);
    expect(() => assertCan({ id: "u", email: "m@x.io", role: "member", createdAt: 0 }, "data:delete")).toThrow(ForbiddenError);
  });
});

describe("authentication", () => {
  it("hashes passwords with salt and verifies them", () => {
    const h = hashPassword("correct horse battery");
    expect(h).not.toContain("correct");
    expect(hashPassword("correct horse battery")).not.toBe(h);
    expect(verifyPassword("correct horse battery", h)).toBe(true);
    expect(verifyPassword("wrong", h)).toBe(false);
  });

  it("enforces password length and email format", () => {
    expect(() => createUser("not-an-email", "a-long-password", "owner")).toThrow();
    expect(() => createUser("a@b.co", "short", "owner")).toThrow();
  });

  it("locks out after repeated failures", () => {
    createUser("owner@example.com", "a-long-password", "owner");
    for (let i = 0; i < 5; i++) expect(verifyLogin("owner@example.com", "nope").ok).toBe(false);
    expect(verifyLogin("owner@example.com", "a-long-password")).toEqual({ ok: false, reason: "locked" });
    expect(verifyLogin("owner@example.com", "a-long-password", Date.now() + 16 * 60_000).ok).toBe(true);
  });

  it("stores only hashed session tokens and honors expiry/revocation", () => {
    const u = createUser("owner@example.com", "a-long-password", "owner");
    const { token } = createSessionToken(u.id);
    expect(JSON.stringify(getDb().prepare("SELECT * FROM sessions").all())).not.toContain(token);
    expect(userForSessionToken(token)?.id).toBe(u.id);
    expect(userForSessionToken(token, Date.now() + SESSION_TTL_MS + 1)).toBeNull();
    revokeSessionToken(token);
    expect(userForSessionToken(token)).toBeNull();
    expect(userForSessionToken("garbage")).toBeNull();
  });
});

describe("secrets and logging", () => {
  it("round-trips sealed values and detects tampering", () => {
    const s = seal("secret-token");
    expect(s).not.toContain("secret-token");
    expect(open(s)).toBe("secret-token");
    const parts = s.split(".");
    parts[3] = parts[3]!.slice(0, -2) + (parts[3]!.endsWith("AA") ? "BB" : "AA");
    expect(() => open(parts.join("."))).toThrow();
  });

  it("redacts tokens, emails and bearer headers from logs and audit details", () => {
    const r = redact({ access_token: "abc", nested: { email: "x@y.com", note: "contact x@y.com" }, header: "Bearer abc.def" }) as Record<string, unknown>;
    expect(JSON.stringify(r)).not.toMatch(/abc|x@y\.com/);
    audit("u", "test", null, { refresh_token: "zzz" });
    expect(JSON.stringify(listAudit())).not.toContain("zzz");
  });
});
