import { getDb, json } from "../db";
import { AuditEntry } from "../domain/types";
import { redact } from "../util/log";

/** Append-only audit trail for configuration changes and triggered automations. */
export function audit(
  actor: string,
  action: string,
  target: string | null = null,
  details: Record<string, unknown> = {},
) {
  getDb()
    .prepare("INSERT INTO audit_log (ts, actor, action, target, details) VALUES (?, ?, ?, ?, ?)")
    .run(Date.now(), actor, action, target, JSON.stringify(redact(details)));
}

export function listAudit(limit = 100, offset = 0): AuditEntry[] {
  const rows = getDb()
    .prepare("SELECT * FROM audit_log ORDER BY ts DESC, id DESC LIMIT ? OFFSET ?")
    .all(limit, offset) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: r.id as number,
    ts: r.ts as number,
    actor: r.actor as string,
    action: r.action as string,
    target: (r.target as string) ?? null,
    details: json.parse(r.details, {}),
  }));
}
