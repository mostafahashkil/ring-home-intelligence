import { Decision, NormalizedEvent, Profile } from "../domain/types";
import { formatTime } from "../util/time";

/** Short, calm notification copy. Uncertain matches are phrased as questions, never as identifications. */
export function composeNotification(
  event: Pick<NormalizedEvent, "summary" | "timestamp" | "eventType" | "severity">,
  decision: Pick<Decision, "channel" | "requiresConfirmation" | "emergencyGuidance">,
  profile: Profile | undefined,
  cameraName: string,
  timeZone: string,
): { title: string; body: string } {
  const where = `${cameraName} · ${formatTime(event.timestamp, timeZone)}`;
  if (decision.channel === "review") {
    const name = profile?.displayName ?? "A household member";
    return { title: `${name} may have arrived — match uncertain. Review event.`, body: where };
  }
  let body = where;
  if (decision.emergencyGuidance) {
    body += " · If anyone is in danger, contact local emergency services yourself.";
  } else if (decision.requiresConfirmation) {
    body += " · Review the event before taking any action.";
  }
  return { title: event.summary, body };
}
