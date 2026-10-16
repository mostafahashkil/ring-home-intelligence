import Link from "next/link";
import { Activity, Box, CheckCircle2, HelpCircle, Home as HomeIcon, ShieldAlert, Sparkles } from "lucide-react";
import { requireAppUser } from "@/lib/app-context";
import { can } from "@/lib/auth/core";
import { listEvents } from "@/lib/repo/events";
import { listCameras } from "@/lib/repo/cameras";
import { listProfiles } from "@/lib/repo/profiles";
import { getSettings } from "@/lib/repo/settings";
import { getProviders } from "@/lib/providers/registry";
import { DEMO_TEMPLATES } from "@/lib/providers/demo";
import { isUncertain } from "@/lib/household/association";
import { currentTime, dayKey, formatDay, formatTime } from "@/lib/util/time";
import { EventCard } from "@/components/EventCard";
import { EmptyState, Notice, PageHeader, Section, Stat } from "@/components/ui";
import { DemoBadge, ProvenanceTag } from "@/components/badges";
import { ActionForm, SubmitButton } from "@/components/forms";
import { simulateDemoEvent } from "./actions";

export const metadata = { title: "Home" };

export default async function HomePage() {
  const user = await requireAppUser();
  const settings = getSettings();
  const tz = settings.timezone;
  const includeDemo = !settings.hideDemoData;
  const now = currentTime();
  const since = now - 24 * 3_600_000;
  const { events } = listEvents({ from: since, includeDemo, limit: 200 });
  const cameras = new Map(listCameras().map((c) => [c.id, c]));
  const profiles = listProfiles({ includeDemo });
  const camName = (id: string | null) => (id && cameras.get(id)?.name) || "Unknown camera";
  const ring = getProviders().find((p) => p.id === "ring")!.connection();

  const today = dayKey(now, tz);
  const todays = events.filter((e) => dayKey(e.timestamp, tz) === today);
  const priority = events.filter(
    (e) => e.severity !== "low" || isUncertain(e),
  );
  const packages = todays.filter((e) => e.eventType === "package");
  const arrivals = events.filter((e) => e.eventType === "arrival" && e.householdProfileId);
  const notable = events.filter((e) => e.decision && e.decision.channel !== "quiet_log").slice(0, 6);
  const quiet = events.filter((e) => e.decision?.channel === "quiet_log").length;

  const latestArrival = new Map<string, (typeof arrivals)[number]>();
  for (const a of arrivals) if (!latestArrival.has(a.householdProfileId!)) latestArrival.set(a.householdProfileId!, a);

  return (
    <>
      <PageHeader title="Home" description={`${formatDay(now, tz)} · A calm summary of the last 24 hours.`} />

      {!settings.demoEnabled && ring.state !== "connected" && ring.state !== "error" && (
        <div className="mb-6">
          <Notice tone="info" icon={Activity} title="No event source connected">
            Connect Ring in <Link className="text-accent underline" href="/settings#integrations">Privacy &amp; Settings</Link>, or turn on demo
            data to explore the app.
          </Notice>
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={Activity} label="Events today" value={todays.length} hint={`${quiet} logged quietly (24 h)`} />
        <Stat icon={HomeIcon} label="Arrivals (24 h)" value={arrivals.length} />
        <Stat icon={Box} label="Package activity today" value={packages.length} />
        <Stat icon={ShieldAlert} label="Needs a look (24 h)" value={priority.length} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <Section
            id="priority"
            title="Priority"
            description="Safety patterns, uncertain matches and anything at “Needs attention” or above."
          >
            {priority.length === 0 ? (
              <EmptyState icon={CheckCircle2} title="Nothing needs your attention">
                Routine activity is logged quietly in Activity.
              </EmptyState>
            ) : (
              <ul className="space-y-2">
                {priority.slice(0, 5).map((e) => (
                  <EventCard key={e.id} event={e} cameraName={camName(e.cameraId)} timeZone={tz} />
                ))}
              </ul>
            )}
          </Section>

          <Section
            id="recent"
            title="Recent notifications"
            actions={
              <Link className="btn-ghost" href="/activity">
                View all activity
              </Link>
            }
          >
            {notable.length === 0 ? (
              <EmptyState icon={Activity} title="No notifications in the last 24 hours" />
            ) : (
              <ul className="space-y-2">
                {notable.map((e) => (
                  <EventCard key={e.id} event={e} cameraName={camName(e.cameraId)} timeZone={tz} />
                ))}
              </ul>
            )}
          </Section>
        </div>

        <div className="space-y-6">
          <Section id="household" title="Household" description="Latest arrival per person (24 h).">
            {profiles.length === 0 ? (
              <EmptyState icon={HomeIcon} title="No household profiles" action={<Link className="btn-secondary" href="/household">Add a profile</Link>} />
            ) : (
              <ul className="divide-y divide-line">
                {profiles.map((p) => {
                  const a = latestArrival.get(p.id);
                  const uncertain = !!a && isUncertain(a);
                  return (
                    <li key={p.id} className="flex items-center gap-3 py-2.5">
                      <span aria-hidden className="flex h-9 w-9 items-center justify-center rounded-full bg-sunken text-sm font-semibold">
                        {p.displayName.charAt(0)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-2 text-sm font-medium">
                          {p.displayName}
                          {p.relationship && <span className="font-normal text-muted">· {p.relationship}</span>}
                        </p>
                        <p className="text-xs text-muted">
                          {a ? (
                            <Link href={`/activity/${a.id}`} className="hover:underline">
                              {uncertain ? "Possible arrival" : "Arrived"} {formatTime(a.timestamp, tz)} · {camName(a.cameraId)}
                            </Link>
                          ) : (
                            "No arrival recorded"
                          )}
                        </p>
                      </div>
                      {uncertain ? (
                        <HelpCircle aria-label="Uncertain match — review" className="h-4 w-4 text-warn" />
                      ) : (
                        p.demo && <DemoBadge />
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="mt-3 text-xs text-muted">
              Arrivals come from your own confirmations{settings.demoEnabled ? " or simulated demo signals" : ""}. This app has no face recognition.
            </p>
          </Section>

          {settings.demoEnabled && can(user.role, "demo:simulate") && (
            <Section
              id="simulate"
              title="Try a sample event"
              description={
                <span className="flex items-center gap-1.5">
                  Runs a demo event through your real rules. <ProvenanceTag kind="system" />
                </span>
              }
            >
              <ActionForm action={simulateDemoEvent} className="space-y-2">
                <label className="label" htmlFor="template">
                  Sample event
                </label>
                <select id="template" name="template" className="input">
                  {Object.entries(DEMO_TEMPLATES).map(([k, t]) => (
                    <option key={k} value={k}>
                      {t.label}
                    </option>
                  ))}
                </select>
                <SubmitButton className="btn-secondary w-full" pendingText="Adding…">
                  <Sparkles aria-hidden className="h-4 w-4" /> Add demo event
                </SubmitButton>
              </ActionForm>
            </Section>
          )}
        </div>
      </div>
    </>
  );
}
