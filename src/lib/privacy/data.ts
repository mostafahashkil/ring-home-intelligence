import { getDb, transaction } from "../db";
import { audit, listAudit } from "../repo/audit";
import { listCameras } from "../repo/cameras";
import { listEvents } from "../repo/events";
import { listProfiles } from "../repo/profiles";
import { listRules } from "../repo/rules";
import { getSettings } from "../repo/settings";
import { deleteCredentials, loadCredentials } from "../providers/ring/auth";

/** Everything this app stores about the household, minus secrets. */
export async function exportData() {
  const db = await getDb();
  const creds = await loadCredentials();
  return {
    exportedAt: new Date().toISOString(),
    notice: "Ring Home Intelligence data export. Tokens and password hashes are intentionally excluded.",
    settings: await getSettings(),
    ringIntegration: creds ? { connected: creds.status === "connected", source: creds.source, updatedAt: creds.updatedAt } : null,
    cameras: await listCameras(),
    profiles: await listProfiles(),
    rules: await listRules(),
    events: (await listEvents({ limit: 100_000 })).events,
    notifications: await db.all("SELECT id, event_id, rule_id, channel, title, body, explanation, severity, created_at, read_at, demo FROM notifications ORDER BY created_at DESC"),
    audit: await listAudit(10_000),
    users: await db.all("SELECT id, email, role, created_at FROM users"),
  };
}

export async function deleteEventHistory(actor: string, opts: { demoOnly?: boolean } = {}) {
  const where = opts.demoOnly ? "WHERE demo = 1" : "";
  const n = await transaction(async () => {
    const db = await getDb();
    await db.run(`DELETE FROM notifications ${where}`);
    return (await db.run(`DELETE FROM events ${where}`)).changes;
  });
  await audit(actor, opts.demoOnly ? "data.demo_events_deleted" : "data.events_deleted", null, { count: n });
  return n;
}

export async function deleteAllDemoData(actor: string) {
  await transaction(async () => {
    const db = await getDb();
    await db.run("DELETE FROM notifications WHERE demo = 1");
    await db.run("DELETE FROM events WHERE demo = 1");
    await db.run("DELETE FROM profiles WHERE demo = 1");
    await db.run("DELETE FROM cameras WHERE demo = 1");
  });
  await audit(actor, "data.demo_deleted");
}

export async function disconnectRing(actor: string) {
  await deleteCredentials();
  await audit(actor, "integration.ring_disconnected");
}

/** Factory reset: removes all household data, tokens and settings. Accounts are kept so the owner stays signed in. */
export async function deleteEverything(actor: string) {
  await transaction(async () => {
    const db = await getDb();
    for (const t of ["notifications", "events", "profiles", "cameras", "rules", "settings", "ring_credentials", "oauth_states", "webhook_receipts", "app_meta"]) {
      await db.run(`DELETE FROM ${t}`);
    }
  });
  await audit(actor, "data.factory_reset");
}
