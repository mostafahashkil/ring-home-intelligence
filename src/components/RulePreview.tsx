"use client";

import { startTransition, useActionState } from "react";
import type { ActionResult } from "@/lib/action-result";
import type { Decision } from "@/lib/domain/types";
import { FlaskConical, Loader2, Play, ShieldCheck } from "lucide-react";
import { ResultMessage } from "./forms";

type Option = { value: string; label: string };

const CHANNEL_TEXT: Record<Decision["channel"], string> = {
  push: "Push alert",
  in_app: "In-app notification",
  quiet_log: "Quiet log (no alert)",
  review: "Ask for review",
  none: "Nothing",
};

export function RulePreview({
  action,
  categories,
  cameras,
  profiles,
  severities,
}: {
  action: (prev: ActionResult | null, form: FormData) => Promise<ActionResult>;
  categories: Option[];
  cameras: Option[];
  profiles: Option[];
  severities: Option[];
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const data = state?.ok ? (state.data as { decision: Decision; copy: { title: string; body: string } }) : null;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          // Submit manually so the inputs keep their values next to the result (form actions reset the form).
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          startTransition(() => formAction(data));
        }}
      >
        <div>
          <label className="label" htmlFor="pv-cat">Event category</label>
          <select className="input" id="pv-cat" name="category" defaultValue="package">
            {categories.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="pv-cam">Camera</label>
          <select className="input" id="pv-cam" name="cameraId">
            <option value="">Any / unknown</option>
            {cameras.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="pv-prof">Household member</label>
          <select className="input" id="pv-prof" name="profileId">
            <option value="">None</option>
            {profiles.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="pv-conf">Match/confidence %</label>
          <input className="input" id="pv-conf" name="confidence" type="number" min={0} max={100} placeholder="blank = confirmed by you" />
        </div>
        <div>
          <label className="label" htmlFor="pv-sev">Severity</label>
          <select className="input" id="pv-sev" name="severity" defaultValue="low">
            {severities.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="pv-time">Time of day</label>
          <input className="input" id="pv-time" name="time" type="time" defaultValue="17:45" />
        </div>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" name="simulateRecent" /> Pretend a similar alert was sent a minute ago (tests deduplication)
        </label>
        <div className="sm:col-span-2">
          <button type="submit" className="btn-secondary" disabled={pending} aria-busy={pending}>
            {pending ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : <Play aria-hidden className="h-4 w-4" />}
            {pending ? "Evaluating…" : "Run preview"}
          </button>
        </div>
      </form>

      <div className="rounded-xl border border-dashed border-line p-4" aria-live="polite">
        <p className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted">
          <FlaskConical aria-hidden className="h-3.5 w-3.5" /> Preview result — nothing stored or sent
        </p>
        {!data && !state && <p className="text-sm text-muted">Choose a hypothetical event and run the preview to see which rule fires and why.</p>}
        {state && !state.ok && <ResultMessage state={state} />}
        {data && (
          <>
            <p className="text-lg font-semibold">{CHANNEL_TEXT[data.decision.channel]}</p>
            {data.decision.channel !== "quiet_log" && (
              <div className="mt-2 rounded-lg bg-sunken p-3">
                <p className="text-sm font-medium">{data.copy.title}</p>
                <p className="text-xs text-muted">{data.copy.body}</p>
              </div>
            )}
            <ul className="mt-3 space-y-1.5 text-sm">
              {data.decision.explanation.map((l, i) => (
                <li key={i} className="flex gap-2">
                  <ShieldCheck aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-muted" /> {l}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
