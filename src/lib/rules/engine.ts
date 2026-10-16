/**
 * Deterministic notification rules engine. Pure: no I/O, no clock reads, no randomness.
 * Given the same inputs it always returns the same decision, which makes it testable
 * and lets the UI show exactly why a notification was (or wasn't) sent.
 *
 * Order of evaluation:
 *  1. Uncertain household matches → "review" (never turned into an identity claim).
 *  2. Matching rules (category, camera, profile, confidence, severity, time window).
 *     Highest priority wins; ties broken by rule id for determinism.
 *  3. No match → severity ladder for behavior events, quiet log otherwise.
 *  4. Household profile preferences (quiet log, suppress routine, camera/time limits).
 *  5. Quiet hours (push → in-app unless severity is high or emergency).
 *  6. Deduplication (same category/camera/profile within window → quiet log).
 *  7. Cooldown / storm control (too many pushes in window → in-app).
 */
import {
  CATEGORY_LABELS,
  Decision,
  NormalizedEvent,
  Profile,
  Rule,
  RULE_ACTION_LABELS,
  SEVERITY_LABELS,
  SEVERITY_RANK,
  Settings,
} from "../domain/types";
import { inWindow } from "../util/time";

export interface RecentDelivery {
  channel: Decision["channel"];
  dedupKey: string | null;
  createdAt: number;
}

export interface EngineInput {
  event: Pick<
    NormalizedEvent,
    "eventType" | "cameraId" | "householdProfileId" | "association" | "confidence" | "severity" | "timestamp"
  >;
  rules: Rule[];
  profiles: Profile[];
  settings: Pick<Settings, "timezone" | "quietHours" | "dedupWindowMinutes" | "cooldown" | "defaultReviewThreshold" | "ladder">;
  recent: RecentDelivery[];
  now: number;
  cameraName?: (id: string) => string;
}

export function dedupKey(event: EngineInput["event"]): string {
  return [event.eventType, event.cameraId ?? "-", event.householdProfileId ?? "-"].join("|");
}

/** Effective confidence for a household association, or null when there is none. */
export function associationConfidence(event: EngineInput["event"]): number | null {
  if (!event.association) return null;
  if (event.association.method === "user_confirmed") return 1;
  return event.association.confidence;
}

export function reviewThresholdFor(profile: Profile | undefined, settings: EngineInput["settings"]): number {
  return profile?.reviewThreshold ?? settings.defaultReviewThreshold;
}

/** True when an association must be reviewed by a person before being presented as an arrival. */
export function needsReview(event: EngineInput["event"], profile: Profile | undefined, settings: EngineInput["settings"]) {
  if (!event.association) return false;
  if (event.association.method === "user_confirmed") return false;
  if (event.association.status === "uncertain") return true;
  const c = associationConfidence(event);
  return c === null || c < reviewThresholdFor(profile, settings);
}

export function ruleMatches(rule: Rule, input: EngineInput): { ok: boolean; reason?: string } {
  const { event, settings } = input;
  if (!rule.enabled) return { ok: false, reason: "disabled" };
  if (rule.categories.length && !rule.categories.includes(event.eventType)) return { ok: false, reason: "category" };
  if (rule.cameraIds.length && (!event.cameraId || !rule.cameraIds.includes(event.cameraId)))
    return { ok: false, reason: "camera" };
  if (rule.profileIds.length && (!event.householdProfileId || !rule.profileIds.includes(event.householdProfileId)))
    return { ok: false, reason: "profile" };
  if (rule.minConfidence !== null) {
    const c = event.association ? associationConfidence(event) : event.confidence;
    if (c === null || c < rule.minConfidence) return { ok: false, reason: "confidence" };
  }
  if (rule.minSeverity && SEVERITY_RANK[event.severity] < SEVERITY_RANK[rule.minSeverity])
    return { ok: false, reason: "severity" };
  if (rule.timeWindow && !inWindow(event.timestamp, rule.timeWindow, settings.timezone))
    return { ok: false, reason: "time_window" };
  return { ok: true };
}

