import { getDb, json, Row } from "../db";
import { Camera, ProviderId } from "../domain/types";
import { newId } from "../util/id";

function toCamera(r: Row): Camera {
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

export async function listCameras(opts: { includeDemo?: boolean } = {}): Promise<Camera[]> {
  const where = opts.includeDemo === false ? "WHERE demo = 0" : "";
  const rows = await (await getDb()).all(`SELECT * FROM cameras ${where} ORDER BY demo ASC, name ASC`);
  return rows.map(toCamera);
}

export async function getCamera(id: string): Promise<Camera | null> {
  const r = await (await getDb()).get("SELECT * FROM cameras WHERE id = ?", [id]);
  return r ? toCamera(r) : null;
}

export async function findCameraByDevice(provider: ProviderId, deviceId: string): Promise<Camera | null> {
  const r = await (await getDb()).get("SELECT * FROM cameras WHERE provider = ? AND provider_device_id = ?", [provider, deviceId]);
  return r ? toCamera(r) : null;
}

export async function upsertCamera(input: Omit<Camera, "id" | "updatedAt"> & { id?: string }): Promise<Camera> {
  const existing = await findCameraByDevice(input.provider, input.providerDeviceId);
  const id = existing?.id ?? input.id ?? newId("cam");
  await (await getDb()).run(
    `INSERT INTO cameras (id, provider, provider_device_id, name, zone, status, supports_clips, component_ids, demo, updated_at)
     VALUES (@id, @provider, @deviceId, @name, @zone, @status, @clips, @components, @demo, @now)
     ON CONFLICT(provider, provider_device_id) DO UPDATE SET
       name = excluded.name, status = excluded.status, supports_clips = excluded.supports_clips,
       component_ids = excluded.component_ids, updated_at = excluded.updated_at,
       zone = COALESCE(cameras.zone, excluded.zone)`,
    {
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
    },
  );
  return (await getCamera(id))!;
}

export async function setCameraStatus(id: string, status: Camera["status"]) {
  await (await getDb()).run("UPDATE cameras SET status = ?, updated_at = ? WHERE id = ?", [status, Date.now(), id]);
}

export async function setCameraZone(id: string, zone: string | null) {
  await (await getDb()).run("UPDATE cameras SET zone = ?, updated_at = ? WHERE id = ?", [zone, Date.now(), id]);
}
