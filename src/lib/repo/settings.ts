import { getDb, json, transaction } from "../db";
import { DEFAULT_SETTINGS, Settings, SettingsSchema } from "../domain/types";

export async function getSettings(): Promise<Settings> {
  const rows = await (await getDb()).all<{ key: string; value: string }>("SELECT key, value FROM settings");
  const merged: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const r of rows) merged[r.key] = json.parse(r.value, (DEFAULT_SETTINGS as Record<string, unknown>)[r.key]);
  const parsed = SettingsSchema.safeParse(merged);
  return parsed.success ? parsed.data : DEFAULT_SETTINGS;
}

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = SettingsSchema.parse({ ...(await getSettings()), ...patch });
  await transaction(async () => {
    const db = await getDb();
    for (const key of Object.keys(patch) as (keyof Settings)[]) {
      await db.run("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [
        key,
        JSON.stringify(next[key]),
      ]);
    }
  });
  return next;
}

export async function getMeta(key: string): Promise<string | null> {
  const row = await (await getDb()).get<{ value: string }>("SELECT value FROM app_meta WHERE key = ?", [key]);
  return row?.value ?? null;
}

/** Sets the key only if it doesn't exist yet; returns whether this call set it. */
export async function claimMeta(key: string, value: string): Promise<boolean> {
  const r = await (await getDb()).run("INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING", [key, value]);
  return r.changes === 1;
}

export async function deleteMeta(key: string) {
  await (await getDb()).run("DELETE FROM app_meta WHERE key = ?", [key]);
}

export async function setMeta(key: string, value: string) {
  await (await getDb()).run("INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [
    key,
    value,
  ]);
}
