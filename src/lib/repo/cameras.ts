import { getDb, json } from "../db";
import { Camera, ProviderId } from "../domain/types";
import { newId } from "../util/id";

function toCamera(r: Record<string, unknown>): Camera {
  return {
    id: r.id as string,
    provider: r.provider as ProviderId,
    providerDeviceId: r.provider_device_id as string,
    name: r.name as string,
    zone: (r.zone as string) ?? null,
    status: r.status as Camera["status"],
    supportsClips: r.supports_clips === 1,
    componentIds: json.parse(r.component_ids, [] as string[]),
    demo: r.demo === 1,
    updatedAt: r.updated_at as number,
  };
}

export function listCameras(opts: { includeDemo?: boolean } = {}): Camera[] {
  const where = opts.includeDemo === false ? "WHERE demo = 0" : "";
  const rows = getDb().prepare(`SELECT * FROM cameras ${where} ORDER BY demo ASC, name ASC`).all() as Record<
    string,
    unknown
  >[];
  return rows.map(toCamera);
}

export function getCamera(id: string): Camera | null {
  const r = getDb().prepare("SELECT * FROM cameras WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return r ? toCamera(r) : null;
}

export function findCameraByDevice(provider: ProviderId, deviceId: string): Camera | null {
  const r = getDb()
    .prepare("SELECT * FROM cameras WHERE provider = ? AND provider_device_id = ?")
    .get(provider, deviceId) as Record<string, unknown> | undefined;
  return r ? toCamera(r) : null;
}

export function upsertCamera(input: Omit<Camera, "id" | "updatedAt"> & { id?: string }): Camera {
  const existing = findCameraByDevice(input.provider, input.providerDeviceId);
  const id = existing?.id ?? input.id ?? newId("cam");
  getDb()
    .prepare(
      `INSERT INTO cameras (id, provider, provider_device_id, name, zone, status, supports_clips, component_ids, demo, updated_at)
       VALUES (@id, @provider, @deviceId, @name, @zone, @status, @clips, @components, @demo, @now)
       ON CONFLICT(provider, provider_device_id) DO UPDATE SET
         name = excluded.name, status = excluded.status, supports_clips = excluded.supports_clips,
         component_ids = excluded.component_ids, updated_at = excluded.updated_at,
         zone = COALESCE(cameras.zone, excluded.zone)`,
    )
    .run({
      id,
      provider: input.provider,
      deviceId: input.providerDeviceId,
      name: input.name,
      zone: input.zone,
      status: input.status,
      clips: input.supportsClips ? 1 : 0,
      components: JSON.stringify(input.componentIds),
      demo: input.demo ? 1 : 0,
      now: Date.now(),
    });
  return getCamera(id)!;
}

export function setCameraStatus(id: string, status: Camera["status"]) {
  getDb().prepare("UPDATE cameras SET status = ?, updated_at = ? WHERE id = ?").run(status, Date.now(), id);
}

export function setCameraZone(id: string, zone: string | null) {
  getDb().prepare("UPDATE cameras SET zone = ?, updated_at = ? WHERE id = ?").run(zone, Date.now(), id);
}
