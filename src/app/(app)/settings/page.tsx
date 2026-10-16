import { headers } from "next/headers";
import { CheckCircle2, Database, Download, FlaskConical, KeyRound, Link2, Lock, ScrollText, ShieldOff, Trash2, UserPlus, Users } from "lucide-react";
import { requireAppUser } from "@/lib/app-context";
import { can, listUsers } from "@/lib/auth/core";
import { getSettings } from "@/lib/repo/settings";
import { listAudit } from "@/lib/repo/audit";
import { canStartOAuth, loadCredentials, ringConfig } from "@/lib/providers/ring/auth";
import { getProviders } from "@/lib/providers/registry";
import { formatDateTime } from "@/lib/util/time";
import { ConnectionPill } from "@/components/badges";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Notice, PageHeader, PermissionDenied, Section } from "@/components/ui";
import {
  addMemberAction,
  deleteDataAction,
  disconnectRingAction,
  removeMemberAction,
  resetDemoAction,
  saveNotificationSettingsAction,
  saveRetentionAction,
  setDemoEnabledAction,
  syncRingAction,
} from "../actions";

export const metadata = { title: "Privacy & Settings" };

const RING_STATUS: Record<string, { tone: "ok" | "warn" | "danger"; text: string }> = {
  connected: { tone: "ok", text: "Ring connected. Your devices are syncing." },
  denied: { tone: "warn", text: "Ring access was not granted. Nothing was connected." },
  base_plan_required: { tone: "warn", text: "Ring requires an active Ring base plan (subscription) on the devices you share." },
  invalid_scope: { tone: "danger", text: "Ring rejected the requested scope. Check RING_OAUTH_SCOPE matches your approved scope." },
  not_configured: { tone: "warn", text: "Ring OAuth isn't configured on this server." },
  forbidden: { tone: "danger", text: "Only the owner can connect Ring." },
  ring_error: { tone: "danger", text: "Ring reported a server error. Try again later." },
  error: { tone: "danger", text: "Connecting Ring failed. Try again." },
};

