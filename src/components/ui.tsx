import { LucideIcon, ShieldOff } from "lucide-react";
import Link from "next/link";

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

export function Section({
  title,
  description,
  children,
  actions,
  id,
}: {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  actions?: React.ReactNode;
  id?: string;
}) {
  return (
    <section className="card p-4 sm:p-5" aria-labelledby={id ? `${id}-title` : undefined} id={id}>
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 id={id ? `${id}-title` : undefined} className="text-base font-semibold">
            {title}
          </h2>
          {description && <div className="mt-0.5 text-sm text-muted">{description}</div>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
}: {
  icon: LucideIcon;
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed border-line px-6 py-10 text-center">
      <Icon aria-hidden className="mb-3 h-8 w-8 text-muted" />
      <p className="font-medium">{title}</p>
      {children && <div className="mt-1 max-w-md text-sm text-muted">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function PermissionDenied({ what }: { what: string }) {
  return (
    <EmptyState icon={ShieldOff} title="Owner access required" action={<Link className="btn-secondary" href="/">Back to Home</Link>}>
      Only the household owner can {what}. Ask them to make this change, or to update your role.
    </EmptyState>
  );
}

export function Notice({
  tone = "info",
  icon: Icon,
  title,
  children,
}: {
  tone?: "info" | "warn" | "danger" | "demo" | "ok";
  icon?: LucideIcon;
  title?: string;
  children: React.ReactNode;
}) {
  const cls = {
    info: "border-info/30 bg-info/5",
    warn: "border-warn/40 bg-warn/5",
    danger: "border-danger/40 bg-danger/5",
    demo: "border-demo/40 bg-demo/5",
    ok: "border-ok/40 bg-ok/5",
  }[tone];
  return (
    <div className={`flex gap-3 rounded-xl border p-3 text-sm ${cls}`} role={tone === "danger" ? "alert" : undefined}>
      {Icon && <Icon aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />}
      <div>
        {title && <p className="font-medium">{title}</p>}
        <div className={title ? "mt-0.5 text-muted" : ""}>{children}</div>
      </div>
    </div>
  );
}

export function Stat({ label, value, hint, icon: Icon }: { label: string; value: React.ReactNode; hint?: string; icon: LucideIcon }) {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 text-sm text-muted">
        <Icon aria-hidden className="h-4 w-4" />
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted">{hint}</div>}
    </div>
  );
}
