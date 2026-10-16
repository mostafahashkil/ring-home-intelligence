import { getDb, transaction } from "../db";
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
export async function applyRetention(now = Date.now(), actor = "system"): Promise<RetentionResult> {
  const s = await getSettings();
  const eventCutoff = now - s.retentionDays * 86_400_000;
  const auditCutoff = now - s.auditRetentionDays * 86_400_000;
  const result = await transaction(async (): Promise<RetentionResult> => {
    const db = await getDb();
    const notifications = (await db.run("DELETE FROM notifications WHERE created_at < ?", [eventCutoff])).changes;
    const events = (await db.run("DELETE FROM events WHERE timestamp < ?", [eventCutoff])).changes;
    const auditRows = (await db.run("DELETE FROM audit_log WHERE ts < ?", [auditCutoff])).changes;
    // Ring retries for at most ~1h13m; keep receipts a day for idempotency.
    const webhookReceipts = (await db.run("DELETE FROM webhook_receipts WHERE received_at < ?", [now - 86_400_000])).changes;
    const sessions = (await db.run("DELETE FROM sessions WHERE expires_at < ?", [now])).changes;
    return { events, notifications, audit: auditRows, webhookReceipts, sessions };
  });
  if (result.events || result.notifications || result.audit) {
    await audit(actor, "retention.applied", null, { ...result, retentionDays: s.retentionDays });
  }
  await setMeta("retention.lastRun", String(now));
  return result;
}

/** Runs retention at most once per hour; cheap enough to call on page loads. */
export async function maybeApplyRetention(now = Date.now()) {
  const last = Number(await getMeta("retention.lastRun")) || 0;
  if (now - last > 3_600_000) await applyRetention(now);
}
