import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertOctagon, ArrowLeft, Eye, HelpCircle, Lightbulb, MessageSquare, Phone, ShieldCheck, Video } from "lucide-react";
import { requireAppUser } from "@/lib/app-context";
import { can } from "@/lib/auth/core";
import { CATEGORY_LABELS } from "@/lib/domain/types";
import { getEvent } from "@/lib/repo/events";
import { getCamera } from "@/lib/repo/cameras";
import { getProfile, listProfiles } from "@/lib/repo/profiles";
import { getRule } from "@/lib/repo/rules";
import { notificationsForEvent } from "@/lib/repo/notifications";
import { getSettings } from "@/lib/repo/settings";
import { canManuallyAssociate, isUncertain } from "@/lib/household/association";
import { formatDateTime, formatTime } from "@/lib/util/time";
import { formatDuration } from "@/lib/behavior/detect";
import { CategoryBadge, ChannelBadge, DemoBadge, ProvenanceTag, SeverityBadge } from "@/components/badges";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Notice, Section } from "@/components/ui";
import { ClipPlayer } from "@/components/ClipPlayer";
import { confirmProfileAction, labelEventAction, rejectProfileAction } from "../../actions";

export const metadata = { title: "Event" };

const FEEDBACK_LABELS: Record<string, string> = {
  confirmed_profile: "Confirmed who it was",
  not_profile: "Removed person label",
  not_delivery: "Marked not a delivery",
  false_alarm: "Marked false alarm",
  helpful: "Marked helpful",
  not_helpful: "Marked not helpful",
};

