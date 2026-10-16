/**
 * Behavior-based safety detection. Looks only at observable event patterns — never at who
 * someone appears to be. Every finding is phrased neutrally and states its basis.
 *
 * Supported with Ring data:
 *  - repeat_visits: several unidentified-person / doorbell events at one camera within a window.
 *  - prolonged_activity: a person event lasting longer than the configured threshold
 *    (needs an end time, which Ring's Event History provides).
 * Demo-only (Ring's API does not report these):
 *  - door_handle_attempts, camera_obstruction.
 */
import { NormalizedEvent, Settings, Severity } from "../domain/types";

export type BehaviorKind = "repeat_visits" | "prolonged_activity" | "door_handle_attempts" | "camera_obstruction";

export interface BehaviorFinding {
  kind: BehaviorKind;
  severity: Severity;
  summary: string;
  observations: string[];
  basis: string;
}

const VISIT_TYPES = new Set(["visitor", "doorbell"]);

export function detectBehavior(
  event: NormalizedEvent,
  recentAtCamera: NormalizedEvent[],
  settings: Pick<Settings, "behavior">,
  cameraName: string,
): BehaviorFinding[] {
  const out: BehaviorFinding[] = [];
  const b = settings.behavior;

  if (event.eventType === "visitor" && event.endTimestamp) {
    const seconds = Math.round((event.endTimestamp - event.timestamp) / 1000);
    if (seconds >= b.loiterSeconds) {
      out.push({
        kind: "prolonged_activity",
        severity: "attention",
        summary: `Prolonged activity near ${cameraName}`,
        observations: [`Activity lasted about ${formatDuration(seconds)}.`],
        basis: `Activity longer than your ${formatDuration(b.loiterSeconds)} threshold. Duration alone doesn't indicate intent.`,
      });
    }
  }

  if (VISIT_TYPES.has(event.eventType)) {
    const windowStart = event.timestamp - b.repeatVisitsWindowMinutes * 60_000;
    const visits = recentAtCamera.filter(
      (e) => VISIT_TYPES.has(e.eventType) && e.timestamp >= windowStart && e.timestamp <= event.timestamp && e.id !== event.id,
    );
    const alreadyFlagged = recentAtCamera.some(
      (e) => e.eventType === "behavior" && e.signals.includes("repeat_visits") && e.timestamp >= windowStart,
    );
    const count = visits.length + 1;
    if (count >= b.repeatVisitsCount && !alreadyFlagged) {
      out.push({
        kind: "repeat_visits",
        severity: "attention",
        summary: `Repeated visits at ${cameraName}`,
        observations: [`${count} unidentified-person or doorbell events within ${b.repeatVisitsWindowMinutes} minutes.`],
        basis: `Meets your threshold of ${b.repeatVisitsCount} visits in ${b.repeatVisitsWindowMinutes} min. Could be routine (e.g. deliveries, neighbors).`,
      });
    }
  }

  if (event.demo && event.signals.includes("door_handle_attempts")) {
    out.push({
      kind: "door_handle_attempts",
      severity: "high",
      summary: `Repeated attempts to open the door at ${cameraName}`,
      observations: ["Door handle was tried several times within a minute (demo signal)."],
      basis: "Demo-only signal. Ring's partner API does not report door-handle activity.",
    });
  }
  if (event.demo && event.signals.includes("camera_obstruction")) {
    out.push({
      kind: "camera_obstruction",
      severity: "high",
      summary: `${cameraName} view appears obstructed`,
      observations: ["Camera view became mostly covered (demo signal)."],
      basis: "Demo-only signal. Ring's partner API does not report tampering.",
    });
  }
  return out;
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s ? `${m} min ${s} s` : `${m} min`;
}
