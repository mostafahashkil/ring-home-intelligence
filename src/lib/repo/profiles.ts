import { getDb, json, Row } from "../db";
import { Profile, ProfileSchema } from "../domain/types";
import { newId } from "../util/id";

function toProfile(r: Row): Profile {
  return {
    id: r.id as string,
    displayName: r.display_name as string,
    relationship: (r.relationship as string) ?? null,
    enabled: r.enabled === 1,
    consentStatus: r.consent_status as Profile["consentStatus"],
    notifyMode: r.notify_mode as Profile["notifyMode"],
    cameraIds: json.parse(r.camera_ids, null as string[] | null),
    activeWindow: json.parse(r.active_window, null as Profile["activeWindow"]),
    reviewThreshold: (r.review_threshold as number) ?? null,
    demo: r.demo === 1,
    createdAt: r.created_at as number,
  };
}

export async function listProfiles(opts: { includeDemo?: boolean } = {}): Promise<Profile[]> {
  const where = opts.includeDemo === false ? "WHERE demo = 0" : "";
  const rows = await (await getDb()).all(`SELECT * FROM profiles ${where} ORDER BY created_at ASC`);
  return rows.map(toProfile);
}

export async function getProfile(id: string): Promise<Profile | null> {
  const r = await (await getDb()).get("SELECT * FROM profiles WHERE id = ?", [id]);
  return r ? toProfile(r) : null;
}

export async function saveProfile(input: Omit<Profile, "id" | "createdAt"> & { id?: string; createdAt?: number }): Promise<Profile> {
  const p = ProfileSchema.parse({ ...input, id: input.id ?? newId("prf"), createdAt: input.createdAt ?? Date.now() });
  await (await getDb()).run(
      `INSERT INTO profiles (id, display_name, relationship, enabled, consent_status, notify_mode, camera_ids, active_window, review_threshold, demo, created_at)
       VALUES (@id, @displayName, @relationship, @enabled, @consentStatus, @notifyMode, @cameraIds, @activeWindow, @reviewThreshold, @demo, @createdAt)
       ON CONFLICT(id) DO UPDATE SET display_name = excluded.display_name, relationship = excluded.relationship,
         enabled = excluded.enabled, consent_status = excluded.consent_status, notify_mode = excluded.notify_mode,
         camera_ids = excluded.camera_ids, active_window = excluded.active_window, review_threshold = excluded.review_threshold`,
    {
      ...p,
      enabled: p.enabled ? 1 : 0,
      demo: p.demo ? 1 : 0,
      cameraIds: json.str(p.cameraIds),
      activeWindow: json.str(p.activeWindow),
    },
  );
  return (await getProfile(p.id))!;
}

export async function deleteProfile(id: string) {
  await (await getDb()).run("DELETE FROM profiles WHERE id = ?", [id]);
}
