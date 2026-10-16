import Link from "next/link";
import { Filter, SearchX } from "lucide-react";
import { requireAppUser } from "@/lib/app-context";
import { CATEGORY_LABELS, EventCategory, SEVERITIES, SEVERITY_LABELS, Severity } from "@/lib/domain/types";
import { listEvents } from "@/lib/repo/events";
import { listCameras } from "@/lib/repo/cameras";
import { listProfiles } from "@/lib/repo/profiles";
import { getSettings } from "@/lib/repo/settings";
import { supportedCategories } from "@/lib/providers/registry";
import { dayKey, formatDay, minutesOfDay } from "@/lib/util/time";
import { EventCard } from "@/components/EventCard";
import { EmptyState, PageHeader } from "@/components/ui";

export const metadata = { title: "Activity" };
const PAGE = 30;

type SP = Record<string, string | string[] | undefined>;
const one = (sp: SP, k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");

/** Parses a yyyy-mm-dd date as local midnight in the household time zone. */
function dayStart(value: string, tz: string): number | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const utc = Date.parse(value + "T00:00:00Z");
  if (Number.isNaN(utc)) return undefined;
  // Local wall-clock minutes at UTC midnight tell us the zone offset (UTC−x → late previous evening).
  const m = minutesOfDay(utc, tz);
  return m < 720 ? utc - m * 60_000 : utc + (1440 - m) * 60_000;
}

export default async function ActivityPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requireAppUser();
  const sp = await searchParams;
  const settings = getSettings();
  const tz = settings.timezone;
  const categories = supportedCategories();
  const cameras = listCameras();
  const profiles = listProfiles();
  const camName = new Map(cameras.map((c) => [c.id, c.name]));

  const category = one(sp, "category") as EventCategory | "";
  const severity = one(sp, "severity") as Severity | "";
  const cameraId = one(sp, "camera");
  const profileId = one(sp, "profile");
  const q = one(sp, "q").slice(0, 80);
  const fromStr = one(sp, "from");
  const toStr = one(sp, "to");
  const demo = one(sp, "demo") || (settings.hideDemoData ? "hide" : "show");
  const page = Math.max(1, Number(one(sp, "page")) || 1);

  const from = dayStart(fromStr, tz);
  const toStart = dayStart(toStr, tz);
  const { events, total } = listEvents({
    categories: category && categories.includes(category) ? [category] : undefined,
    severities: severity && SEVERITIES.includes(severity) ? [severity] : undefined,
    cameraId: cameraId || undefined,
    profileId: profileId || undefined,
    q: q || undefined,
    from,
    to: toStart ? toStart + 86_400_000 : undefined,
    includeDemo: demo !== "hide",
    limit: PAGE,
    offset: (page - 1) * PAGE,
  });
  const filtered = Boolean(category || severity || cameraId || profileId || q || fromStr || toStr);

  const groups: { day: string; label: string; items: typeof events }[] = [];
  for (const e of events) {
    const key = dayKey(e.timestamp, tz);
    const g = groups[groups.length - 1];
    if (g && g.day === key) g.items.push(e);
    else groups.push({ day: key, label: formatDay(e.timestamp, tz), items: [e] });
  }

  const qs = (p: number) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (typeof v === "string" && v && k !== "page") params.set(k, v);
    params.set("page", String(p));
    return `?${params}`;
  };

  return (
    <>
      <PageHeader title="Activity" description="Every event, including those logged quietly. Select an event to see why it did or didn't notify you." />

      <form method="get" className="card mb-6 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Filter events">
        <div className="sm:col-span-2">
          <label className="label" htmlFor="q">Search summaries</label>
          <input className="input" id="q" name="q" defaultValue={q} placeholder="e.g. delivery, driveway" />
        </div>
        <div>
          <label className="label" htmlFor="from">From</label>
          <input className="input" id="from" name="from" type="date" defaultValue={fromStr} />
        </div>
        <div>
          <label className="label" htmlFor="to">To</label>
          <input className="input" id="to" name="to" type="date" defaultValue={toStr} />
        </div>
        <div>
          <label className="label" htmlFor="category">Category</label>
          <select className="input" id="category" name="category" defaultValue={category}>
            <option value="">All supported</option>
            {categories.map((c) => (
              <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="camera">Camera</label>
          <select className="input" id="camera" name="camera" defaultValue={cameraId}>
            <option value="">All cameras</option>
            {cameras.map((c) => (
              <option key={c.id} value={c.id}>{c.name}{c.demo ? " (demo)" : ""}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="profile">Person</label>
          <select className="input" id="profile" name="profile" defaultValue={profileId}>
            <option value="">Anyone</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>{p.displayName}{p.demo ? " (demo)" : ""}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="severity">Severity</label>
          <select className="input" id="severity" name="severity" defaultValue={severity}>
            <option value="">Any</option>
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>{SEVERITY_LABELS[s]}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="demo">Demo data</label>
          <select className="input" id="demo" name="demo" defaultValue={demo}>
            <option value="show">Show</option>
            <option value="hide">Hide</option>
          </select>
        </div>
        <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-3 lg:justify-end">
          {filtered && <Link className="btn-ghost" href="/activity">Clear filters</Link>}
          <button className="btn-primary" type="submit">
            <Filter aria-hidden className="h-4 w-4" /> Apply
          </button>
        </div>
      </form>

      <p className="mb-3 text-sm text-muted" aria-live="polite">
        {total} event{total === 1 ? "" : "s"}{filtered ? " match your filters" : ""}
      </p>

      {events.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title={filtered ? "No events match these filters" : "No events yet"}
          action={filtered ? <Link className="btn-secondary" href="/activity">Clear filters</Link> : undefined}
        >
          {filtered
            ? "Try widening the date range or choosing another camera."
            : "Events appear here when your cameras report activity — or turn on demo data in Privacy & Settings."}
        </EmptyState>
      ) : (
        <div className="space-y-6">
          {groups.map((g) => (
            <section key={g.day} aria-label={g.label}>
              <h2 className="mb-2 text-sm font-semibold text-muted">{g.label}</h2>
              <ul className="space-y-2">
                {g.items.map((e) => (
                  <EventCard key={e.id} event={e} cameraName={(e.cameraId && camName.get(e.cameraId)) || "Unknown camera"} timeZone={tz} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {total > PAGE && (
        <nav className="mt-6 flex items-center justify-between" aria-label="Pagination">
          {page > 1 ? <Link className="btn-secondary" href={qs(page - 1)}>Newer</Link> : <span />}
          <span className="text-sm text-muted">Page {page} of {Math.ceil(total / PAGE)}</span>
          {page * PAGE < total ? <Link className="btn-secondary" href={qs(page + 1)}>Older</Link> : <span />}
        </nav>
      )}
    </>
  );
}
