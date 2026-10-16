import { describe, expect, it } from "vitest";
import { evaluate, findConflicts, needsReview, ruleMatches, EngineInput } from "@/lib/rules/engine";
import { at, event, NOON, profile, rule, settings } from "./helpers";

const base = (over: Partial<EngineInput> = {}): EngineInput => ({
  event: event(),
  rules: [],
  profiles: [],
  settings,
  recent: [],
  now: NOON,
  ...over,
});

describe("rule matching", () => {
  it("matches on category, camera, profile, severity and confidence", () => {
    const r = rule({ id: "r", action: "push", categories: ["package"], cameraIds: ["cam_front"], minConfidence: 0.7 });
    expect(ruleMatches(r, base({ event: event({ eventType: "package", confidence: 0.8 }) })).ok).toBe(true);
    expect(ruleMatches(r, base({ event: event({ eventType: "package", confidence: 0.6 }) })).reason).toBe("confidence");
    expect(ruleMatches(r, base({ event: event({ eventType: "package", confidence: null }) })).reason).toBe("confidence");
    expect(ruleMatches(r, base({ event: event({ eventType: "visitor", confidence: 0.9 }) })).reason).toBe("category");
    expect(ruleMatches(r, base({ event: event({ eventType: "package", confidence: 0.9, cameraId: "cam_back" }) })).reason).toBe("camera");
    const sev = rule({ id: "s", action: "push", minSeverity: "attention" });
    expect(ruleMatches(sev, base({ event: event({ severity: "low" }) })).ok).toBe(false);
    expect(ruleMatches(sev, base({ event: event({ severity: "high" }) })).ok).toBe(true);
  });

  it("respects time windows that wrap midnight", () => {
    const night = rule({ id: "n", action: "push", timeWindow: { start: "22:00", end: "06:00" } });
    expect(ruleMatches(night, base({ event: event({ timestamp: at(23) }) })).ok).toBe(true);
    expect(ruleMatches(night, base({ event: event({ timestamp: at(3) }) })).ok).toBe(true);
    expect(ruleMatches(night, base({ event: event({ timestamp: at(12) }) })).reason).toBe("time_window");
  });

  it("ignores disabled rules", () => {
    expect(ruleMatches(rule({ id: "d", action: "push", enabled: false }), base()).ok).toBe(false);
  });
});

describe("evaluate", () => {
  it("logs quietly when no rule matches", () => {
    const d = evaluate(base());
    expect(d.channel).toBe("quiet_log");
    expect(d.ruleId).toBeNull();
    expect(d.explanation[0]).toMatch(/No rule matched/);
  });

  it("picks the highest-priority rule deterministically and explains why", () => {
    const rules = [
      rule({ id: "b", action: "quiet_log", priority: 10, categories: ["package"] }),
      rule({ id: "a", action: "push", priority: 50, categories: ["package"], cameraIds: ["cam_front"], name: "Front packages" }),
    ];
    const d = evaluate(base({ event: event({ eventType: "package" }), rules, cameraName: () => "Front door" }));
    expect(d.channel).toBe("push");
    expect(d.ruleId).toBe("a");
    expect(d.matchedRuleIds).toEqual(["a", "b"]);
    expect(d.explanation[0]).toContain('Rule "Front packages"');
    expect(d.explanation[0]).toContain("at Front door");
    // Same priority → tie broken by id, regardless of input order.
    const tied = [rule({ id: "z", action: "quiet_log" }), rule({ id: "m", action: "push" })];
    expect(evaluate(base({ rules: tied })).ruleId).toBe("m");
    expect(evaluate(base({ rules: [...tied].reverse() })).ruleId).toBe("m");
  });

  it("uses the response ladder for behavior events with no rule", () => {
    const d = evaluate(base({ event: event({ eventType: "behavior", severity: "attention" }) }));
    expect(d.channel).toBe(settings.ladder.attention);
  });

  it("asks for confirmation on higher-concern events and never auto-acts", () => {
    const d = evaluate(base({ event: event({ eventType: "behavior", severity: "high" }) }));
    expect(d.requiresConfirmation).toBe(true);
    const routine = evaluate(base({ rules: [rule({ id: "r", action: "security_routine" })] }));
    expect(routine.requiresConfirmation).toBe(true);
    expect(routine.explanation.join(" ")).toMatch(/never run automatically/);
  });

  it("shows emergency guidance without contacting anyone", () => {
    const d = evaluate(base({ event: event({ eventType: "behavior", severity: "emergency" }) }));
    expect(d.channel).toBe("push");
    expect(d.emergencyGuidance).toBe(true);
    expect(d.explanation.join(" ")).toMatch(/Nothing is contacted automatically/);
  });
});

