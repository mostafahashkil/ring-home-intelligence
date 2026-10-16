import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { NormalizedEvent } from "@/lib/domain/types";
import { formatDateTime } from "@/lib/util/time";
import { isUncertain } from "@/lib/household/association";
import { CategoryIcon, ChannelBadge, DemoBadge, ProvenanceTag, SeverityBadge } from "./badges";

export function EventCard({
  event,
  cameraName,
  timeZone,
  showDecision = true,
}: {
  event: NormalizedEvent;
  cameraName: string;
  timeZone: string;
  showDecision?: boolean;
}) {
  const uncertain = isUncertain(event);
  const confirmed = event.association?.method === "user_confirmed";
  const tone =
    event.severity === "high" || event.severity === "emergency"
      ? "border-l-danger"
      : event.severity === "attention"
        ? "border-l-warn"
        : uncertain
          ? "border-l-warn/60"
          : "border-l-line";
  return (
    <li>
      <Link
        href={`/activity/${event.id}`}
        className={`group elevated rounded-card flex gap-3 border border-l-4 border-line ${tone} bg-surface p-3 transition-colors hover:bg-sunken sm:p-4 ${event.demo ? "demo-stripe" : ""}`}
      >
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sunken text-muted">
          <CategoryIcon category={event.eventType} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-medium leading-snug">{event.summary}</p>
          <p className="mt-0.5 text-sm text-muted">
            {cameraName} · <time dateTime={new Date(event.timestamp).toISOString()}>{formatDateTime(event.timestamp, timeZone)}</time>
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {event.demo && <DemoBadge />}
            {event.severity !== "low" && <SeverityBadge severity={event.severity} />}
            {uncertain && <ProvenanceTag kind="uncertain" />}
            {confirmed && <ProvenanceTag kind="confirmed" />}
            {event.inference && !uncertain && <ProvenanceTag kind="inference" />}
            {/* A review request that someone already resolved is history, not a current state. */}
            {showDecision && event.decision && !(event.decision.channel === "review" && !uncertain) && (
              <ChannelBadge channel={event.decision.channel} />
            )}
            {event.confidence !== null && (
              <span className="chip border-line text-muted" title="Model confidence — never proof">
                {Math.round(event.confidence * 100)}% confidence
              </span>
            )}
          </div>
        </div>
        <ChevronRight aria-hidden className="mt-2 h-4 w-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5" />
      </Link>
    </li>
  );
}