export function sortRules(rules: Rule[]): Rule[] {
  return [...rules].sort((a, b) => b.priority - a.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function describeRule(rule: Rule, input: EngineInput): string {
  const parts: string[] = [];
  parts.push(rule.categories.length ? rule.categories.map((c) => CATEGORY_LABELS[c].toLowerCase()).join(" / ") : "any event");
  if (rule.cameraIds.length) {
    const names = rule.cameraIds.map((id) => input.cameraName?.(id) ?? id);
    parts.push(`at ${names.join(", ")}`);
  }
  return `Rule "${rule.name}": ${RULE_ACTION_LABELS[rule.action].toLowerCase()} on ${parts.join(" ")}`;
}

export function evaluate(input: EngineInput): Decision {
  const { event, settings } = input;
  const explanation: string[] = [];
  const profile = event.householdProfileId ? input.profiles.find((p) => p.id === event.householdProfileId) : undefined;
  let suppressedBy: Decision["suppressedBy"] = null;
  let saveClip = false;
  let requiresConfirmation = false;
  const emergencyGuidance = event.severity === "emergency";

  const matched = sortRules(input.rules.filter((r) => ruleMatches(r, input).ok));
  const winner = matched[0] ?? null;

  // 1. Uncertain match → ask a person to review. Never auto-promote to an identity claim.
  if (needsReview(event, profile, settings)) {
    const c = associationConfidence(event);
    explanation.push(
      `Possible match${profile ? ` with ${profile.displayName}` : ""} is below the review threshold` +
        (c !== null ? ` (${Math.round(c * 100)}% < ${Math.round(reviewThresholdFor(profile, settings) * 100)}%)` : "") +
        " — asking for review instead of announcing an arrival.",
    );
    return {
      channel: "review",
      ruleId: winner?.id ?? null,
      matchedRuleIds: matched.map((r) => r.id),
      explanation,
      suppressedBy: null,
      saveClip: false,
      requiresConfirmation: false,
      emergencyGuidance,
    };
  }

  // 2/3. Rule or default.
  let channel: Decision["channel"];
  if (winner) {
    explanation.push(describeRule(winner, input) + ".");
    if (matched.length > 1) {
      explanation.push(
        `${matched.length - 1} other matching rule${matched.length > 2 ? "s" : ""} had lower priority and did not fire.`,
      );
    }
    switch (winner.action) {
      case "push":
        channel = "push";
        break;
      case "in_app":
        channel = "in_app";
        break;
      case "quiet_log":
        channel = "quiet_log";
        break;
      case "save_clip":
        channel = "in_app";
        saveClip = true;
        explanation.push("Clip reference kept with the event (media stays with the camera provider).");
        break;
      case "security_routine":
        channel = "push";
        requiresConfirmation = true;
        explanation.push(
          "Security routines never run automatically from an AI classification — you'll be asked to confirm. " +
            "No supported routine is currently connected.",
        );
        break;
    }
  } else if (event.eventType === "behavior") {
    channel = settings.ladder[event.severity];
    explanation.push(`No rule matched — using the response ladder for "${SEVERITY_LABELS[event.severity]}".`);
  } else {
    channel = "quiet_log";
    explanation.push("No rule matched — logged quietly to keep notifications low.");
  }

  // Ladder step 3: higher-concern events never trigger routines on their own — the person confirms.
  if (event.severity === "high" && !requiresConfirmation) {
    requiresConfirmation = true;
    explanation.push("Higher-concern event: any follow-up action waits for your confirmation.");
  }
  if (emergencyGuidance) {
    channel = "push";
    explanation.push(
      "Emergency-level event: you'll see guidance to contact local emergency services yourself. Nothing is contacted automatically.",
    );
  }

  // 4. Household preferences.
  if (profile && event.eventType === "arrival" && channel !== "quiet_log") {
    if (profile.notifyMode === "quiet_log") {
      channel = "quiet_log";
      suppressedBy = "profile_preference";
      explanation.push(`${profile.displayName}'s preference: log arrivals quietly.`);
    } else if (profile.notifyMode === "suppress_routine") {
      channel = "quiet_log";
      suppressedBy = "profile_preference";
      explanation.push(`${profile.displayName}'s routine arrivals are suppressed.`);
    } else if (profile.cameraIds?.length && event.cameraId && !profile.cameraIds.includes(event.cameraId)) {
      channel = "quiet_log";
      suppressedBy = "profile_preference";
      explanation.push(`${profile.displayName} only alerts for selected cameras.`);
    } else if (profile.activeWindow && !inWindow(event.timestamp, profile.activeWindow, settings.timezone)) {
      channel = "quiet_log";
      suppressedBy = "profile_preference";
      explanation.push(
        `${profile.displayName} only alerts between ${profile.activeWindow.start} and ${profile.activeWindow.end}.`,
      );
    }
  }

  const highOrAbove = SEVERITY_RANK[event.severity] >= SEVERITY_RANK.high;

  // 5. Quiet hours.
  if (channel === "push" && settings.quietHours.enabled && !highOrAbove) {
    if (inWindow(event.timestamp, settings.quietHours, settings.timezone)) {
      channel = "in_app";
      suppressedBy = "quiet_hours";
      explanation.push(
        `Quiet hours (${settings.quietHours.start}–${settings.quietHours.end}): sent in-app instead of a push alert.`,
      );
    }
  }

  // 6. Deduplication.
  const key = dedupKey(event);
  if ((channel === "push" || channel === "in_app") && settings.dedupWindowMinutes > 0) {
    const since = input.now - settings.dedupWindowMinutes * 60_000;
    const dup = input.recent.find(
      (r) => r.dedupKey === key && r.createdAt >= since && (r.channel === "push" || r.channel === "in_app"),
    );
    if (dup && !highOrAbove) {
      channel = "quiet_log";
      suppressedBy = "dedup";
      explanation.push(`A similar notification was sent within the last ${settings.dedupWindowMinutes} min — logged quietly.`);
    }
  }

  // 7. Cooldown / storm control.
  if (channel === "push") {
    const since = input.now - settings.cooldown.windowMinutes * 60_000;
    const pushes = input.recent.filter((r) => r.channel === "push" && r.createdAt >= since).length;
    if (pushes >= settings.cooldown.maxPush && !highOrAbove) {
      channel = "in_app";
      suppressedBy = "cooldown";
      explanation.push(
        `Cooldown: ${pushes} push alerts in the last ${settings.cooldown.windowMinutes} min — sent in-app instead.`,
      );
    }
  }

  return {
    channel,
    ruleId: winner?.id ?? null,
    matchedRuleIds: matched.map((r) => r.id),
    explanation,
    suppressedBy,
    saveClip,
    requiresConfirmation,
    emergencyGuidance,
  };
}

/** Pairs of rules that both match the same scope but disagree on the action. Shown as warnings in the UI. */
export function findConflicts(rules: Rule[]): { a: Rule; b: Rule; note: string }[] {
  const active = rules.filter((r) => r.enabled);
  const out: { a: Rule; b: Rule; note: string }[] = [];
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i]!;
      const b = active[j]!;
      if (a.action === b.action) continue;
      const overlap = (x: string[], y: string[]) => x.length === 0 || y.length === 0 || x.some((v) => y.includes(v));
      if (overlap(a.categories, b.categories) && overlap(a.cameraIds, b.cameraIds) && overlap(a.profileIds, b.profileIds)) {
        const [hi, lo] = sortRules([a, b]) as [Rule, Rule];
        out.push({
          a: hi,
          b: lo,
          note:
            hi.priority === lo.priority
              ? `Same priority — "${hi.name}" wins by tie-break. Consider setting different priorities.`
              : `"${hi.name}" (priority ${hi.priority}) overrides "${lo.name}" (priority ${lo.priority}) where they overlap.`,
        });
      }
    }
  }
  return out;
}