export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireAppUser();
  const { id } = await params;
  const event = getEvent(id);
  if (!event) notFound();
  const settings = getSettings();
  const tz = settings.timezone;
  const camera = event.cameraId ? getCamera(event.cameraId) : null;
  const profile = event.householdProfileId ? getProfile(event.householdProfileId) : null;
  const rule = event.ruleId ? getRule(event.ruleId) : null;
  const notifications = notificationsForEvent(event.id);
  const canFeedback = can(user.role, "events:feedback");
  const labelable = ["visitor", "arrival", "doorbell", "package"].includes(event.eventType);
  const candidates = listProfiles().filter((p) => p.demo === event.demo && canManuallyAssociate(p));
  const uncertain = isUncertain(event);
  const d = event.decision;
  const duration = event.endTimestamp ? Math.round((event.endTimestamp - event.timestamp) / 1000) : null;

  return (
    <article className="space-y-6">
      <Link href="/activity" className="btn-ghost -ml-3">
        <ArrowLeft aria-hidden className="h-4 w-4" /> Activity
      </Link>

      <header className={`card p-5 ${event.demo ? "demo-stripe" : ""}`}>
        <div className="mb-3 flex flex-wrap gap-1.5">
          {event.demo && <DemoBadge label="Demo event — sample data" />}
          <CategoryBadge category={event.eventType} />
          <SeverityBadge severity={event.severity} />
          {uncertain && <ProvenanceTag kind="uncertain" />}
          {event.association?.method === "user_confirmed" && <ProvenanceTag kind="confirmed" />}
        </div>
        <h1 className="text-xl font-semibold leading-snug sm:text-2xl">{event.summary}</h1>
        <p className="mt-1 text-sm text-muted">
          {camera?.name ?? "Unknown camera"}
          {camera?.zone && camera.zone !== camera.name ? ` · ${camera.zone}` : ""} · {formatDateTime(event.timestamp, tz)}
          {duration !== null && duration > 0 ? ` · lasted ${formatDuration(duration)}` : ""}
        </p>
      </header>

      {d?.emergencyGuidance && (
        <Notice tone="danger" icon={Phone} title="If anyone is in immediate danger, contact local emergency services yourself">
          This app never contacts police or emergency services automatically and doesn&apos;t identify people. Review the information below and decide
          what to do.
        </Notice>
      )}
      {d?.requiresConfirmation && !d.emergencyGuidance && (
        <Notice tone="warn" icon={AlertOctagon} title="No automatic action was taken">
          Higher-concern events wait for you. Review what was observed, check in with your household, and decide on any next step. This is a pattern
          worth a look — not an accusation about anyone.
        </Notice>
      )}

      {uncertain && profile && canFeedback && (
        <Section id="review" title={`Was this ${profile.displayName}?`} description="The match was below your review threshold, so we didn't announce an arrival.">
          <div className="flex flex-wrap gap-2">
            <ActionForm action={confirmProfileAction}>
              <input type="hidden" name="eventId" value={event.id} />
              <input type="hidden" name="profileId" value={profile.id} />
              <SubmitButton>Yes, it was {profile.displayName}</SubmitButton>
            </ActionForm>
            <ActionForm action={rejectProfileAction}>
              <input type="hidden" name="eventId" value={event.id} />
              <SubmitButton className="btn-secondary">No / not sure</SubmitButton>
            </ActionForm>
          </div>
        </Section>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <Section id="observed" title="What was observed" description="Objective details only — no guesses about identity, intent or personal traits.">
            {event.observations.length === 0 ? (
              <p className="text-sm text-muted">No details were reported for this event.</p>
            ) : (
              <ul className="space-y-2">
                {event.observations.map((o, i) => (
                  <li key={i} className="flex flex-col gap-1 rounded-lg bg-sunken p-3 sm:flex-row sm:items-start sm:justify-between">
                    <span className="flex gap-2 text-sm">
                      <Eye aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
                      {o.text}
                    </span>
                    <span className="shrink-0">
                      {o.source === "provider" ? <ProvenanceTag kind="provider" /> : o.source === "demo" ? <DemoBadge /> : <ProvenanceTag kind="system" />}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {event.inference && (
              <div className="mt-4 rounded-lg border border-dashed border-warn/60 p-3">
                <div className="mb-1 flex items-center gap-2">
                  <Lightbulb aria-hidden className="h-4 w-4 text-warn" />
                  <span className="text-sm font-medium">Inference (not a fact)</span>
                </div>
                <p className="text-sm">{event.inference.label}</p>
                <p className="mt-1 text-xs text-muted">Basis: {event.inference.basis}</p>
              </div>
            )}
            {(event.confidence !== null || event.association?.confidence != null) && (
              <p className="mt-3 text-xs text-muted">
                {event.association?.confidence != null
                  ? `Simulated match confidence: ${Math.round(event.association.confidence * 100)}%. `
                  : `Classification confidence: ${Math.round((event.confidence ?? 0) * 100)}%. `}
                Confidence scores are estimates, never proof.
              </p>
            )}
          </Section>

          <Section id="clip" title="Recording">
            {event.evidenceReference?.kind === "ring_recording" ? (
              camera?.supportsClips === false ? (
                <p className="text-sm text-muted">This device doesn&apos;t record video.</p>
              ) : (
                <ClipPlayer eventId={event.id} />
              )
            ) : event.evidenceReference?.kind === "demo" ? (
              <p className="flex items-center gap-2 text-sm text-muted">
                <Video aria-hidden className="h-4 w-4" /> Demo events have no video.
              </p>
            ) : (
              <p className="text-sm text-muted">No recording exists for this kind of event.</p>
            )}
          </Section>

          {canFeedback && labelable && !uncertain && (
            <Section
              id="label"
              title="Who was this?"
              description="Label the event if you know. Labels stay in this app and are not used to build any face or body model."
            >
              {candidates.length === 0 ? (
                <p className="text-sm text-muted">
                  No eligible {event.demo ? "demo " : ""}profiles. <Link className="text-accent underline" href="/household">Manage household</Link>
                </p>
              ) : (
                <ActionForm action={confirmProfileAction} className="flex flex-col gap-2 sm:flex-row sm:items-end">
                  <input type="hidden" name="eventId" value={event.id} />
                  <div className="flex-1">
                    <label className="label" htmlFor="profileId">Household member</label>
                    <select className="input" id="profileId" name="profileId" defaultValue={event.householdProfileId ?? ""} required>
                      <option value="" disabled>Choose…</option>
                      {candidates.map((p) => (
                        <option key={p.id} value={p.id}>{p.displayName}</option>
                      ))}
                    </select>
                  </div>
                  <SubmitButton className="btn-secondary">Save label</SubmitButton>
                </ActionForm>
              )}
              {event.householdProfileId && (
                <ActionForm action={rejectProfileAction} className="mt-3">
                  <input type="hidden" name="eventId" value={event.id} />
                  <SubmitButton className="btn-ghost -ml-3">Remove person label</SubmitButton>
                </ActionForm>
              )}
            </Section>
          )}
        </div>

        <div className="space-y-6">
          <Section id="why" title="Why this notification?">
            {d ? (
              <>
                <div className="mb-3">
                  <ChannelBadge channel={d.channel} />
                </div>
                <ul className="space-y-2 text-sm">
                  {d.explanation.map((line, i) => (
                    <li key={i} className="flex gap-2">
                      <ShieldCheck aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
                      {line}
                    </li>
                  ))}
                </ul>
                {rule && (
                  <Link href={`/rules#${rule.id}`} className="mt-3 inline-block text-sm text-accent hover:underline">
                    Edit rule “{rule.name}”
                  </Link>
                )}
              </>
            ) : (
              <p className="text-sm text-muted">No decision recorded.</p>
            )}
          </Section>

          {canFeedback && (
            <Section id="feedback" title="Was this useful?">
              <ActionForm action={labelEventAction} className="flex flex-wrap gap-2">
                <input type="hidden" name="eventId" value={event.id} />
                <SubmitButton className="btn-secondary" name="label" value="helpful">Helpful</SubmitButton>
                <SubmitButton className="btn-secondary" name="label" value="not_helpful">Not helpful</SubmitButton>
                <SubmitButton className="btn-secondary" name="label" value="false_alarm">False alarm</SubmitButton>
                {event.eventType === "package" && (
                  <SubmitButton className="btn-secondary" name="label" value="not_delivery">Not a delivery</SubmitButton>
                )}
              </ActionForm>
            </Section>
          )}

          <Section id="history" title="History">
            <ul className="space-y-2 text-sm">
              {notifications.map((n) => (
                <li key={n.id} className="flex gap-2">
                  <MessageSquare aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
                  <span>
                    {formatTime(n.createdAt, tz)} · {n.channel.replace("_", " ")}: “{n.title}”
                  </span>
                </li>
              ))}
              {event.feedback.map((f, i) => (
                <li key={i} className="flex gap-2">
                  <HelpCircle aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
                  {formatTime(f.at, tz)} · {FEEDBACK_LABELS[f.label] ?? f.label}
                </li>
              ))}
              {event.derivedFrom.map((src) => (
                <li key={src}>
                  <Link className="text-accent hover:underline" href={`/activity/${src}`}>
                    View the event this pattern was derived from
                  </Link>
                </li>
              ))}
            </ul>
          </Section>

          <details className="card p-4 text-sm">
            <summary className="cursor-pointer font-medium">Technical details</summary>
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
              <dt className="text-muted">Source</dt>
              <dd>{event.provider === "demo" ? "Demo provider" : "Ring Partner API"}</dd>
              <dt className="text-muted">Provider type</dt>
              <dd className="break-all">{event.providerType ?? "—"}</dd>
              <dt className="text-muted">Category</dt>
              <dd>{CATEGORY_LABELS[event.eventType]}</dd>
              <dt className="text-muted">Event id</dt>
              <dd className="break-all">{event.id}</dd>
            </dl>
          </details>
        </div>
      </div>
    </article>
  );
}
