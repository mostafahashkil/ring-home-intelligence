/**
 * Ring OAuth token handling (server-side only).
 * - Token endpoint: POST https://oauth.ring.com/oauth/token (form-encoded), grant_type authorization_code | refresh_token.
 * - Access tokens last ~4 h; refresh tokens ~30 days and rotate on refresh.
 * - Partner-initiated linking: https://account.ring.com/account/integrations/partner-link/authorize with PKCE S256
 *   (invitation-only per Ring docs).
 * Tokens are stored sealed with AES-256-GCM (util/secretbox.ts) and never sent to the browser.
 */
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { getDb } from "../../db";
import { open, seal } from "../../util/secretbox";
import { log } from "../../util/log";

export const RING_OAUTH_TOKEN_URL = "https://oauth.ring.com/oauth/token";
export const RING_AUTHORIZE_URL = "https://account.ring.com/account/integrations/partner-link/authorize";
const OAUTH_STATE_TTL_MS = 10 * 60_000;

export interface RingConfig {
  clientId: string | null;
  clientSecret: string | null;
  hmacKey: string | null;
  redirectUri: string | null;
  scope: string;
  envAccessToken: string | null;
  envRefreshToken: string | null;
}

export function ringConfig(): RingConfig {
  const v = (k: string) => (process.env[k] && process.env[k]!.trim() !== "" ? process.env[k]!.trim() : null);
  return {
    clientId: v("RING_CLIENT_ID"),
    clientSecret: v("RING_CLIENT_SECRET"),
    hmacKey: v("RING_HMAC_SIGNING_KEY"),
    redirectUri: v("RING_OAUTH_REDIRECT_URI"),
    scope: v("RING_OAUTH_SCOPE") ?? "ava.v1:read",
    envAccessToken: v("RING_ACCESS_TOKEN"),
    envRefreshToken: v("RING_REFRESH_TOKEN"),
  };
}

export function canStartOAuth(c = ringConfig()): boolean {
  return Boolean(c.clientId && c.clientSecret && c.redirectUri);
}

export function hasAnyRingSetup(c = ringConfig()): boolean {
  return Boolean(c.envAccessToken || c.envRefreshToken || canStartOAuth(c));
}

const TokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.number().positive().optional(),
  token_type: z.string().optional(),
});

export class RingAuthError extends Error {
  constructor(message: string, public reason: "not_configured" | "expired" | "exchange_failed") {
    super(message);
    this.name = "RingAuthError";
  }
}

interface StoredCreds {
  accountId: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  accessExpiresAt: number | null;
  status: "connected" | "auth_expired";
  source: "oauth" | "env_refresh";
  updatedAt: number;
}

export function loadCredentials(): StoredCreds | null {
  const r = getDb().prepare("SELECT * FROM ring_credentials WHERE id = 1").get() as Record<string, unknown> | undefined;
  if (!r) return null;
  try {
    return {
      accountId: (r.account_id as string) ?? null,
      accessToken: r.access_token_enc ? open(r.access_token_enc as string) : null,
      refreshToken: r.refresh_token_enc ? open(r.refresh_token_enc as string) : null,
      accessExpiresAt: (r.access_expires_at as number) ?? null,
      status: r.status as StoredCreds["status"],
      source: r.source as StoredCreds["source"],
      updatedAt: r.updated_at as number,
    };
  } catch {
    log.error("ring.credentials_unreadable");
    return null;
  }
}

export function saveCredentials(c: Omit<StoredCreds, "updatedAt">) {
  getDb()
    .prepare(
      `INSERT INTO ring_credentials (id, account_id, access_token_enc, refresh_token_enc, access_expires_at, status, source, updated_at)
       VALUES (1, @accountId, @access, @refresh, @expires, @status, @source, @now)
       ON CONFLICT(id) DO UPDATE SET account_id = excluded.account_id, access_token_enc = excluded.access_token_enc,
         refresh_token_enc = excluded.refresh_token_enc, access_expires_at = excluded.access_expires_at,
         status = excluded.status, source = excluded.source, updated_at = excluded.updated_at`,
    )
    .run({
      accountId: c.accountId,
      access: c.accessToken ? seal(c.accessToken) : null,
      refresh: c.refreshToken ? seal(c.refreshToken) : null,
      expires: c.accessExpiresAt,
      status: c.status,
      source: c.source,
      now: Date.now(),
    });
}

export function setAccountId(accountId: string) {
  getDb().prepare("UPDATE ring_credentials SET account_id = ?, updated_at = ? WHERE id = 1").run(accountId, Date.now());
}

export function markExpired() {
  getDb().prepare("UPDATE ring_credentials SET status = 'auth_expired', updated_at = ? WHERE id = 1").run(Date.now());
}

export function deleteCredentials() {
  getDb().prepare("DELETE FROM ring_credentials").run();
  getDb().prepare("DELETE FROM oauth_states").run();
}

async function tokenRequest(params: Record<string, string>, fetchImpl: typeof fetch = fetch) {
  const res = await fetchImpl(RING_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(params).toString(),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new RingAuthError(
      res.status === 400 ? "Ring rejected the authorization (invalid, expired or reused code/token)." : `Ring token endpoint returned ${res.status}.`,
      res.status === 400 || res.status === 401 ? "expired" : "exchange_failed",
    );
  }
  return TokenResponseSchema.parse(await res.json());
}