describe("uncertain household matches", () => {
  const jack = profile({ id: "p_jack", displayName: "Jack" });
  const arrival = (confidence: number, status: "confirmed" | "uncertain" = "confirmed") =>
    event({
      eventType: "arrival",
      householdProfileId: "p_jack",
      association: { profileId: "p_jack", method: "demo_simulated", confidence, status },
    });
  const rules = [rule({ id: "arr", action: "push", categories: ["arrival"] })];

  it("routes below-threshold matches to review instead of announcing an arrival", () => {
    const d = evaluate(base({ event: arrival(0.58), rules, profiles: [jack] }));
    expect(d.channel).toBe("review");
    expect(d.explanation[0]).toMatch(/58% < 80%/);
  });

  it("announces matches at or above the threshold", () => {
    expect(evaluate(base({ event: arrival(0.8), rules, profiles: [jack] })).channel).toBe("push");
  });

  it("honors a per-profile threshold", () => {
    const strict = { ...jack, reviewThreshold: 0.95 };
    expect(evaluate(base({ event: arrival(0.9), rules, profiles: [strict] })).channel).toBe("review");
  });

  it("always reviews associations explicitly marked uncertain", () => {
    expect(needsReview(arrival(0.99, "uncertain"), jack, settings)).toBe(true);
  });

  it("never reviews user-confirmed associations", () => {
    const e = event({ eventType: "arrival", householdProfileId: "p_jack", association: { profileId: "p_jack", method: "user_confirmed", confidence: null, status: "confirmed" } });
    expect(evaluate(base({ event: e, rules, profiles: [jack] })).channel).toBe("push");
  });
});

describe("household preferences", () => {
  const rules = [rule({ id: "arr", action: "push", categories: ["arrival"] })];
  const confirmed = (pid: string, over = {}) =>
    event({ eventType: "arrival", householdProfileId: pid, association: { profileId: pid, method: "user_confirmed", confidence: null, status: "confirmed" }, ...over });

  it("quiet-log and suppress-routine modes keep arrivals out of alerts", () => {
    for (const mode of ["quiet_log", "suppress_routine"] as const) {
      const p = profile({ id: "p", displayName: "Emily", notifyMode: mode });
      const d = evaluate(base({ event: confirmed("p"), rules, profiles: [p] }));
      expect(d.channel).toBe("quiet_log");
      expect(d.suppressedBy).toBe("profile_preference");
    }
  });

  it("limits alerts to selected cameras and time windows", () => {
    const p = profile({ id: "p", displayName: "Sarah", cameraIds: ["cam_drive"] });
    expect(evaluate(base({ event: confirmed("p"), rules, profiles: [p] })).channel).toBe("quiet_log");
    expect(evaluate(base({ event: confirmed("p", { cameraId: "cam_drive" }), rules, profiles: [p] })).channel).toBe("push");
    const w = profile({ id: "w", displayName: "Alex", activeWindow: { start: "16:00", end: "20:00" } });
    expect(evaluate(base({ event: confirmed("w"), rules, profiles: [w] })).channel).toBe("quiet_log");
    expect(evaluate(base({ event: confirmed("w", { timestamp: at(17) }), rules, profiles: [w] })).channel).toBe("push");
  });
});

describe("quiet hours, dedup and cooldown", () => {
  const pushAll = [rule({ id: "all", action: "push" })];

  it("downgrades push to in-app during quiet hours unless severity is high", () => {
    const s = { ...settings, quietHours: { enabled: true, start: "22:00", end: "06:00" } };
    const night = event({ timestamp: at(23, 30) });
    const d = evaluate(base({ event: night, rules: pushAll, settings: s }));
    expect(d.channel).toBe("in_app");
    expect(d.suppressedBy).toBe("quiet_hours");
    const urgent = evaluate(base({ event: { ...night, severity: "high" }, rules: pushAll, settings: s }));
    expect(urgent.channel).toBe("push");
  });

  it("deduplicates repeat notifications for the same category/camera/profile", () => {
    const recent = [{ channel: "push" as const, dedupKey: "motion|cam_front|-", createdAt: NOON - 5 * 60_000 }];
    const d = evaluate(base({ rules: pushAll, recent }));
    expect(d.channel).toBe("quiet_log");
    expect(d.suppressedBy).toBe("dedup");
    // Outside the window → delivered.
    const old = [{ ...recent[0]!, createdAt: NOON - 30 * 60_000 }];
    expect(evaluate(base({ rules: pushAll, recent: old })).channel).toBe("push");
    // Different camera → delivered.
    expect(evaluate(base({ rules: pushAll, recent, event: event({ cameraId: "cam_back" }) })).channel).toBe("push");
  });

  it("caps push storms with a cooldown", () => {
    const recent = Array.from({ length: settings.cooldown.maxPush }, (_, i) => ({
      channel: "push" as const,
      dedupKey: `other|${i}|-`,
      createdAt: NOON - i * 60_000,
    }));
    const d = evaluate(base({ rules: pushAll, recent }));
    expect(d.channel).toBe("in_app");
    expect(d.suppressedBy).toBe("cooldown");
  });

  it("conflicting rules cannot multiply notifications: one event → one decision", () => {
    const rules = [rule({ id: "a", action: "push", priority: 50 }), rule({ id: "b", action: "push", priority: 50 }), rule({ id: "c", action: "in_app", priority: 50 })];
    const d = evaluate(base({ rules }));
    expect(d.matchedRuleIds).toHaveLength(3);
    expect(typeof d.channel).toBe("string");
  });
});

describe("findConflicts", () => {
  it("flags overlapping rules with different actions", () => {
    const rules = [
      rule({ id: "a", action: "push", priority: 50, categories: ["package"] }),
      rule({ id: "b", action: "quiet_log", priority: 50, categories: ["package"], cameraIds: ["cam_front"] }),
      rule({ id: "c", action: "push", categories: ["visitor"] }),
    ];
    const conflicts = findConflicts(rules);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.note).toMatch(/Same priority/);
  });
});
