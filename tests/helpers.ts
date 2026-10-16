import { openDb, setDbForTesting } from "@/lib/db";
import { DEFAULT_SETTINGS, NormalizedEvent, Profile, Rule } from "@/lib/domain/types";

export function freshDb() {
  const db = openDb(":memory:");
  setDbForTesting(db);
  return db;
}

export const TZ = "UTC";
export const settings = { ...DEFAULT_SETTINGS, timezone: TZ, quietHours: { enabled: false, start: "22:00", end: "06:00" } };

/** 2026-10-14 12:00 UTC */
export const NOON = Date.UTC(2026, 9, 14, 12, 0, 0);
export const at = (h: number, m = 0) => Date.UTC(2026, 9, 14, h, m, 0);

export function rule(partial: Partial<Rule> & Pick<Rule, "id" | "action">): Rule {
  return {
    name: partial.id,
    enabled: true,
    priority: 50,
    categories: [],
    cameraIds: [],
    profileIds: [],
    minConfidence: null,
    minSeverity: null,
    timeWindow: null,
    createdAt: 0,
    ...partial,
  };
}

export function profile(partial: Partial<Profile> & Pick<Profile, "id" | "displayName">): Profile {
  return {
    relationship: null,
    enabled: true,
    consentStatus: "granted",
    notifyMode: "each_arrival",
    cameraIds: null,
    activeWindow: null,
    reviewThreshold: null,
    demo: false,
    createdAt: 0,
    ...partial,
  };
}

export function event(partial: Partial<NormalizedEvent> = {}): NormalizedEvent {
  return {
    id: "evt_1",
    provider: "ring",
    providerEventId: "p1",
    timestamp: NOON,
    endTimestamp: null,
    cameraId: "cam_front",
    zoneId: null,
    eventType: "motion",
    providerType: null,
    summary: "Motion detected",
    observations: [],
    inference: null,
    confidence: null,
    severity: "low",
    association: null,
    householdProfileId: null,
    evidenceReference: null,
    signals: [],
    ruleId: null,
    decision: null,
    feedback: [],
    derivedFrom: [],
    demo: false,
    createdAt: NOON,
    ...partial,
  };
}
