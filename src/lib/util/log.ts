/**
 * Minimal structured logger that redacts secrets and personal data.
 * Never log tokens, codes, nonces, passwords, emails, or raw provider payloads.
 */
const SENSITIVE_KEY = /token|secret|password|authorization|cookie|nonce|code_verifier|^code$|signature|email|hmac/i;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const BEARER = /Bearer\s+[A-Za-z0-9._~+/=-]+/g;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 5) return "[depth]";
  if (typeof value === "string") return value.replace(EMAIL, "[email]").replace(BEARER, "Bearer [redacted]");
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));
  if (value instanceof Error) return { name: value.name, message: redact(value.message, depth + 1) };
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SENSITIVE_KEY.test(k) ? "[redacted]" : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

type Level = "debug" | "info" | "warn" | "error";

function emit(level: Level, msg: string, ctx?: Record<string, unknown>) {
  if (level === "debug" && process.env.NODE_ENV === "production") return;
  if (process.env.VITEST && level !== "error") return;
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...(ctx ? { ctx: redact(ctx) } : {}) });
  (level === "error" ? console.error : level === "warn" ? console.warn : console.log)(line);
}

export const log = {
  debug: (msg: string, ctx?: Record<string, unknown>) => emit("debug", msg, ctx),
  info: (msg: string, ctx?: Record<string, unknown>) => emit("info", msg, ctx),
  warn: (msg: string, ctx?: Record<string, unknown>) => emit("warn", msg, ctx),
  error: (msg: string, ctx?: Record<string, unknown>) => emit("error", msg, ctx),
};
