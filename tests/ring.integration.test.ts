/**
 * Provider adapter integration tests with a mocked Ring API (no network).
 * Response shapes follow the examples in the Ring Partner API documentation.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RingApiError, RingClient } from "@/lib/providers/ring/client";
import { getAccessToken, loadCredentials, refreshTokens, saveCredentials, beginOAuth, completeOAuth } from "@/lib/providers/ring/auth";
import { RingProvider } from "@/lib/providers/ring/provider";
import { ingest } from "@/lib/pipeline";
import { listCameras, upsertCamera } from "@/lib/repo/cameras";
import { listEvents } from "@/lib/repo/events";
import { getDb } from "@/lib/db";
import { freshDb } from "./helpers";

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

type Route = (url: URL, init?: RequestInit) => Response | Promise<Response>;
function mockFetch(routes: Record<string, Route | Route[]>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const counters: Record<string, number> = {};
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url: url.toString(), init });
    const key = Object.keys(routes).find((k) => {
      const [method, path] = k.split(" ");
      return (init?.method ?? "GET") === method && url.pathname === path;
    });
    if (!key) return json({ errors: [{ status: "404" }] }, 404);
    const r = routes[key]!;
    if (Array.isArray(r)) {
      const i = Math.min(counters[key] ?? 0, r.length - 1);
      counters[key] = (counters[key] ?? 0) + 1;
      return r[i]!(url, init);
    }
    return r(url, init);
  });
  return { fetch: fn as unknown as typeof fetch, calls };
}

const noSleep = () => Promise.resolve();

beforeEach(() => {
  freshDb();
  process.env.RING_CLIENT_ID = "client";
  process.env.RING_CLIENT_SECRET = "secret";
  delete process.env.RING_ACCESS_TOKEN;
  delete process.env.RING_REFRESH_TOKEN;
});

describe("RingClient", () => {
  it("retries 429 respecting Retry-After, then succeeds", async () => {
    const sleeps: number[] = [];
    const { fetch } = mockFetch({
      "GET /v1/devices": [() => json({}, 429, { "Retry-After": "2" }), () => json({ data: [{ id: "dev1", type: "devices", attributes: { name: "Front Door Camera" } }] })],
    });
    const client = new RingClient({ getAccessToken: async () => "a", refreshAccessToken: async () => "b", fetchImpl: fetch, sleep: async (ms) => void sleeps.push(ms) });
    expect(await client.listDevices()).toEqual([{ id: "dev1", name: "Front Door Camera" }]);
    expect(sleeps).toEqual([2000]);
  });

  it("refreshes once on 401 and retries with the new token", async () => {
    let token = "old";
    const { fetch, calls } = mockFetch({
      "GET /v1/users/me": (_u, init) =>
        (init?.headers as Record<string, string>).Authorization === "Bearer new"
          ? json({ data: { type: "users", id: "ava1.ring.account.X", attributes: {} } })
          : json({}, 401),
    });
    const client = new RingClient({ getAccessToken: async () => token, refreshAccessToken: async () => (token = "new"), fetchImpl: fetch, sleep: noSleep });
    expect(await client.getAccountId()).toBe("ava1.ring.account.X");
    expect(calls).toHaveLength(2);
  });

  it("surfaces persistent 401 as unauthorized and 503 as device offline", async () => {
    const { fetch } = mockFetch({ "GET /v1/devices": () => json({}, 401), "GET /v1/devices/d/status": () => json({}, 503) });
    const client = new RingClient({ getAccessToken: async () => "a", refreshAccessToken: async () => "a", fetchImpl: fetch, sleep: noSleep });
    await expect(client.listDevices()).rejects.toMatchObject({ code: "unauthorized" });
    await expect(client.getOnline("d")).rejects.toMatchObject({ code: "device_offline" });
  });

  it("maps 425/416 clip responses to retryable media errors and sends components", async () => {
    const { fetch, calls } = mockFetch({ "POST /v1/devices/d/media/video/download": [() => new Response(null, { status: 425 }), () => new Response(null, { status: 416 })] });
    const client = new RingClient({ getAccessToken: async () => "a", refreshAccessToken: async () => "a", fetchImpl: fetch, sleep: noSleep });
    await expect(client.downloadVideo("d", { timestamp: 1, duration: 5000, componentId: "2" })).rejects.toMatchObject({ code: "recording_not_ready" });
    await expect(client.downloadVideo("d", { timestamp: 1, duration: 5000, componentId: null })).rejects.toBeInstanceOf(RingApiError);
    expect(JSON.parse(calls[0]!.init!.body as string)).toEqual({ timestamp: 1, duration: 5000, components: [{ component_id: "2" }] });
    expect(JSON.parse(calls[1]!.init!.body as string)).toEqual({ timestamp: 1, duration: 5000 });
  });
});

describe("Ring token handling", () => {
  it("stores tokens encrypted, never in plaintext", () => {
    saveCredentials({ accountId: null, accessToken: "access-123", refreshToken: "refresh-456", accessExpiresAt: Date.now() + 3_600_000, status: "connected", source: "oauth" });
    const row = getDb().prepare("SELECT * FROM ring_credentials").get() as Record<string, string>;
    expect(JSON.stringify(row)).not.toContain("access-123");
    expect(JSON.stringify(row)).not.toContain("refresh-456");
    expect(loadCredentials()?.accessToken).toBe("access-123");
  });

  it("refreshes an expiring token and stores the rotated refresh token", async () => {
    saveCredentials({ accountId: null, accessToken: "old", refreshToken: "r1", accessExpiresAt: Date.now() + 10_000, status: "connected", source: "oauth" });
    const { fetch, calls } = mockFetch({ "POST /oauth/token": () => json({ access_token: "a2", refresh_token: "r2", expires_in: 14400, token_type: "Bearer" }) });
    expect(await getAccessToken(fetch)).toBe("a2");
    const body = new URLSearchParams(calls[0]!.init!.body as string);
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("r1");
    expect(loadCredentials()?.refreshToken).toBe("r2");
  });

  it("marks the integration expired when refresh is rejected", async () => {
    saveCredentials({ accountId: null, accessToken: null, refreshToken: "bad", accessExpiresAt: null, status: "connected", source: "oauth" });
    const { fetch } = mockFetch({ "POST /oauth/token": () => json({ error: "invalid_grant" }, 400) });
    await expect(refreshTokens(fetch)).rejects.toMatchObject({ reason: "expired" });
    expect(loadCredentials()?.status).toBe("auth_expired");
    await expect(getAccessToken(fetch)).rejects.toMatchObject({ reason: "expired" });
  });

  it("runs the PKCE flow with single-use, user-bound state", async () => {
    process.env.RING_OAUTH_REDIRECT_URI = "https://app.example.com/api/ring/oauth/callback";
    getDb().prepare("INSERT INTO users (id, email, password_hash, role, created_at) VALUES ('u1','o@example.com','x','owner',0)").run();
    const url = new URL(beginOAuth("u1"));
    expect(url.origin + url.pathname).toBe("https://account.ring.com/account/integrations/partner-link/authorize");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("scope")).toBe("ava.v1:read");
    const state = url.searchParams.get("state")!;
    const { fetch, calls } = mockFetch({ "POST /oauth/token": () => json({ access_token: "a", refresh_token: "r", expires_in: 14400 }) });
    await expect(completeOAuth({ state, code: "c", userId: "someone-else" }, fetch)).rejects.toThrow(/expired or didn't match/);
    // The state was consumed by the failed attempt.
    await expect(completeOAuth({ state, code: "c", userId: "u1" }, fetch)).rejects.toThrow();
    const url2 = new URL(beginOAuth("u1"));
    await completeOAuth({ state: url2.searchParams.get("state")!, code: "c", userId: "u1" }, fetch);
    const body = new URLSearchParams(calls[0]!.init!.body as string);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code_verifier")).toBeTruthy();
    expect(loadCredentials()?.source).toBe("oauth");
    delete process.env.RING_OAUTH_REDIRECT_URI;
  });
});

describe("RingProvider.sync + pipeline", () => {
  const t0 = Date.now() - 60 * 60_000;
  const historyFor = (filter: string | null) => {
    if (filter === "motion.human") return [{ id: "h1", type: "history-events", attributes: { event_type: "motion", is_third_party_reviewed: false, start: t0, end: t0 + 240_000 } }];
    if (filter === "ding") return [{ id: "h2", type: "history-events", attributes: { event_type: "ding", is_third_party_reviewed: false, start: t0 + 600_000, end: t0 + 630_000 } }];
    if (filter === "motion") return [
      { id: "h1", type: "history-events", attributes: { event_type: "motion", is_third_party_reviewed: false, start: t0, end: t0 + 240_000 } },
      { id: "h3", type: "history-events", attributes: { event_type: "on_demand", is_third_party_reviewed: false, start: t0, end: t0 + 1 } },
    ];
    return [];
  };

  it("discovers cameras and imports history quietly, with sub-types and durations", async () => {
    saveCredentials({ accountId: "acct", accessToken: "a", refreshToken: "r", accessExpiresAt: Date.now() + 3_600_000, status: "connected", source: "oauth" });
    const { fetch } = mockFetch({
      "GET /v1/devices": () => json({ data: [{ id: "dev1", type: "devices", attributes: { name: "Front Door" } }, { id: "chime", type: "devices", attributes: { name: "Upstairs" } }] }),
      "GET /v1/devices/dev1/status": () => json({ data: { attributes: { online: true } } }),
      "GET /v1/devices/chime/status": () => json({ data: { attributes: { online: false } } }),
      "GET /v1/devices/dev1/capabilities": () => json({ data: { id: "c", type: "device-capabilities", attributes: { video: { codecs: ["HEVC"] } } } }),
      "GET /v1/devices/chime/capabilities": () => json({ data: { id: "c", type: "device-capabilities", attributes: { video: null } } }),
      "GET /v1/history/devices/dev1/events": (u) => json({ data: historyFor(u.searchParams.get("event_types")), links: {} }),
    });
    const provider = new RingProvider(fetch);
    const { cameras, events } = await provider.sync();
    expect(cameras.map((c) => [c.name, c.status, c.supportsClips])).toEqual([["Front Door", "online", true], ["Upstairs", "offline", false]]);
    expect(events.map((e) => [e.kind, e.subType ?? null])).toEqual([["motion", "human"], ["doorbell", null]]);

    for (const c of cameras) upsertCamera({ ...c, provider: "ring", demo: false });
    for (const e of events) await ingest(e);
    const stored = listEvents().events;
    // 2 imported events + 1 derived "prolonged activity" (the person event lasted 4 min > 3 min threshold).
    expect(stored.map((e) => e.eventType).sort()).toEqual(["behavior", "doorbell", "visitor"]);
    // Imported history (older than 15 min) never pushes.
    expect(stored.every((e) => e.decision?.channel === "quiet_log")).toBe(true);
    expect(provider.connection().state).toBe("connected");
  });

  it("records a sync error and reports it in the connection state", async () => {
    saveCredentials({ accountId: "acct", accessToken: "a", refreshToken: "r", accessExpiresAt: Date.now() + 3_600_000, status: "connected", source: "oauth" });
    const { fetch } = mockFetch({ "GET /v1/devices": () => json({}, 403) });
    const provider = new RingProvider(fetch);
    await expect(provider.sync()).rejects.toBeInstanceOf(RingApiError);
    expect(provider.connection()).toMatchObject({ state: "error", message: expect.stringMatching(/isn't authorized/) });
  });

  it("merges a webhook event and its history record instead of duplicating", async () => {
    const ts = Date.now() - 2 * 60_000;
    await ingest({ provider: "ring", providerEventId: "dev1_motion_" + ts, timestamp: ts, providerDeviceId: "dev1", kind: "motion", subType: "human", componentIds: ["1"], demo: false });
    const r = await ingest({ provider: "ring", providerEventId: "history:h9", timestamp: ts + 800, endTimestamp: ts + 60_000, providerDeviceId: "dev1", kind: "motion", subType: "human", demo: false });
    expect(r.status).toBe("merged");
    const stored = listEvents().events;
    expect(stored).toHaveLength(1);
    expect(stored[0]!.endTimestamp).toBe(ts + 60_000);
    expect(stored[0]!.evidenceReference).toMatchObject({ kind: "ring_recording", durationMs: 60_000, componentId: "1" });
    expect(listCameras()).toHaveLength(1);
  });
});
