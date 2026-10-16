import { z } from "zod";

/**
 * Event categories shown to people. A category is only offered in the UI when
 * at least one configured provider supports it (see providers/registry.ts).
 */
export const EVENT_CATEGORIES = [
  "arrival",
  "visitor",
  "package",
  "doorbell",
  "vehicle",
  "motion",
  "behavior",
  "device",
] as const;
export type EventCategory = (typeof EVENT_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<EventCategory, string> = {
  arrival: "Household arrival",
  visitor: "Unrecognized visitor",
  package: "Package activity",
  doorbell: "Doorbell press",
  vehicle: "Vehicle",
  motion: "Motion",
  behavior: "Safety / behavior",
  device: "Camera status",
};

export const SEVERITIES = ["low", "attention", "high", "emergency"] as const;
export type Severity = (typeof SEVERITIES)[number];
export const SEVERITY_RANK: Record<Severity, number> = { low: 0, attention: 1, high: 2, emergency: 3 };
export const SEVERITY_LABELS: Record<Severity, string> = {
  low: "Low concern",
  attention: "Needs attention",
  high: "Higher concern",
  emergency: "Emergency",
};

export const PROVIDER_IDS = ["demo", "ring"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

/** Where an observation came from. "provider" = reported by the camera platform itself. */
export const ObservationSchema = z.object({
  text: z.string().min(1).max(280),
  source: z.enum(["provider", "analysis", "demo", "system"]),
});
export type Observation = z.infer<typeof ObservationSchema>;

/** An inference is always explicitly labeled and never treated as fact. */
export const InferenceSchema = z.object({
  label: z.string().min(1).max(280),
  basis: z.string().max(400),
});
export type Inference = z.infer<typeof InferenceSchema>;

/**
 * Association between an event and a household profile.
 * - user_confirmed: a signed-in household member said who it was.
 * - demo_simulated: a fabricated signal used only in demo mode to illustrate the UX.
 * No biometric or face-recognition method exists in this app.
 */
export const AssociationSchema = z.object({
  profileId: z.string(),
  method: z.enum(["user_confirmed", "demo_simulated"]),
  confidence: z.number().min(0).max(1).nullable(),
  status: z.enum(["confirmed", "uncertain"]),
});
export type Association = z.infer<typeof AssociationSchema>;

export const EvidenceSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("ring_recording"),
    deviceId: z.string(),
    timestamp: z.number().int(),
    durationMs: z.number().int().positive().max(900_000),
    componentId: z.string().nullable(),
  }),
  z.object({ kind: z.literal("demo"), note: z.string() }),
]);
export type Evidence = z.infer<typeof EvidenceSchema>;

export const FeedbackSchema = z.object({
  label: z.enum(["confirmed_profile", "not_profile", "not_delivery", "false_alarm", "helpful", "not_helpful"]),
  by: z.string(),
  at: z.number(),
  note: z.string().max(200).optional(),
});
export type Feedback = z.infer<typeof FeedbackSchema>;

export const DecisionSchema = z.object({
  channel: z.enum(["push", "in_app", "quiet_log", "review", "none"]),
  ruleId: z.string().nullable(),
  matchedRuleIds: z.array(z.string()),
  explanation: z.array(z.string()),
  suppressedBy: z.enum(["dedup", "cooldown", "quiet_hours", "profile_preference"]).nullable(),
  saveClip: z.boolean(),
  requiresConfirmation: z.boolean(),
  emergencyGuidance: z.boolean(),
});
export type Decision = z.infer<typeof DecisionSchema>;

/** Normalized event — the common schema every provider maps into. */
export const NormalizedEventSchema = z.object({
  id: z.string(),
  provider: z.enum(PROVIDER_IDS),
  providerEventId: z.string().nullable(),
  timestamp: z.number().int().positive(),
  endTimestamp: z.number().int().positive().nullable(),
  cameraId: z.string().nullable(),
  zoneId: z.string().nullable(),
  eventType: z.enum(EVENT_CATEGORIES),
  providerType: z.string().nullable(),
  summary: z.string().min(1).max(280),
  observations: z.array(ObservationSchema),
  inference: InferenceSchema.nullable(),
  confidence: z.number().min(0).max(1).nullable(),
  severity: z.enum(SEVERITIES),
  association: AssociationSchema.nullable(),
  householdProfileId: z.string().nullable(),
  evidenceReference: EvidenceSchema.nullable(),
  signals: z.array(z.string()),
  ruleId: z.string().nullable(),
  decision: DecisionSchema.nullable(),
  feedback: z.array(FeedbackSchema),
  derivedFrom: z.array(z.string()),
  demo: z.boolean(),
  createdAt: z.number().int(),
});
export type NormalizedEvent = z.infer<typeof NormalizedEventSchema>;

/**
 * Raw input from a provider adapter, before normalization.
 * `kind` mirrors the event families the Ring Partner API documents.
 */