function expiry(expiresIn: number | undefined, now: number) {
  return now + (expiresIn ?? 14_400) * 1000;
}

/** Exchange a refresh token; persists the rotated pair. */
export async function refreshTokens(fetchImpl: typeof fetch = fetch, now = Date.now()): Promise<string> {
  const cfg = ringConfig();
  const stored = loadCredentials();
  const refreshToken = stored?.refreshToken ?? cfg.envRefreshToken;
  if (!refreshToken) throw new RingAuthError("No Ring refresh token available. Connect your Ring account.", "not_configured");
  if (!cfg.clientId || !cfg.clientSecret) {
    throw new RingAuthError("RING_CLIENT_ID and RING_CLIENT_SECRET are required to refresh Ring tokens.", "not_configured");
  }
  try {
    const t = await tokenRequest(
      { grant_type: "refresh_token", refresh_token: refreshToken, client_id: cfg.clientId, client_secret: cfg.clientSecret },
      fetchImpl,
    );
    saveCredentials({
      accountId: stored?.accountId ?? null,
      accessToken: t.access_token,
      refreshToken: t.refresh_token ?? refreshToken,
      accessExpiresAt: expiry(t.expires_in, now),
      status: "connected",
      source: stored?.source ?? "env_refresh",
    });
    return t.access_token;
  } catch (err) {
    if (err instanceof RingAuthError && err.reason === "expired") markExpired();
    throw err;
  }
}

/** Current access token, refreshing proactively (60 s early). */
export async function getAccessToken(fetchImpl: typeof fetch = fetch, now = Date.now()): Promise<string> {
  const stored = loadCredentials();
  if (stored?.status === "auth_expired") {
    throw new RingAuthError("Ring authorization expired. Reconnect your Ring account.", "expired");
  }
  if (stored?.accessToken && stored.accessExpiresAt && stored.accessExpiresAt - 60_000 > now) return stored.accessToken;
  if (stored?.refreshToken) return refreshTokens(fetchImpl, now);
  const cfg = ringConfig();
  if (cfg.envAccessToken) return cfg.envAccessToken;
  if (cfg.envRefreshToken) return refreshTokens(fetchImpl, now);
  throw new RingAuthError("Ring is not connected.", "not_configured");
}

export function isRingConnected(): boolean {
  const stored = loadCredentials();
  if (stored) return stored.status === "connected";
  const cfg = ringConfig();
  return Boolean(cfg.envAccessToken || (cfg.envRefreshToken && cfg.clientId && cfg.clientSecret));
}

// ---- Partner-initiated OAuth 2.0 + PKCE ----

export function pkcePair() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export function beginOAuth(userId: string, now = Date.now()): string {
  const cfg = ringConfig();
  if (!canStartOAuth(cfg)) throw new RingAuthError("Ring OAuth isn't configured on this server.", "not_configured");
  const state = randomBytes(24).toString("base64url");
  const { verifier, challenge } = pkcePair();
  const db = getDb();
  db.prepare("DELETE FROM oauth_states WHERE created_at < ?").run(now - OAUTH_STATE_TTL_MS);
  db.prepare("INSERT INTO oauth_states (state_hash, code_verifier_enc, user_id, created_at) VALUES (?, ?, ?, ?)").run(
    sha256(state),
    seal(verifier),
    userId,
    now,
  );
  const url = new URL(RING_AUTHORIZE_URL);
  url.searchParams.set("client_id", cfg.clientId!);
  url.searchParams.set("redirect_uri", cfg.redirectUri!);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", cfg.scope);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

/** Validates state (single-use, 10 min, bound to the user who started it) and exchanges the code. */
export async function completeOAuth(
  params: { state: string; code: string; userId: string },
  fetchImpl: typeof fetch = fetch,
  now = Date.now(),
): Promise<void> {
  const cfg = ringConfig();
  const db = getDb();
  const row = db.prepare("SELECT * FROM oauth_states WHERE state_hash = ?").get(sha256(params.state)) as
    | { code_verifier_enc: string; user_id: string; created_at: number }
    | undefined;
  db.prepare("DELETE FROM oauth_states WHERE state_hash = ?").run(sha256(params.state));
  if (!row || row.user_id !== params.userId || now - row.created_at > OAUTH_STATE_TTL_MS) {
    throw new RingAuthError("The Ring sign-in link expired or didn't match this session. Please try again.", "exchange_failed");
  }
  const t = await tokenRequest(
    {
      grant_type: "authorization_code",
      code: params.code,
      code_verifier: open(row.code_verifier_enc),
      client_id: cfg.clientId!,
      client_secret: cfg.clientSecret!,
      redirect_uri: cfg.redirectUri!,
    },
    fetchImpl,
  );
  saveCredentials({
    accountId: null,
    accessToken: t.access_token,
    refreshToken: t.refresh_token ?? null,
    accessExpiresAt: expiry(t.expires_in, now),
    status: "connected",
    source: "oauth",
  });
}
