import { getDb } from "../db";
import { audit, listAudit } from "../repo/audit";
import { listCameras } from "../repo/cameras";
import { listEvents } from "../repo/events";
import { listProfiles } from "../repo/profiles";
import { listRules } from "../repo/rules";
import { getSettings } from "../repo/settings";
import { deleteCredentials, loadCredentials } from "../providers/ring/auth";

/** Everything this app stores about the household, minus secrets. */
export function exportData() {
  const creds = loadCredentials();
  return {
    exportedAt: new Date().toISOString(),
    notice: "Ring Home Intelligence data export. Tokens and password hashes are intentionally excluded.",
    settings: getSettings(),
    ringIntegration: creds ? { connected: creds.status === "connected", source: creds.source, updatedAt: creds.updatedAt } : null,
    cameras: listCameras(),
    profiles: listProfiles(),
    rules: listRules(),
    events: listEvents({ limit: 100_000 }).events,
    notifications: getDb().prepare("SELECT id, event_id, rule_id, channel, title, body, explanation, severity, created_at, read_at, demo FROM notifications ORDER BY created_at DESC").all(),
    audit: listAudit(10_000),
    users: getDb().prepare("SELECT id, email, role, created_at FROM users").all(),
  };
}

export function deleteEventHistory(actor: string, opts: { demoOnly?: boolean } = {}) {
  const db = getDb();
  const where = opts.demoOnly ? "WHERE demo = 1" : "";
  const n = db.transaction(() => {
    db.prepare(`DELETE FROM notifications ${where}`).run();
    return db.prepare(`DELETE FROM events ${where}`).run().changes;
  })();
  audit(actor, opts.demoOnly ? "data.demo_events_deleted" : "data.events_deleted", null, { count: n });
  return n;
}

export function deleteAllDemoData(actor: string) {
  const db = getDb();
  db.transaction(() => {
    db.prepare("DELETE FROM notifications WHERE demo = 1").run();
    db.prepare("DELETE FROM events WHERE demo = 1").run();
    db.prepare("DELETE FROM profiles WHERE demo = 1").run();
    db.prepare("DELETE FROM cameras WHERE demo = 1").run();
  })();
  audit(actor, "data.demo_deleted");
}

export function disconnectRing(actor: string) {
  deleteCredentials();
  audit(actor, "integration.ring_disconnected");
}

/** Factory reset: removes all household data, tokens and settings. Accounts are kept so the owner stays signed in. */
export function deleteEverything(actor: string) {
  const db = getDb();
  db.transaction(() => {
    for (const t of ["notifications", "events", "profiles", "cameras", "rules", "settings", "ring_credentials", "oauth_states", "webhook_receipts", "app_meta"]) {
      db.prepare(`DELETE FROM ${t}`).run();
    }
  })();
  audit(actor, "data.factory_reset");
}
