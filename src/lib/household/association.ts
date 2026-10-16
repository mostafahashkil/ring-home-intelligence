/**
 * Household association. This app has NO face recognition or biometric matching.
 * An event can be linked to a household profile in exactly two ways:
 *  - user_confirmed: a signed-in household member labels the event ("This was Emily").
 *  - demo_simulated: a fabricated signal used only by the demo provider to illustrate the experience.
 * Automated (demo) associations require the profile to be enabled with consent granted.
 * Manual labels require the profile to be enabled and consent not withdrawn.
 */
import { Association, NormalizedEvent, Profile } from "../domain/types";

export function canAutoAssociate(profile: Profile): boolean {
  return profile.enabled && profile.consentStatus === "granted";
}

export function canManuallyAssociate(profile: Profile): boolean {
  return profile.enabled && profile.consentStatus !== "withdrawn";
}

/** An association that still awaits a person's review (resolved once someone confirms or removes it). */
export function isUncertain(event: Pick<NormalizedEvent, "association" | "decision">): boolean {
  const a = event.association;
  if (!a || a.method === "user_confirmed") return false;
  return a.status === "uncertain" || event.decision?.channel === "review";
}

export function arrivalSummary(profile: Profile, association: Association): string {
  if (association.status === "uncertain") return `${profile.displayName} may have arrived — match uncertain`;
  return `${profile.displayName} arrived home`;
}

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Apply a demo-simulated association. Returns the event unchanged if the profile isn't eligible. */
export function applySimulatedMatch(
  event: NormalizedEvent,
  profile: Profile | undefined,
  matchConfidence: number,
  reviewThreshold: number,
): NormalizedEvent {
  if (!event.demo || !profile || !canAutoAssociate(profile)) {
    return event.eventType === "arrival" ? toUnidentified(event) : event;
  }
  const association: Association = {
    profileId: profile.id,
    method: "demo_simulated",
    confidence: matchConfidence,
    status: matchConfidence >= reviewThreshold ? "confirmed" : "uncertain",
  };
  return {
    ...event,
    eventType: "arrival",
    association,
    householdProfileId: profile.id,
    summary: arrivalSummary(profile, association),
  };
}

export function applyUserConfirmation(event: NormalizedEvent, profile: Profile): NormalizedEvent {
  if (!canManuallyAssociate(profile)) throw new Error("This profile can't be associated (disabled or consent withdrawn).");
  if (!["visitor", "arrival", "doorbell", "package"].includes(event.eventType)) {
    throw new Error("Only person-related events can be labeled with a household member.");
  }
  const association: Association = { profileId: profile.id, method: "user_confirmed", confidence: null, status: "confirmed" };
  return {
    ...event,
    eventType: "arrival",
    association,
    householdProfileId: profile.id,
    summary: arrivalSummary(profile, association),
  };
}

/** Remove any association: the person is described as not identified. */
export function toUnidentified(event: NormalizedEvent, note?: string): NormalizedEvent {
  return {
    ...event,
    eventType: event.eventType === "arrival" ? "visitor" : event.eventType,
    association: null,
    householdProfileId: null,
    summary:
      event.eventType === "arrival"
        ? `Person detected${note ? ` (${note})` : ""} — not identified`
        : event.summary,
  };
}