export default async function SettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireAppUser();
  const sp = await searchParams;
  const settings = getSettings();
  const tz = settings.timezone;

  if (!can(user.role, "settings:manage")) {
    return (
      <>
        <PageHeader title="Privacy & Settings" />
        <div className="space-y-6">
          <WhatWeStore />
          <PermissionDenied what="change integrations, privacy and notification settings" />
        </div>
      </>
    );
  }

  const ring = getProviders().find((p) => p.id === "ring")!.connection();
  const cfg = ringConfig();
  const creds = loadCredentials();
  const h = await headers();
  const origin = process.env.APP_BASE_URL || `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
  const status = sp.ring ? RING_STATUS[sp.ring] : null;
  const users = listUsers();
  const auditRows = listAudit(50);

  return (
    <>
      <PageHeader title="Privacy & Settings" description="Integrations, data controls and how notifications behave." />
      <div className="space-y-6">
        {/* ---------- Integrations ---------- */}
        <Section id="integrations" title="Ring integration" description={<ConnectionPill state={ring.state} label="Ring" />}>
          {status && (
            <div className="mb-4">
              <Notice tone={status.tone}>{status.text}</Notice>
            </div>
          )}
          <p className="mb-3 text-sm text-muted">{ring.message}</p>
          {ring.state === "not_configured" ? (
            <div className="space-y-3 text-sm">
              <p>
                Ring access uses the official Ring Partner API (Ring AppStore developer program). This app never asks for your Ring password. To
                connect, a server administrator sets environment variables (see <code>.env.example</code> and the README):
              </p>
              <ul className="list-disc space-y-1 pl-5 text-muted">
                <li><code>RING_CLIENT_ID</code>, <code>RING_CLIENT_SECRET</code>, <code>RING_HMAC_SIGNING_KEY</code> — issued at partner onboarding</li>
                <li><code>RING_OAUTH_REDIRECT_URI</code> — for “Connect Ring” (partner-initiated OAuth; invitation-only per Ring)</li>
                <li>or, for development, <code>RING_ACCESS_TOKEN</code> / <code>RING_REFRESH_TOKEN</code> from the Ring Developer Playground</li>
              </ul>
            </div>
          ) : (
            <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[200px_1fr]">
              <dt className="text-muted">Credentials</dt>
              <dd>
                {creds ? `Stored encrypted (${creds.source === "oauth" ? "OAuth link" : "refreshed from environment token"}), updated ${formatDateTime(creds.updatedAt, tz)}` : cfg.envAccessToken ? "Environment access token (expires after ~4 h)" : "Environment refresh token (not yet used)"}
              </dd>
              <dt className="text-muted">Webhook URL to register</dt>
              <dd className="break-all"><code>{origin}/api/ring/webhook</code> {!cfg.hmacKey && <span className="text-warn">— set RING_HMAC_SIGNING_KEY to accept webhooks</span>}</dd>
              {cfg.redirectUri && (
                <>
                  <dt className="text-muted">OAuth redirect URI</dt>
                  <dd className="break-all"><code>{cfg.redirectUri}</code></dd>
                </>
              )}
              {ring.lastSyncAt && (
                <>
                  <dt className="text-muted">Last sync</dt>
                  <dd>{formatDateTime(ring.lastSyncAt, tz)}</dd>
                </>
              )}
            </dl>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            {canStartOAuth(cfg) && (
              <a className="btn-primary" href="/api/ring/oauth/start">
                <Link2 aria-hidden className="h-4 w-4" /> {creds ? "Reconnect Ring" : "Connect Ring"}
              </a>
            )}
            {(ring.state === "connected" || ring.state === "error") && (
              <ActionForm action={syncRingAction}>
                <SubmitButton className="btn-secondary" pendingText="Syncing…">Sync now</SubmitButton>
              </ActionForm>
            )}
            {creds && (
              <ActionForm action={disconnectRingAction}>
                <SubmitButton className="btn-danger" confirm="Delete stored Ring tokens from this app?">Disconnect &amp; delete tokens</SubmitButton>
              </ActionForm>
            )}
          </div>
        </Section>

        {/* ---------- Demo ---------- */}
        <Section id="demo" title="Demo data" description="Sample cameras, the example household (Alex, Emily, Jack, Sarah) and sample events. Always labeled “Demo” and kept separate from real data.">
          <ActionForm action={setDemoEnabledAction} className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="demoEnabled" defaultChecked={settings.demoEnabled} /> Show demo data
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="hideDemoData" defaultChecked={settings.hideDemoData} /> Hide demo items from lists by default (keeps them stored)
            </label>
            <p className="hint">Turning demo data off deletes all demo items. Real events and profiles are never touched.</p>
            <SubmitButton className="btn-secondary">Save</SubmitButton>
          </ActionForm>
          {settings.demoEnabled && (
            <ActionForm action={resetDemoAction} className="mt-4 border-t border-line pt-4">
              <SubmitButton className="btn-secondary" confirm="Reset all demo data to the original samples?" pendingText="Resetting…">
                <FlaskConical aria-hidden className="h-4 w-4" /> Reset demo data
              </SubmitButton>
            </ActionForm>
          )}
        </Section>

        {/* ---------- Notifications ---------- */}
        <Section id="notifications" title="Notifications & safety thresholds">
          <ActionForm action={saveNotificationSettingsAction} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="label" htmlFor="timezone">Time zone</label>
              <input className="input" id="timezone" name="timezone" defaultValue={settings.timezone} placeholder="America/New_York" />
            </div>
            <fieldset className="sm:col-span-2">
              <legend className="label">Quiet hours</legend>
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="quietEnabled" defaultChecked={settings.quietHours.enabled} /> On
                </label>
                <label className="sr-only" htmlFor="quietStart">Quiet hours start</label>
                <input className="input w-32" type="time" id="quietStart" name="quietStart" defaultValue={settings.quietHours.start} />
                <span className="text-sm text-muted">to</span>
                <label className="sr-only" htmlFor="quietEnd">Quiet hours end</label>
                <input className="input w-32" type="time" id="quietEnd" name="quietEnd" defaultValue={settings.quietHours.end} />
              </div>
              <p className="hint">Push alerts become in-app during quiet hours, except higher-concern and emergency events.</p>
            </fieldset>
            <div>
              <label className="label" htmlFor="dedup">Deduplicate within (min)</label>
              <input className="input" type="number" min={0} max={240} id="dedup" name="dedupWindowMinutes" defaultValue={settings.dedupWindowMinutes} />
            </div>
            <div>
              <label className="label" htmlFor="cooldownMax">Max push alerts</label>
              <input className="input" type="number" min={1} max={100} id="cooldownMax" name="cooldownMax" defaultValue={settings.cooldown.maxPush} />
            </div>
            <div>
              <label className="label" htmlFor="cooldownWindow">…per (min)</label>
              <input className="input" type="number" min={1} max={240} id="cooldownWindow" name="cooldownWindow" defaultValue={settings.cooldown.windowMinutes} />
            </div>
            <div>
              <label className="label" htmlFor="drt">Review matches below (%)</label>
              <input className="input" type="number" min={0} max={100} id="drt" name="defaultReviewThreshold" defaultValue={Math.round(settings.defaultReviewThreshold * 100)} />
            </div>
            <div>
              <label className="label" htmlFor="loiter">Prolonged activity after (s)</label>
              <input className="input" type="number" min={30} max={3600} id="loiter" name="loiterSeconds" defaultValue={settings.behavior.loiterSeconds} />
            </div>
            <div>
              <label className="label" htmlFor="rvc">Repeated visits: count</label>
              <input className="input" type="number" min={2} max={20} id="rvc" name="repeatVisitsCount" defaultValue={settings.behavior.repeatVisitsCount} />
            </div>
            <div>
              <label className="label" htmlFor="rvw">…within (min)</label>
              <input className="input" type="number" min={5} max={1440} id="rvw" name="repeatVisitsWindowMinutes" defaultValue={settings.behavior.repeatVisitsWindowMinutes} />
            </div>
            <fieldset className="sm:col-span-2 lg:col-span-3">
              <legend className="label">Response ladder (used when no rule matches a safety event)</legend>
              <ol className="grid gap-2 text-sm sm:grid-cols-2">
                <li className="rounded-lg bg-sunken p-3">
                  <p className="font-medium">1 · Low concern</p>
                  <select className="input mt-1" name="ladderLow" defaultValue={settings.ladder.low} aria-label="Low concern action">
                    <option value="quiet_log">Log quietly</option>
                    <option value="in_app">Low-priority in-app notice</option>
                  </select>
                </li>
                <li className="rounded-lg bg-sunken p-3">
                  <p className="font-medium">2 · Needs attention</p>
                  <select className="input mt-1" name="ladderAttention" defaultValue={settings.ladder.attention} aria-label="Needs attention action">
                    <option value="push">Notify household (push) with clip when available</option>
                    <option value="in_app">In-app only</option>
                  </select>
                </li>
                <li className="rounded-lg bg-sunken p-3">
                  <p className="font-medium">3 · Higher concern</p>
                  <p className="mt-1 text-muted">Push alert and ask you to confirm any next step. No routine runs automatically.</p>
                </li>
                <li className="rounded-lg bg-sunken p-3">
                  <p className="font-medium">4 · Emergency</p>
                  <p className="mt-1 text-muted">Push alert with guidance. You decide whether to contact local emergency services.</p>
                </li>
              </ol>
            </fieldset>
            <div className="sm:col-span-2 lg:col-span-3">
              <SubmitButton>Save notification settings</SubmitButton>
            </div>
          </ActionForm>
        </Section>

        {/* ---------- Data ---------- */}
        <Section id="data" title="Data & retention" description="Events and notifications older than the retention period are deleted automatically (checked hourly).">
          <ActionForm action={saveRetentionAction} className="flex flex-wrap items-end gap-3">
            <div>
              <label className="label" htmlFor="ret">Keep events for (days)</label>
              <input className="input w-36" type="number" min={1} max={365} id="ret" name="retentionDays" defaultValue={settings.retentionDays} />
            </div>
            <div>
              <label className="label" htmlFor="aret">Keep audit log for (days)</label>
              <input className="input w-36" type="number" min={30} max={3650} id="aret" name="auditRetentionDays" defaultValue={settings.auditRetentionDays} />
            </div>
            <SubmitButton className="btn-secondary">Save &amp; apply now</SubmitButton>
          </ActionForm>

          <div className="mt-5 flex flex-wrap gap-2 border-t border-line pt-5">
            <a className="btn-secondary" href="/api/export">
              <Download aria-hidden className="h-4 w-4" /> Export my data (JSON)
            </a>
            <ActionForm action={deleteDataAction}>
              <input type="hidden" name="what" value="events" />
              <SubmitButton className="btn-danger" confirm="Delete all event history and notifications? This can't be undone.">
                <Trash2 aria-hidden className="h-4 w-4" /> Delete event history
              </SubmitButton>
            </ActionForm>
          </div>

          <ActionForm action={deleteDataAction} className="mt-5 rounded-xl border border-danger/40 p-4">
            <input type="hidden" name="what" value="everything" />
            <p className="font-medium text-danger">Delete everything</p>
            <p className="mb-3 mt-1 text-sm text-muted">Removes all events, profiles, cameras, rules, settings and Ring tokens. Accounts remain so you can sign in.</p>
            <label className="label" htmlFor="confirmText">Type DELETE to confirm</label>
            <div className="flex flex-wrap gap-2">
              <input className="input w-40" id="confirmText" name="confirmText" autoComplete="off" />
              <SubmitButton className="btn-danger">Delete everything</SubmitButton>
            </div>
          </ActionForm>
        </Section>

        <WhatWeStore />

        {/* ---------- Members ---------- */}
        <Section id="members" title="Household accounts" description="Owners manage everything. Members can view activity and label events.">
          <ul className="divide-y divide-line">
            {users.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <span className="text-sm">
                  {u.email} <span className="text-muted">· {u.role}{u.id === user.id ? " (you)" : ""}</span>
                </span>
                {u.id !== user.id && (
                  <ActionForm action={removeMemberAction}>
                    <input type="hidden" name="id" value={u.id} />
                    <SubmitButton className="btn-ghost text-danger" confirm={`Remove ${u.email}?`}>Remove</SubmitButton>
                  </ActionForm>
                )}
              </li>
            ))}
          </ul>
          <ActionForm action={addMemberAction} className="mt-4 grid gap-3 border-t border-line pt-4 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end" resetOnSuccess>
            <div>
              <label className="label" htmlFor="m-email">Email</label>
              <input className="input" id="m-email" name="email" type="email" required autoComplete="off" />
            </div>
            <div>
              <label className="label" htmlFor="m-pw">Temporary password</label>
              <input className="input" id="m-pw" name="password" type="password" minLength={10} required autoComplete="new-password" />
            </div>
            <div>
              <label className="label" htmlFor="m-role">Role</label>
              <select className="input" id="m-role" name="role" defaultValue="member">
                <option value="member">Member</option>
                <option value="owner">Owner</option>
              </select>
            </div>
            <SubmitButton className="btn-secondary">
              <UserPlus aria-hidden className="h-4 w-4" /> Add
            </SubmitButton>
          </ActionForm>
        </Section>

        {/* ---------- Audit ---------- */}
        <Section id="audit" title="Audit log" description="Configuration changes, data actions and triggered automations (latest 50).">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="text-xs text-muted">
                <tr>
                  <th className="py-2 pr-3 font-medium">When</th>
                  <th className="py-2 pr-3 font-medium">Who</th>
                  <th className="py-2 pr-3 font-medium">Action</th>
                  <th className="py-2 font-medium">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {auditRows.map((a) => (
                  <tr key={a.id}>
                    <td className="whitespace-nowrap py-1.5 pr-3 align-top text-muted">{formatDateTime(a.ts, tz)}</td>
                    <td className="py-1.5 pr-3 align-top">{actorLabel(a.actor, users)}</td>
                    <td className="py-1.5 pr-3 align-top font-mono text-xs">{a.action}</td>
                    <td className="max-w-xs truncate py-1.5 align-top text-xs text-muted" title={JSON.stringify(a.details)}>
                      {Object.keys(a.details).length ? JSON.stringify(a.details) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section id="not-included" title="Deliberately not included">
          <div className="flex gap-3 text-sm">
            <ShieldOff aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-muted" />
            <p className="text-muted">
              No face recognition, no identity matching of strangers, no face-based internet searches and no criminal-record lookups. These are
              outside the MVP and would need a separate feasibility, legal, privacy and source-quality assessment, an authorized data source, robust
              identity verification and human review before any work begins. See <code>docs/FUTURE_RESEARCH.md</code>.
            </p>
          </div>
        </Section>
      </div>
    </>
  );
}

function actorLabel(actor: string, users: { id: string; email: string }[]) {
  const u = users.find((x) => x.id === actor);
  if (u) return u.email.replace(/^(.).*(@.*)$/, "$1•••$2");
  return actor === "system" ? "System" : actor === "ring" ? "Ring" : actor;
}

function WhatWeStore() {
  const items = [
    { icon: Database, title: "Event metadata", text: "Time, camera, category, short summary, provider-reported details, your labels and the notification decision. Deleted after your retention period." },
    { icon: Users, title: "Household profiles", text: "Display name, optional relationship, preferences and consent status. No photos, faces or biometric data." },
    { icon: KeyRound, title: "Ring tokens", text: "OAuth tokens encrypted with AES-256-GCM on the server. Never sent to the browser. Your Ring password is never requested." },
    { icon: Lock, title: "Accounts", text: "Email and a salted scrypt password hash. Sessions are random tokens stored only as hashes." },
    { icon: CheckCircle2, title: "Video", text: "Not stored. Recordings are streamed from Ring only when you press “Load recording”. No video or images are sent to external AI services." },
    { icon: ScrollText, title: "Audit log", text: "Configuration changes and automations, with secrets and emails redacted." },
  ];
  return (
    <Section id="stored" title="What this app stores">
      <ul className="grid gap-3 sm:grid-cols-2">
        {items.map(({ icon: Icon, title, text }) => (
          <li key={title} className="flex gap-3 rounded-lg bg-sunken p-3">
            <Icon aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
            <div>
              <p className="text-sm font-medium">{title}</p>
              <p className="text-sm text-muted">{text}</p>
            </div>
          </li>
        ))}
      </ul>
    </Section>
  );
}
