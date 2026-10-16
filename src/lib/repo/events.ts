import { getDb, json } from "../db";
import { EventCategory, NormalizedEvent, NormalizedEventSchema, ProviderId, Severity } from "../domain/types";

function toEvent(r: Record<string, unknown>): NormalizedEvent {
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

export function insertEvent(e: NormalizedEvent): NormalizedEvent {
  const valid = NormalizedEventSchema.parse(e);
  getDb()
    .prepare(
      `INSERT INTO events (id, provider, provider_event_id, timestamp, end_timestamp, camera_id, zone_id, event_type, provider_type,
         summary, observations, inference, confidence, severity, association, household_profile_id, evidence_reference, signals,
         rule_id, decision, feedback, derived_from, demo, created_at)
       VALUES (@id, @provider, @providerEventId, @timestamp, @endTimestamp, @cameraId, @zoneId, @eventType, @providerType,
         @summary, @observations, @inference, @confidence, @severity, @association, @householdProfileId, @evidenceReference, @signals,
         @ruleId, @decision, @feedback, @derivedFrom, @demo, @createdAt)`,
    )
    .run(toRow(valid));
  return valid;
}

export function updateEvent(e: NormalizedEvent): NormalizedEvent {
  const valid = NormalizedEventSchema.parse(e);
  getDb()
    .prepare(
      `UPDATE events SET end_timestamp = @endTimestamp, event_type = @eventType, summary = @summary, observations = @observations,
         inference = @inference, confidence = @confidence, severity = @severity, association = @association,
         household_profile_id = @householdProfileId, evidence_reference = @evidenceReference, signals = @signals,
         rule_id = @ruleId, decision = @decision, feedback = @feedback WHERE id = @id`,
    )
    .run(toRow(valid));
  return valid;
}

export function getEvent(id: string): NormalizedEvent | null {
  const r = getDb().prepare("SELECT * FROM events WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return r ? toEvent(r) : null;
}

export function findByProviderEventId(provider: ProviderId, providerEventId: string): NormalizedEvent | null {
  const r = getDb()
    .prepare("SELECT * FROM events WHERE provider = ? AND provider_event_id = ?")
    .get(provider, providerEventId) as Record<string, unknown> | undefined;
  return r ? toEvent(r) : null;
}

/** Same-camera event of a compatible type within ±toleranceMs (webhook vs. history duplicates). */
export function findNearDuplicate(
  provider: ProviderId,
  cameraId: string,
  types: EventCategory[],
  timestamp: number,
  toleranceMs: number,
): NormalizedEvent | null {
  if (types.length === 0) return null;
  const r = getDb()
    .prepare(
      `SELECT * FROM events WHERE provider = ? AND camera_id = ? AND event_type IN (${types.map(() => "?").join(",")})
       AND timestamp BETWEEN ? AND ? ORDER BY ABS(timestamp - ?) LIMIT 1`,
    )
    .get(provider, cameraId, ...types, timestamp - toleranceMs, timestamp + toleranceMs, timestamp) as
    | Record<string, unknown>
    | undefined;
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

export function listEvents(f: EventFilter = {}): { events: NormalizedEvent[]; total: number } {
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
  if (f.q) add("summary LIKE ? ESCAPE '\\'", `%${f.q.replace(/[\\%_]/g, (c) => "\\" + c)}%`);
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const db = getDb();
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM events ${clause}`).get(...params) as { n: number }).n;
  const rows = db
    .prepare(`SELECT * FROM events ${clause} ORDER BY timestamp DESC LIMIT ? OFFSET ?`)
    .all(...params, f.limit ?? 50, f.offset ?? 0) as Record<string, unknown>[];
  return { events: rows.map(toEvent), total };
}

export function recentEventsAtCamera(cameraId: string, since: number, types: EventCategory[]): NormalizedEvent[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM events WHERE camera_id = ? AND timestamp >= ? AND event_type IN (${types.map(() => "?").join(",")})
       ORDER BY timestamp ASC`,
    )
    .all(cameraId, since, ...types) as Record<string, unknown>[];
  return rows.map(toEvent);
}

export function eventCategoriesPresent(): EventCategory[] {
  return (getDb().prepare("SELECT DISTINCT event_type FROM events").all() as { event_type: EventCategory }[]).map(
    (r) => r.event_type,
  );
}
