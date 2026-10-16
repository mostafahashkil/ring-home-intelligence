/**
 * Framework-independent auth core (testable without Next.js).
 * - Passwords: scrypt (N=2^15) with per-user salt; constant-time verification.
 * - Sessions: 32 random bytes in an HttpOnly cookie; only the SHA-256 hash is stored server-side.
 * - Roles: owner (full control) and member (view + feedback). Every private action checks `can()`.
 */
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { getDb } from "../db";
import { Role, User } from "../domain/types";
import { newId } from "../util/id";

export const SESSION_TTL_MS = 14 * 86_400_000;
const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const LOGIN_WINDOW_MS = 15 * 60_000;
const LOGIN_MAX_FAILURES = 5;

export const PERMISSIONS = [
  "events:read",
  "events:feedback",
  "demo:simulate",
  "household:manage",
  "rules:manage",
  "settings:manage",
  "integrations:manage",
  "data:export",
  "data:delete",
  "members:manage",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  owner: PERMISSIONS,
  member: ["events:read", "events:feedback", "demo:simulate"],
};

export function can(role: Role | null | undefined, permission: Permission): boolean {
  return !!role && ROLE_PERMISSIONS[role].includes(permission);
}

export class ForbiddenError extends Error {
  constructor(public permission: Permission) {
    super("You don't have permission to do that.");
    this.name = "ForbiddenError";
  }
}

export function assertCan(user: User | null, permission: Permission): User {
  if (!user || !can(user.role, permission)) throw new ForbiddenError(permission);
  return user;
}

export const CredentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(10, "Use at least 10 characters.").max(200),
});

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32, SCRYPT);
  return `scrypt$${SCRYPT.N}$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [alg, n, salt, hash] = stored.split("$");
  if (alg !== "scrypt" || !n || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const actual = scryptSync(password, Buffer.from(salt, "base64url"), expected.length, { ...SCRYPT, N: Number(n) });
  return timingSafeEqual(expected, actual);
}

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

function toUser(r: Record<string, unknown>): User {
  return { id: r.id as string, email: r.email as string, role: r.role as Role, createdAt: r.created_at as number };
}

export function countUsers(): number {
  return (getDb().prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n;
}

export function listUsers(): User[] {
  return (getDb().prepare("SELECT * FROM users ORDER BY created_at ASC").all() as Record<string, unknown>[]).map(toUser);
}

export function createUser(email: string, password: string, role: Role): User {
  const creds = CredentialsSchema.parse({ email, password });
  const id = newId("usr");
  getDb()
    .prepare("INSERT INTO users (id, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(id, creds.email, hashPassword(creds.password), role, Date.now());
  return { id, email: creds.email, role, createdAt: Date.now() };
}

export function deleteUser(id: string) {
  getDb().prepare("DELETE FROM users WHERE id = ?").run(id);
}

let dummyHash: string | null = null;

export type LoginResult = { ok: true; user: User } | { ok: false; reason: "invalid" | "locked" };

export function verifyLogin(email: string, password: string, now = Date.now()): LoginResult {
  const key = email.trim().toLowerCase();
  const db = getDb();
  const attempt = db.prepare("SELECT count, window_start FROM login_attempts WHERE key = ?").get(key) as
    | { count: number; window_start: number }
    | undefined;
  if (attempt && now - attempt.window_start < LOGIN_WINDOW_MS && attempt.count >= LOGIN_MAX_FAILURES) {
    return { ok: false, reason: "locked" };
  }
  const row = db.prepare("SELECT * FROM users WHERE email = ?").get(key) as Record<string, unknown> | undefined;
  // Always run scrypt so response time doesn't reveal whether the account exists.
  dummyHash ??= hashPassword(randomBytes(12).toString("hex"));
  const ok = verifyPassword(password, row ? (row.password_hash as string) : dummyHash) && !!row;
  if (!ok || !row) {
    const fresh = !attempt || now - attempt.window_start >= LOGIN_WINDOW_MS;
    db.prepare(
      "INSERT INTO login_attempts (key, count, window_start) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = ?, window_start = ?",
    ).run(key, now, fresh ? 1 : attempt!.count + 1, fresh ? now : attempt!.window_start);
    return { ok: false, reason: "invalid" };
  }
  db.prepare("DELETE FROM login_attempts WHERE key = ?").run(key);
  return { ok: true, user: toUser(row) };
}

export function createSessionToken(userId: string, now = Date.now()): { token: string; expiresAt: number } {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = now + SESSION_TTL_MS;
  getDb()
    .prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .run(sha256(token), userId, now, expiresAt);
  return { token, expiresAt };
}

export function userForSessionToken(token: string | undefined | null, now = Date.now()): User | null {
  if (!token || token.length > 100) return null;
  const row = getDb()
    .prepare(
      "SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?",
    )
    .get(sha256(token), now) as Record<string, unknown> | undefined;
  return row ? toUser(row) : null;
}

export function revokeSessionToken(token: string) {
  getDb().prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha256(token));
}

export function revokeUserSessions(userId: string) {
  getDb().prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
}
