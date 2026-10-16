import { getDb, json } from "../db";
import { Profile, ProfileSchema } from "../domain/types";
import { newId } from "../util/id";

function toProfile(r: Record<string, unknown>): Profile {
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

export function listProfiles(opts: { includeDemo?: boolean } = {}): Profile[] {
  const where = opts.includeDemo === false ? "WHERE demo = 0" : "";
  const rows = getDb().prepare(`SELECT * FROM profiles ${where} ORDER BY created_at ASC`).all() as Record<
    string,
    unknown
  >[];
  return rows.map(toProfile);
}

export function getProfile(id: string): Profile | null {
  const r = getDb().prepare("SELECT * FROM profiles WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return r ? toProfile(r) : null;
}

export function saveProfile(input: Omit<Profile, "id" | "createdAt"> & { id?: string; createdAt?: number }): Profile {
  const p = ProfileSchema.parse({ ...input, id: input.id ?? newId("prf"), createdAt: input.createdAt ?? Date.now() });
  getDb()
    .prepare(
      `INSERT INTO profiles (id, display_name, relationship, enabled, consent_status, notify_mode, camera_ids, active_window, review_threshold, demo, created_at)
       VALUES (@id, @displayName, @relationship, @enabled, @consentStatus, @notifyMode, @cameraIds, @activeWindow, @reviewThreshold, @demo, @createdAt)
       ON CONFLICT(id) DO UPDATE SET display_name = excluded.display_name, relationship = excluded.relationship,
         enabled = excluded.enabled, consent_status = excluded.consent_status, notify_mode = excluded.notify_mode,
         camera_ids = excluded.camera_ids, active_window = excluded.active_window, review_threshold = excluded.review_threshold`,
    )
    .run({
      ...p,
      enabled: p.enabled ? 1 : 0,
      demo: p.demo ? 1 : 0,
      cameraIds: json.str(p.cameraIds),
      activeWindow: json.str(p.activeWindow),
    });
  return getProfile(p.id)!;
}

export function deleteProfile(id: string) {
  getDb().prepare("DELETE FROM profiles WHERE id = ?").run(id);
}
