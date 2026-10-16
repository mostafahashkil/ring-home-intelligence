import { CheckCircle2, CircleSlash, Clock, ShieldQuestion, UserPlus, Users } from "lucide-react";
import { requireAppUser } from "@/lib/app-context";
import { can } from "@/lib/auth/core";
import { Camera, Profile } from "@/lib/domain/types";
import { listProfiles } from "@/lib/repo/profiles";
import { listCameras } from "@/lib/repo/cameras";
import { getSettings } from "@/lib/repo/settings";
import { DemoBadge } from "@/components/badges";
import { ActionForm, SubmitButton } from "@/components/forms";
import { EmptyState, Notice, PageHeader, Section } from "@/components/ui";
import { deleteProfileAction, saveProfileAction } from "../actions";

export const metadata = { title: "Household" };

const MODE_LABELS = {
  each_arrival: "Notify on each arrival",
  quiet_log: "Quiet log instead of alerts",
  suppress_routine: "Suppress routine arrivals",
};

export default async function HouseholdPage() {
  const user = await requireAppUser();
  const settings = getSettings();
  const profiles = listProfiles({ includeDemo: !settings.hideDemoData });
  const cameras = listCameras();
  const editable = can(user.role, "household:manage");

  return (
    <>
      <PageHeader
        title="Household"
        description="People in your home and how their arrivals are handled. Keep only what you need — a first name or nickname is enough."
      />

      <div className="mb-6">
        <Notice tone="info" icon={ShieldQuestion} title="How arrivals are recognized">
          This app does not use face recognition or biometrics, and Ring&apos;s API doesn&apos;t identify people. A real event becomes an arrival only
          when someone in your household labels it (“This was Sarah”). Demo profiles show simulated match signals so you can see how uncertain
          matches are handled. Profiles need consent before any automated signal can be linked to them.
        </Notice>
      </div>

      {profiles.length === 0 ? (
        <EmptyState icon={Users} title="No household profiles yet">
          Add the people who live here to label their arrivals and set per-person alert preferences.
        </EmptyState>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {profiles.map((p) => (
            <li key={p.id} className={`card p-4 ${p.demo ? "demo-stripe" : ""}`}>
              <div className="flex items-start gap-3">
                <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sunken font-semibold">
                  {p.displayName.charAt(0)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    {p.displayName}
                    {p.relationship && <span className="text-sm font-normal text-muted">· {p.relationship}</span>}
                    {p.demo && <DemoBadge label="Example profile" />}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <ConsentChip status={p.consentStatus} />
                    <span className="chip border-line text-muted">{p.enabled ? "Enabled" : "Disabled"}</span>
                    <span className="chip border-line text-muted">{MODE_LABELS[p.notifyMode]}</span>
                  </div>
                  <p className="mt-2 text-xs text-muted">
                    Review below {Math.round((p.reviewThreshold ?? settings.defaultReviewThreshold) * 100)}% match
                    {p.cameraIds?.length ? ` · ${p.cameraIds.length} camera${p.cameraIds.length > 1 ? "s" : ""}` : " · all cameras"}
                    {p.activeWindow ? ` · alerts ${p.activeWindow.start}–${p.activeWindow.end}` : ""}
                  </p>
                </div>
              </div>
              {editable && (
                <details className="mt-3 border-t border-line pt-3">
                  <summary className="cursor-pointer text-sm font-medium text-accent">Edit {p.displayName}</summary>
                  <ProfileForm profile={p} cameras={cameras} defaultThreshold={settings.defaultReviewThreshold} />
                  <ActionForm action={deleteProfileAction} className="mt-3 border-t border-line pt-3">
                    <input type="hidden" name="id" value={p.id} />
                    <SubmitButton className="btn-danger" confirm={`Delete ${p.displayName}? Their labels on past events will be removed.`}>
                      Delete profile
                    </SubmitButton>
                  </ActionForm>
                </details>
              )}
            </li>
          ))}
        </ul>
      )}

      {editable && (
        <div className="mt-6">
          <Section id="add" title="Add a person" description="Consent starts as pending. Ask the person before setting it to granted.">
            <ProfileForm cameras={cameras} defaultThreshold={settings.defaultReviewThreshold} />
          </Section>
        </div>
      )}
    </>
  );
}

function ConsentChip({ status }: { status: Profile["consentStatus"] }) {
  if (status === "granted")
    return (
      <span className="chip border-ok/40 text-ok">
        <CheckCircle2 aria-hidden className="h-3.5 w-3.5" /> Consent granted
      </span>
    );
  if (status === "withdrawn")
    return (
      <span className="chip border-danger/40 text-danger">
        <CircleSlash aria-hidden className="h-3.5 w-3.5" /> Consent withdrawn
      </span>
    );
  return (
    <span className="chip border-warn/50 text-warn">
      <Clock aria-hidden className="h-3.5 w-3.5" /> Consent pending
    </span>
  );
}

function ProfileForm({ profile, cameras, defaultThreshold }: { profile?: Profile; cameras: Camera[]; defaultThreshold: number }) {
  const idp = profile?.id ?? "new";
  const relevant = cameras.filter((c) => !profile || c.demo === profile.demo);
  return (
    <ActionForm action={saveProfileAction} className="mt-3 grid gap-3 sm:grid-cols-2" resetOnSuccess={!profile}>
      {profile && <input type="hidden" name="id" value={profile.id} />}
      <div>
        <label className="label" htmlFor={`${idp}-name`}>Display name</label>
        <input className="input" id={`${idp}-name`} name="displayName" defaultValue={profile?.displayName} maxLength={40} required />
      </div>
      <div>
        <label className="label" htmlFor={`${idp}-rel`}>Relationship <span className="font-normal text-muted">(optional)</span></label>
        <input className="input" id={`${idp}-rel`} name="relationship" defaultValue={profile?.relationship ?? ""} maxLength={30} placeholder="e.g. daughter" />
      </div>
      <div>
        <label className="label" htmlFor={`${idp}-consent`}>Consent</label>
        <select className="input" id={`${idp}-consent`} name="consentStatus" defaultValue={profile?.consentStatus ?? "pending"} aria-describedby={`${idp}-consent-hint`}>
          <option value="pending">Pending</option>
          <option value="granted">Granted by this person</option>
          <option value="withdrawn">Withdrawn</option>
        </select>
        <p className="hint" id={`${idp}-consent-hint`}>Withdrawing removes their labels from past events.</p>
      </div>
      <div>
        <label className="label" htmlFor={`${idp}-mode`}>Arrival notifications</label>
        <select className="input" id={`${idp}-mode`} name="notifyMode" defaultValue={profile?.notifyMode ?? "each_arrival"}>
          {Object.entries(MODE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
      </div>
      <fieldset className="sm:col-span-2">
        <legend className="label">Only alert for these cameras <span className="font-normal text-muted">(none = all)</span></legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {relevant.map((c) => (
            <label key={c.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="cameraIds" value={c.id} defaultChecked={profile?.cameraIds?.includes(c.id)} />
              {c.name}
            </label>
          ))}
          {relevant.length === 0 && <span className="text-sm text-muted">No cameras yet.</span>}
        </div>
      </fieldset>
      <div>
        <label className="label" htmlFor={`${idp}-as`}>Alert window start</label>
        <input className="input" type="time" id={`${idp}-as`} name="activeStart" defaultValue={profile?.activeWindow?.start} />
      </div>
      <div>
        <label className="label" htmlFor={`${idp}-ae`}>Alert window end</label>
        <input className="input" type="time" id={`${idp}-ae`} name="activeEnd" defaultValue={profile?.activeWindow?.end} />
        <p className="hint">Leave both empty to alert at any time.</p>
      </div>
      <div>
        <label className="label" htmlFor={`${idp}-thr`}>Ask me to review below (%)</label>
        <input
          className="input"
          type="number"
          min={0}
          max={100}
          id={`${idp}-thr`}
          name="reviewThreshold"
          defaultValue={profile?.reviewThreshold != null ? Math.round(profile.reviewThreshold * 100) : ""}
          placeholder={`Default ${Math.round(defaultThreshold * 100)}`}
        />
      </div>
      <label className="flex items-center gap-2 self-end pb-2 text-sm">
        <input type="checkbox" name="enabled" defaultChecked={profile?.enabled ?? true} /> Profile enabled
      </label>
      <div className="sm:col-span-2">
        <SubmitButton pendingText="Saving…">
          {profile ? "Save changes" : (
            <>
              <UserPlus aria-hidden className="h-4 w-4" /> Add person
            </>
          )}
        </SubmitButton>
      </div>
    </ActionForm>
  );
}
