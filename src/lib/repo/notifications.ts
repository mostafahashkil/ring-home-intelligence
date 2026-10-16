import { getDb } from "../db";
import { NotificationRecord, Severity } from "../domain/types";
import { newId } from "../util/id";

export interface RecentNotification {
  channel: NotificationRecord["channel"];
  dedupKey: string | null;
  cameraId: string | null;
  createdAt: number;
}

function toNotification(r: Record<string, unknown>): NotificationRecord {
  return {
    id: r.id as string,
    eventId: (r.event_id as string) ?? null,
    ruleId: (r.rule_id as string) ?? null,
    channel: r.channel as NotificationRecord["channel"],
    title: r.title as string,
    body: r.body as string,
    explanation: r.explanation as string,
    severity: r.severity as Severity,
    createdAt: r.created_at as number,
    readAt: (r.read_at as number) ?? null,
    demo: r.demo === 1,
  };
}

export function insertNotification(
  n: Omit<NotificationRecord, "id" | "readAt"> & { dedupKey: string | null; cameraId: string | null },
): NotificationRecord {
  const id = newId("ntf");
  getDb()
    .prepare(
      `INSERT INTO notifications (id, event_id, rule_id, channel, title, body, explanation, severity, dedup_key, camera_id, created_at, demo)
       VALUES (@id, @eventId, @ruleId, @channel, @title, @body, @explanation, @severity, @dedupKey, @cameraId, @createdAt, @demo)`,
    )
    .run({ ...n, id, demo: n.demo ? 1 : 0 });
  return { ...n, id, readAt: null };
}

export function recentNotifications(since: number): RecentNotification[] {
  const rows = getDb()
    .prepare("SELECT channel, dedup_key, camera_id, created_at FROM notifications WHERE created_at >= ? ORDER BY created_at DESC")
    .all(since) as Record<string, unknown>[];
  return rows.map((r) => ({
    channel: r.channel as NotificationRecord["channel"],
    dedupKey: (r.dedup_key as string) ?? null,
    cameraId: (r.camera_id as string) ?? null,
    createdAt: r.created_at as number,
  }));
}

/** Notifications people should see (quiet-log entries stay in the timeline only). */
export function listNotifications(opts: { limit?: number; unreadOnly?: boolean; includeDemo?: boolean } = {}) {
  const where = ["channel IN ('push','in_app','review')"];
  if (opts.unreadOnly) where.push("read_at IS NULL");
  if (opts.includeDemo === false) where.push("demo = 0");
  const rows = getDb()
    .prepare(`SELECT * FROM notifications WHERE ${where.join(" AND ")} ORDER BY created_at DESC LIMIT ?`)
    .all(opts.limit ?? 30) as Record<string, unknown>[];
  return rows.map(toNotification);
}

export function countUnread(includeDemo = true): number {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS n FROM notifications WHERE channel IN ('push','in_app','review') AND read_at IS NULL ${
        includeDemo ? "" : "AND demo = 0"
      }`,
    )
    .get() as { n: number };
  return row.n;
}

export function markAllRead() {
  getDb().prepare("UPDATE notifications SET read_at = ? WHERE read_at IS NULL").run(Date.now());
}

export function notificationsForEvent(eventId: string): NotificationRecord[] {
  const rows = getDb()
    .prepare("SELECT * FROM notifications WHERE event_id = ? ORDER BY created_at ASC")
    .all(eventId) as Record<string, unknown>[];
  return rows.map(toNotification);
}
