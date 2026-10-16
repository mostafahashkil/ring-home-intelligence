import { getDb } from "../db";
import { audit } from "../repo/audit";
import { getMeta, getSettings, setMeta } from "../repo/settings";

export interface RetentionResult {
  events: number;
  notifications: number;
  audit: number;
  webhookReceipts: number;
  sessions: number;
}

/** Deletes data older than the configured retention windows. Deterministic given `now`. */
export function applyRetention(now = Date.now(), actor = "system"): RetentionResult {
  const s = getSettings();
  const db = getDb();
  const eventCutoff = now - s.retentionDays * 86_400_000;
  const auditCutoff = now - s.auditRetentionDays * 86_400_000;
  const result = db.transaction((): RetentionResult => {
    const notifications = db.prepare("DELETE FROM notifications WHERE created_at < ?").run(eventCutoff).changes;
    const events = db.prepare("DELETE FROM events WHERE timestamp < ?").run(eventCutoff).changes;
    const auditRows = db.prepare("DELETE FROM audit_log WHERE ts < ?").run(auditCutoff).changes;
    // Ring retries for at most ~1h13m; keep receipts a day for idempotency.
    const webhookReceipts = db.prepare("DELETE FROM webhook_receipts WHERE received_at < ?").run(now - 86_400_000).changes;
    const sessions = db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(now).changes;
    return { events, notifications, audit: auditRows, webhookReceipts, sessions };
  })();
  if (result.events || result.notifications || result.audit) {
    audit(actor, "retention.applied", null, { ...result, retentionDays: s.retentionDays });
  }
  setMeta("retention.lastRun", String(now));
  return result;
}

/** Runs retention at most once per hour; cheap enough to call on page loads. */
export function maybeApplyRetention(now = Date.now()) {
  const last = Number(getMeta("retention.lastRun")) || 0;
  if (now - last > 3_600_000) applyRetention(now);
}
