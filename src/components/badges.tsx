import {
  AlertOctagon,
  AlertTriangle,
  BadgeCheck,
  Bell,
  BellOff,
  Box,
  Car,
  CircleDot,
  FlaskConical,
  HelpCircle,
  Home,
  Info,
  Lightbulb,
  Radio,
  ShieldAlert,
  User,
  Video,
  WifiOff,
} from "lucide-react";
import { CATEGORY_LABELS, Decision, EventCategory, Severity, SEVERITY_LABELS } from "@/lib/domain/types";
import { ConnectionState } from "@/lib/providers/types";

/** Severity is always communicated with icon + text, never color alone. */
export function SeverityBadge({ severity }: { severity: Severity }) {
  const cfg = {
    low: { icon: CircleDot, cls: "border-line text-muted" },
    attention: { icon: AlertTriangle, cls: "border-warn/40 text-warn bg-warn/5" },
    high: { icon: ShieldAlert, cls: "border-danger/40 text-danger bg-danger/5" },
    emergency: { icon: AlertOctagon, cls: "border-danger bg-danger/10 text-danger" },
  }[severity];
  const Icon = cfg.icon;
  return (
    <span className={`chip ${cfg.cls}`}>
      <Icon aria-hidden className="h-3.5 w-3.5" />
      {SEVERITY_LABELS[severity]}
    </span>
  );
}

export const CATEGORY_ICONS: Record<EventCategory, typeof Home> = {
  arrival: Home,
  visitor: User,
  package: Box,
  doorbell: Bell,
  vehicle: Car,
  motion: Radio,
  behavior: ShieldAlert,
  device: Video,
};

export function CategoryIcon({ category, className = "h-5 w-5" }: { category: EventCategory; className?: string }) {
  const Icon = CATEGORY_ICONS[category];
  return <Icon aria-hidden className={className} />;
}

export function CategoryBadge({ category }: { category: EventCategory }) {
  return (
    <span className="chip border-line text-muted">
      <CategoryIcon category={category} className="h-3.5 w-3.5" />
      {CATEGORY_LABELS[category]}
    </span>
  );
}

export function DemoBadge({ label = "Demo" }: { label?: string }) {
  return (
    <span className="chip border-demo/50 bg-demo/10 text-demo" title="Sample data — not from your cameras">
      <FlaskConical aria-hidden className="h-3.5 w-3.5" />
      {label}
    </span>
  );
}

/** Provenance: what the camera platform reported vs. what this app inferred vs. what's uncertain. */
export function ProvenanceTag({ kind }: { kind: "provider" | "inference" | "uncertain" | "confirmed" | "system" }) {
  const cfg = {
    provider: { icon: BadgeCheck, text: "Reported by camera", cls: "border-info/40 text-info" },
    system: { icon: Info, text: "Pattern from your settings", cls: "border-line text-muted" },
    inference: { icon: Lightbulb, text: "Inference", cls: "border-dashed border-warn/60 text-warn" },
    uncertain: { icon: HelpCircle, text: "Uncertain match", cls: "border-dashed border-warn/60 text-warn bg-warn/5" },
    confirmed: { icon: BadgeCheck, text: "Confirmed by you", cls: "border-ok/40 text-ok" },
  }[kind];
  const Icon = cfg.icon;
  return (
    <span className={`chip ${cfg.cls}`}>
      <Icon aria-hidden className="h-3.5 w-3.5" />
      {cfg.text}
    </span>
  );
}

export function ChannelBadge({ channel }: { channel: Decision["channel"] }) {
  const cfg = {
    push: { icon: Bell, text: "Push alert", cls: "border-accent/40 text-accent" },
    in_app: { icon: Bell, text: "In-app", cls: "border-line text-ink" },
    quiet_log: { icon: BellOff, text: "Quiet log", cls: "border-line text-muted" },
    review: { icon: HelpCircle, text: "Needs review", cls: "border-dashed border-warn/60 text-warn" },
    none: { icon: BellOff, text: "No notification", cls: "border-line text-muted" },
  }[channel];
  const Icon = cfg.icon;
  return (
    <span className={`chip ${cfg.cls}`}>
      <Icon aria-hidden className="h-3.5 w-3.5" />
      {cfg.text}
    </span>
  );
}

/** `compact` hides the label on narrow screens (used in the crowded mobile header). */
export function ConnectionPill({ state, label, compact }: { state: ConnectionState; label: string; compact?: boolean }) {
  const cfg: Record<ConnectionState, { icon: typeof Home; cls: string; text: string }> = {
    connected: { icon: Radio, cls: "border-ok/40 text-ok", text: "Connected" },
    demo: { icon: FlaskConical, cls: "border-demo/50 text-demo bg-demo/10", text: "Demo mode" },
    not_configured: { icon: Info, cls: "border-line text-muted", text: "Not set up" },
    disconnected: { icon: WifiOff, cls: "border-line text-muted", text: "Not connected" },
    auth_expired: { icon: AlertTriangle, cls: "border-warn/50 text-warn", text: "Reconnect needed" },
    error: { icon: AlertTriangle, cls: "border-danger/40 text-danger", text: "Sync problem" },
  };
  const c = cfg[state];
  const Icon = c.icon;
  return (
    <span className={`chip whitespace-nowrap ${c.cls}`}>
      <Icon aria-hidden className="h-3.5 w-3.5" />
      <span>
        <span className={compact ? "sr-only sm:not-sr-only" : undefined}>{label}: </span>
        {c.text}
      </span>
    </span>
  );
}
