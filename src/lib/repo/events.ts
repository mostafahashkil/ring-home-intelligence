import { getDb, json, Row } from "../db";
import { EventCategory, NormalizedEvent, NormalizedEventSchema, ProviderId, Severity } from "../domain/types";

function toEvent(r: Row): NormalizedEvent {
  return {
    id: r.id as string,
    provider: r.provider as ProviderId,
    providerEventId: (r.provider_event_id as string) ?? null,
    timestamp: r.timestamp as number,
    endTimestamp: (r.end_timestamp as number) ?? null,
    cameraId: (r.camera_id as string) ?? null,
    zoneId: (r.zone_id as string) ?? null,
    eventType: r.event_type as EventCategory,
    providerType: (r.provider_type as string) ?? null,
    summary: r.summary as string,
    observations: json.parse(r.observations, []),
    inference: json.parse(r.inference, null),
    confidence: (r.confidence as number) ?? null,
    severity: r.severity as Severity,
    association: json.parse(r.association, null),
    householdProfileId: (r.household_profile_id as string) ?? null,
    evidenceReference: json.parse(r.evidence_reference, null),
    signals: json.parse(r.signals, []),
    ruleId: (r.rule_id as string) ?? null,
    decision: json.parse(r.decision, null),
    feedback: json.parse(r.feedback, []),
    derivedFrom: json.parse(r.derived_from, []),
    demo: r.demo === 1,
    createdAt: r.created_at as number,
  };
}

function toRow(e: NormalizedEvent) {
  return {
    id: e.id,
    provider: e.provider,
    providerEventId: e.providerEventId,
    timestamp: e.timestamp,
    endTimestamp: e.endTimestamp,
    cameraId: e.cameraId,
    zoneId: e.zoneId,
    eventType: e.eventType,
    providerType: e.providerType,
    summary: e.summary,
    observations: JSON.stringify(e.observations),
    inference: json.str(e.inference),
    confidence: e.confidence,
    severity: e.severity,
    association: json.str(e.association),
    householdProfileId: e.householdProfileId,
    evidenceReference: json.str(e.evidenceReference),
    signals: JSON.stringify(e.signals),
    ruleId: e.ruleId,
    decision: json.str(e.decision),
    feedback: JSON.stringify(e.feedback),
    derivedFrom: JSON.stringify(e.derivedFrom),
    demo: e.demo ? 1 : 0,
    createdAt: e.createdAt,
  };
}

export async function insertEvent(e: NormalizedEvent): Promise<NormalizedEvent> {
  const valid = NormalizedEventSchema.parse(e);
  await (await getDb()).run(
      `INSERT INTO events (id, provider, provider_event_id, timestamp, end_timestamp, camera_id, zone_id, event_type, provider_type,
         summary, observations, inference, confidence, severity, association, household_profile_id, evidence_reference, signals,
         rule_id, decision, feedback, derived_from, demo, created_at)
       VALUES (@id, @provider, @providerEventId, @timestamp, @endTimestamp, @cameraId, @zoneId, @eventType, @providerType,
         @summary, @observations, @inference, @confidence, @severity, @association, @householdProfileId, @evidenceReference, @signals,
         @ruleId, @decision, @feedback, @derivedFrom, @demo, @createdAt)`,
    toRow(valid),
  );
  return valid;
}

export async function updateEvent(e: NormalizedEvent): Promise<NormalizedEvent> {
  const valid = NormalizedEventSchema.parse(e);
  await (await getDb()).run(
      `UPDATE events SET end_timestamp = @endTimestamp, event_type = @eventType, summary = @summary, observations = @observations,
         inference = @inference, confidence = @confidence, severity = @severity, association = @association,
         household_profile_id = @householdProfileId, evidence_reference = @evidenceReference, signals = @signals,
         rule_id = @ruleId, decision = @decision, feedback = @feedback WHERE id = @id`,
    toRow(valid),
  );
  return valid;
}

export async function getEvent(id: string): Promise<NormalizedEvent | null> {
  const r = await (await getDb()).get("SELECT * FROM events WHERE id = ?", [id]);
  return r ? toEvent(r) : null;
}

export async function findByProviderEventId(provider: ProviderId, providerEventId: string): Promise<NormalizedEvent | null> {
  const r = await (await getDb()).get("SELECT * FROM events WHERE provider = ? AND provider_event_id = ?", [provider, providerEventId]);
  return r ? toEvent(r) : null;
}

/** Same-camera event of a compatible type within ±toleranceMs (webhook vs. history duplicates). */
export async function findNearDuplicate(
  provider: ProviderId,
  cameraId: string,
  types: EventCategory[],
  timestamp: number,
  toleranceMs: number,
): Promise<NormalizedEvent | null> {
  if (types.length === 0) return null;
  const r = await (await getDb()).get(
      `SELECT * FROM events WHERE provider = ? AND camera_id = ? AND event_type IN (${types.map(() => "?").join(",")})
       AND timestamp BETWEEN ? AND ? ORDER BY ABS(timestamp - ?) LIMIT 1`,
    [provider, cameraId, ...types, timestamp - toleranceMs, timestamp + toleranceMs, timestamp],
  );
  return r ? toEvent(r) : null;
}

export interface EventFilter {
  from?: number;
  to?: number;
  cameraId?: string;
  profileId?: string;
  categories?: EventCategory[];
  severities?: Severity[];
  includeDemo?: boolean;
  q?: string;
  limit?: number;
  offset?: number;
}

export async function listEvents(f: EventFilter = {}): Promise<{ events: NormalizedEvent[]; total: number }> {
  const db = await getDb();
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (clause: string, value: unknown) => {
    where.push(clause);
    params.push(value);
  };
  if (f.from) add("timestamp >= ?", f.from);
  if (f.to) add("timestamp < ?", f.to);
  if (f.cameraId) add("camera_id = ?", f.cameraId);
  if (f.profileId) add("household_profile_id = ?", f.profileId);
  if (f.categories?.length) {
    where.push(`event_type IN (${f.categories.map(() => "?").join(",")})`);
    params.push(...f.categories);
  }
  if (f.severities?.length) {
    where.push(`severity IN (${f.severities.map(() => "?").join(",")})`);
    params.push(...f.severities);
  }
  if (f.includeDemo === false) where.push("demo = 0");
  // SQLite LIKE is case-insensitive for ASCII; match that on Postgres.
  if (f.q) add(`summary ${db.dialect === "postgres" ? "ILIKE" : "LIKE"} ? ESCAPE '\\'`, `%${f.q.replace(/[\\%_]/g, (c) => "\\" + c)}%`);
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = (await db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM events ${clause}`, params))!.n;
  const rows = await db.all(`SELECT * FROM events ${clause} ORDER BY timestamp DESC LIMIT ? OFFSET ?`, [
    ...params,
    f.limit ?? 50,
    f.offset ?? 0,
  ]);
  return { events: rows.map(toEvent), total };
}

export async function recentEventsAtCamera(cameraId: string, since: number, types: EventCategory[]): Promise<NormalizedEvent[]> {
  const rows = await (await getDb()).all(
      `SELECT * FROM events WHERE camera_id = ? AND timestamp >= ? AND event_type IN (${types.map(() => "?").join(",")})
       ORDER BY timestamp ASC`,
    [cameraId, since, ...types],
  );
  return rows.map(toEvent);
}

export async function eventCategoriesPresent(): Promise<EventCategory[]> {
  const rows = await (await getDb()).all<{ event_type: EventCategory }>("SELECT DISTINCT event_type FROM events");
  return rows.map((r) => r.event_type);
}
