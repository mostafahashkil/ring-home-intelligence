import Link from "next/link";
import { CheckCircle2, CircleDashed, FlaskConical, MinusCircle, RefreshCw, Video, VideoOff, Wifi, WifiOff } from "lucide-react";
import { requireAppUser } from "@/lib/app-context";
import { can } from "@/lib/auth/core";
import { listCameras } from "@/lib/repo/cameras";
import { getSettings } from "@/lib/repo/settings";
import { getProviders } from "@/lib/providers/registry";
import { Capability } from "@/lib/providers/types";
import { formatDateTime } from "@/lib/util/time";
import { ConnectionPill, DemoBadge } from "@/components/badges";
import { ActionForm, SubmitButton } from "@/components/forms";
import { EmptyState, Notice, PageHeader, Section } from "@/components/ui";
import { saveZoneAction, syncRingAction } from "../actions";

export const metadata = { title: "Cameras & Zones" };

export default async function CamerasPage() {
  const user = await requireAppUser();
  const settings = await getSettings();
  const tz = settings.timezone;
  const cameras = await listCameras({ includeDemo: !settings.hideDemoData });
  const providers = getProviders();
  const connections = await Promise.all(providers.map((p) => p.connection()));
  const editable = can(user.role, "settings:manage");
  const canSync = can(user.role, "integrations:manage");

  return (
    <>
      <PageHeader title="Cameras & Zones" description="Devices reported by your connected provider, plus demo cameras when demo data is on." />

      <div className="space-y-6">
        {providers.map((p, i) => {
          const conn = connections[i]!;
          const cams = cameras.filter((c) => c.provider === p.id);
          if (p.isDemo && conn.state !== "demo" && cams.length === 0) return null;
          return (
            <Section
              key={p.id}
              id={p.id}
              title={p.label}
              description={
                <span className="flex flex-wrap items-center gap-2">
                  <ConnectionPill state={conn.state} label={p.isDemo ? "Data" : "Ring"} />
                  <span>{conn.message}</span>
                  {conn.lastSyncAt && <span>Last sync {formatDateTime(conn.lastSyncAt, tz)}.</span>}
                </span>
              }
              actions={
                !p.isDemo && canSync && (conn.state === "connected" || conn.state === "error") ? (
                  <ActionForm action={syncRingAction}>
                    <SubmitButton className="btn-secondary" pendingText="Syncing…">
                      <RefreshCw aria-hidden className="h-4 w-4" /> Sync now
                    </SubmitButton>
                  </ActionForm>
                ) : null
              }
            >
              {!p.isDemo && (conn.state === "not_configured" || conn.state === "disconnected" || conn.state === "auth_expired") && (
                <div className="mb-4">
                  <Notice tone={conn.state === "auth_expired" ? "warn" : "info"} icon={conn.state === "auth_expired" ? WifiOff : Wifi}>
                    {conn.state === "auth_expired" ? "Reconnect Ring to resume events." : "No Ring devices yet."}{" "}
                    <Link className="text-accent underline" href="/settings#integrations">
                      Open integration settings
                    </Link>
                  </Notice>
                </div>
              )}

              {cams.length === 0 ? (
                p.isDemo ? null : (
                  <EmptyState icon={VideoOff} title="No cameras">
                    Cameras appear after Ring is connected and synced. Only devices you shared with this app in the Ring app are listed.
                  </EmptyState>
                )
              ) : (
                <ul className="grid gap-3 sm:grid-cols-2">
                  {cams.map((c) => (
                    <li key={c.id} className={`rounded-xl border border-line p-3 ${c.demo ? "demo-stripe" : ""}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="flex items-center gap-2 font-medium">
                            <Video aria-hidden className="h-4 w-4 text-muted" /> {c.name}
                          </p>
                          <p className="mt-0.5 text-xs text-muted">Zone: {c.zone ?? "not set"}</p>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <StatusChip status={c.status} />
                          {c.demo && <DemoBadge />}
                        </div>
                      </div>
                      <p className="mt-2 text-xs text-muted">
                        {c.supportsClips ? "Recordings available on request" : "No recordings"}
                        {c.componentIds.length > 1 ? ` · ${c.componentIds.length} camera modules` : ""} · updated {formatDateTime(c.updatedAt, tz)}
                      </p>
                      {editable && (
                        <ActionForm action={saveZoneAction} className="mt-3 flex items-end gap-2">
                          <input type="hidden" name="id" value={c.id} />
                          <div className="flex-1">
                            <label className="sr-only" htmlFor={`zone-${c.id}`}>Zone for {c.name}</label>
                            <input className="input" id={`zone-${c.id}`} name="zone" defaultValue={c.zone ?? ""} placeholder="Zone (e.g. Entrance)" maxLength={40} />
                          </div>
                          <SubmitButton className="btn-secondary">Save</SubmitButton>
                        </ActionForm>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              <details className="mt-4">
                <summary className="cursor-pointer text-sm font-medium text-accent">What {p.isDemo ? "demo data" : "Ring's API"} supports</summary>
                <CapabilityTable rows={p.capabilities} />
              </details>
            </Section>
          );
        })}
      </div>
    </>
  );
}

function StatusChip({ status }: { status: string }) {
  if (status === "online")
    return (
      <span className="chip border-ok/40 text-ok">
        <Wifi aria-hidden className="h-3.5 w-3.5" /> Online
      </span>
    );
  if (status === "offline")
    return (
      <span className="chip border-danger/40 text-danger">
        <WifiOff aria-hidden className="h-3.5 w-3.5" /> Offline
      </span>
    );
  if (status === "removed")
    return (
      <span className="chip border-line text-muted">
        <MinusCircle aria-hidden className="h-3.5 w-3.5" /> Removed
      </span>
    );
  return (
    <span className="chip border-line text-muted">
      <CircleDashed aria-hidden className="h-3.5 w-3.5" /> Unknown
    </span>
  );
}

function CapabilityTable({ rows }: { rows: Capability[] }) {
  const icon = {
    supported: <CheckCircle2 aria-hidden className="h-4 w-4 text-ok" />,
    partial: <CircleDashed aria-hidden className="h-4 w-4 text-warn" />,
    unsupported: <MinusCircle aria-hidden className="h-4 w-4 text-muted" />,
    demo_only: <FlaskConical aria-hidden className="h-4 w-4 text-demo" />,
  };
  const text = { supported: "Supported", partial: "Partial", unsupported: "Not supported", demo_only: "Demo only" };
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full min-w-[520px] text-left text-sm">
        <thead className="text-xs text-muted">
          <tr>
            <th className="py-2 pr-3 font-medium">Feature</th>
            <th className="py-2 pr-3 font-medium">Status</th>
            <th className="py-2 font-medium">Notes</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => (
            <tr key={r.feature}>
              <td className="py-2 pr-3 align-top">{r.feature}</td>
              <td className="whitespace-nowrap py-2 pr-3 align-top">
                <span className="inline-flex items-center gap-1.5">
                  {icon[r.support]} {text[r.support]}
                </span>
              </td>
              <td className="py-2 align-top text-muted">{r.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
