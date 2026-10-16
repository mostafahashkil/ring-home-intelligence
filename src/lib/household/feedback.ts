/**
 * User feedback on events: confirm/correct household associations and label mistakes.
 * Feedback adjusts labels and preferences only — no biometric data is created, stored or trained on.
 */
import { getDb } from "../db";
import { Feedback, NormalizedEvent } from "../domain/types";
import { audit } from "../repo/audit";
import { getEvent, updateEvent } from "../repo/events";
import { getProfile } from "../repo/profiles";
import { applyUserConfirmation, toUnidentified } from "./association";

function withFeedback(e: NormalizedEvent, f: Omit<Feedback, "at">, now: number): NormalizedEvent {
  return { ...e, feedback: [...e.feedback, { ...f, at: now }].slice(-20) };
}

export async function confirmEventProfile(eventId: string, profileId: string, actorId: string, now = Date.now()) {
  const event = await getEvent(eventId);
  const profile = await getProfile(profileId);
  if (!event || !profile) throw new Error("Event or profile not found.");
  if (event.demo !== profile.demo) throw new Error("Demo events can only be labeled with demo profiles (and vice versa).");
  const updated = withFeedback(applyUserConfirmation(event, profile), { label: "confirmed_profile", by: actorId }, now);
  await updateEvent(updated);
  await audit(actorId, "event.association_confirmed", eventId, { profileId, demo: event.demo });
  return updated;
}

export async function rejectEventProfile(eventId: string, actorId: string, now = Date.now()) {
  const event = await getEvent(eventId);
  if (!event) throw new Error("Event not found.");
  const updated = withFeedback(toUnidentified(event), { label: "not_profile", by: actorId }, now);
  await updateEvent(updated);
  await audit(actorId, "event.association_rejected", eventId, { previousProfileId: event.householdProfileId });
  return updated;
}

export async function labelEvent(
  eventId: string,
  label: "not_delivery" | "false_alarm" | "helpful" | "not_helpful",
  actorId: string,
  now = Date.now(),
) {
  const event = await getEvent(eventId);
  if (!event) throw new Error("Event not found.");
  await updateEvent(withFeedback(event, { label, by: actorId }, now));
  await audit(actorId, "event.feedback", eventId, { label });
}

/**
 * Consent withdrawal removes the profile from all past events (they become "not identified")
 * and blocks future associations.
 */
export async function clearProfileAssociations(profileId: string, actorId: string): Promise<number> {
  const ids = await (await getDb()).all<{ id: string }>("SELECT id FROM events WHERE household_profile_id = ?", [profileId]);
  for (const { id } of ids) {
    const e = await getEvent(id);
    if (e) await updateEvent(toUnidentified(e, "association removed"));
  }
  await audit(actorId, "profile.associations_cleared", profileId, { count: ids.length });
  return ids.length;
}