export const ProviderEventInputSchema = z.object({
  provider: z.enum(PROVIDER_IDS),
  providerEventId: z.string().min(1).max(256),
  timestamp: z.number().int().positive(),
  endTimestamp: z.number().int().positive().nullable().optional(),
  providerDeviceId: z.string().min(1).max(256),
  kind: z.enum(["motion", "doorbell", "device_online", "device_offline", "device_added", "device_removed"]),
  subType: z.string().max(64).nullable().optional(),
  componentIds: z.array(z.string().max(16)).max(8).optional(),
  demo: z.boolean(),
  /** Demo-only enrichments. Ignored for non-demo providers. */
  demoDetails: z
    .object({
      category: z.enum(EVENT_CATEGORIES).optional(),
      summary: z.string().max(280).optional(),
      observations: z.array(z.string().max(280)).optional(),
      inference: InferenceSchema.optional(),
      confidence: z.number().min(0).max(1).optional(),
      severity: z.enum(SEVERITIES).optional(),
      profileName: z.string().optional(),
      matchConfidence: z.number().min(0).max(1).optional(),
      signals: z.array(z.string()).optional(),
    })
    .optional(),
});
export type ProviderEventInput = z.infer<typeof ProviderEventInputSchema>;

export const NOTIFY_MODES = ["each_arrival", "quiet_log", "suppress_routine"] as const;
export type NotifyMode = (typeof NOTIFY_MODES)[number];

export const TimeWindowSchema = z.object({
  start: z.string().regex(/^\d{2}:\d{2}$/),
  end: z.string().regex(/^\d{2}:\d{2}$/),
});
export type TimeWindow = z.infer<typeof TimeWindowSchema>;

export const ProfileSchema = z.object({
  id: z.string(),
  displayName: z.string().min(1).max(40),
  relationship: z.string().max(30).nullable(),
  enabled: z.boolean(),
  consentStatus: z.enum(["granted", "pending", "withdrawn"]),
  notifyMode: z.enum(NOTIFY_MODES),
  cameraIds: z.array(z.string()).nullable(),
  activeWindow: TimeWindowSchema.nullable(),
  reviewThreshold: z.number().min(0).max(1).nullable(),
  demo: z.boolean(),
  createdAt: z.number(),
});
export type Profile = z.infer<typeof ProfileSchema>;

export const RULE_ACTIONS = ["push", "in_app", "quiet_log", "save_clip", "security_routine"] as const;
export type RuleAction = (typeof RULE_ACTIONS)[number];
export const RULE_ACTION_LABELS: Record<RuleAction, string> = {
  push: "Push alert",
  in_app: "In-app notification",
  quiet_log: "Quiet log only",
  save_clip: "Save clip reference + in-app",
  security_routine: "Security routine (asks you to confirm)",
};

export const RuleSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(80),
  enabled: z.boolean(),
  priority: z.number().int().min(0).max(1000),
  categories: z.array(z.enum(EVENT_CATEGORIES)),
  cameraIds: z.array(z.string()),
  profileIds: z.array(z.string()),
  minConfidence: z.number().min(0).max(1).nullable(),
  minSeverity: z.enum(SEVERITIES).nullable(),
  timeWindow: TimeWindowSchema.nullable(),
  action: z.enum(RULE_ACTIONS),
  createdAt: z.number(),
});
export type Rule = z.infer<typeof RuleSchema>;

export const SettingsSchema = z.object({
  timezone: z.string(),
  demoEnabled: z.boolean(),
  hideDemoData: z.boolean(),
  quietHours: z.object({ enabled: z.boolean(), start: z.string(), end: z.string() }),
  dedupWindowMinutes: z.number().int().min(0).max(240),
  cooldown: z.object({ maxPush: z.number().int().min(1).max(100), windowMinutes: z.number().int().min(1).max(240) }),
  defaultReviewThreshold: z.number().min(0).max(1),
  retentionDays: z.number().int().min(1).max(365),
  auditRetentionDays: z.number().int().min(30).max(3650),
  behavior: z.object({
    loiterSeconds: z.number().int().min(30).max(3600),
    repeatVisitsCount: z.number().int().min(2).max(20),
    repeatVisitsWindowMinutes: z.number().int().min(5).max(1440),
  }),
  ladder: z.object({
    low: z.enum(["quiet_log", "in_app"]),
    attention: z.enum(["in_app", "push"]),
    high: z.enum(["push"]),
    emergency: z.enum(["push"]),
  }),
  externalAiEnabled: z.literal(false),
});
export type Settings = z.infer<typeof SettingsSchema>;

export const DEFAULT_SETTINGS: Settings = {
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  demoEnabled: true,
  hideDemoData: false,
  quietHours: { enabled: true, start: "22:30", end: "06:30" },
  dedupWindowMinutes: 10,
  cooldown: { maxPush: 6, windowMinutes: 30 },
  defaultReviewThreshold: 0.8,
  retentionDays: 30,
  auditRetentionDays: 365,
  behavior: { loiterSeconds: 180, repeatVisitsCount: 3, repeatVisitsWindowMinutes: 60 },
  ladder: { low: "quiet_log", attention: "push", high: "push", emergency: "push" },
  externalAiEnabled: false,
};

export interface Camera {
  id: string;
  provider: ProviderId;
  providerDeviceId: string;
  name: string;
  zone: string | null;
  status: "online" | "offline" | "unknown" | "removed";
  supportsClips: boolean;
  componentIds: string[];
  demo: boolean;
  updatedAt: number;
}

export interface NotificationRecord {
  id: string;
  eventId: string | null;
  ruleId: string | null;
  channel: Decision["channel"];
  title: string;
  body: string;
  explanation: string;
  severity: Severity;
  createdAt: number;
  readAt: number | null;
  demo: boolean;
}

export type Role = "owner" | "member";
export interface User {
  id: string;
  email: string;
  role: Role;
  createdAt: number;
}

export interface AuditEntry {
  id: number;
  ts: number;
  actor: string;
  action: string;
  target: string | null;
  details: Record<string, unknown>;
}
