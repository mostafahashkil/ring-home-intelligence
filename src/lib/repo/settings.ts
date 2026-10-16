import { getDb, json } from "../db";
import { DEFAULT_SETTINGS, Settings, SettingsSchema } from "../domain/types";

export function getSettings(): Settings {
  const rows = getDb().prepare("SELECT key, value FROM settings").all() as { key: string; value: string }[];
  const merged: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const r of rows) merged[r.key] = json.parse(r.value, (DEFAULT_SETTINGS as Record<string, unknown>)[r.key]);
  const parsed = SettingsSchema.safeParse(merged);
  return parsed.success ? parsed.data : DEFAULT_SETTINGS;
}

export function updateSettings(patch: Partial<Settings>): Settings {
  const next = SettingsSchema.parse({ ...getSettings(), ...patch });
  const db = getDb();
  const stmt = db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  );
  db.transaction(() => {
    for (const key of Object.keys(patch) as (keyof Settings)[]) stmt.run(key, JSON.stringify(next[key]));
  })();
  return next;
}

export function getMeta(key: string): string | null {
  const row = getDb().prepare("SELECT value FROM app_meta WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setMeta(key: string, value: string) {
  getDb()
    .prepare("INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(key, value);
}
