import { AlertTriangle, ListChecks, Plus } from "lucide-react";
import { requireAppUser } from "@/lib/app-context";
import { can } from "@/lib/auth/core";
import {
  Camera,
  CATEGORY_LABELS,
  EventCategory,
  Profile,
  Rule,
  RULE_ACTION_LABELS,
  RULE_ACTIONS,
  SEVERITIES,
  SEVERITY_LABELS,
} from "@/lib/domain/types";
import { listRules } from "@/lib/repo/rules";
import { listCameras } from "@/lib/repo/cameras";
import { listProfiles } from "@/lib/repo/profiles";
import { getSettings } from "@/lib/repo/settings";
import { findConflicts } from "@/lib/rules/engine";
import { supportedCategories } from "@/lib/providers/registry";
import { ActionForm, SubmitButton } from "@/components/forms";
import { RulePreview } from "@/components/RulePreview";
import { EmptyState, Notice, PageHeader, Section } from "@/components/ui";
import { deleteRuleAction, previewRulesAction, saveRuleAction } from "../actions";

export const metadata = { title: "Rules & Automations" };

export default async function RulesPage() {
  const user = await requireAppUser();
  const settings = getSettings();
  const rules = listRules();
  const cameras = listCameras();
  const profiles = listProfiles();
  const categories = supportedCategories();
  const conflicts = findConflicts(rules);
  const editable = can(user.role, "rules:manage");
  const camName = new Map(cameras.map((c) => [c.id, c.name]));
  const profName = new Map(profiles.map((p) => [p.id, p.displayName]));

  return (
    <>
      <PageHeader
        title="Rules & Automations"
        description="Rules decide how each event reaches you. One event produces at most one notification: the highest-priority matching rule wins, then quiet hours, deduplication and cooldown apply."
      />

      <div className="mb-6 space-y-3">
        <Notice tone="info" icon={ListChecks} title="Allowed actions">
          Push alert, in-app notification, quiet log, or keeping a clip reference. “Security routine” never runs on its own — it asks you to confirm,
          and no routines are connected (Ring access is read-only). Nothing in this app contacts police, unlocks doors, or confronts anyone.
        </Notice>
        {conflicts.length > 0 && (
          <Notice tone="warn" icon={AlertTriangle} title={`${conflicts.length} overlapping rule${conflicts.length > 1 ? "s" : ""}`}>
            <ul className="list-disc pl-4">
              {conflicts.map((c) => (
                <li key={c.a.id + c.b.id}>{c.note}</li>
              ))}
            </ul>
          </Notice>
        )}
      </div>

      <div className="space-y-6">
        <Section id="rules" title="Your rules" description="Sorted by priority (highest first).">
          {rules.length === 0 ? (
            <EmptyState icon={ListChecks} title="No rules">
              Without rules, routine events are logged quietly and safety patterns follow the response ladder in settings.
            </EmptyState>
          ) : (
            <ul className="space-y-3">
              {rules.map((r) => (
                <li key={r.id} id={r.id} className={`rounded-xl border border-line p-3 ${r.enabled ? "" : "opacity-70"}`}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">
                        {r.name} {!r.enabled && <span className="text-sm font-normal text-muted">(off)</span>}
                      </p>
                      <p className="mt-0.5 text-sm text-muted">{describe(r, camName, profName)}</p>
                    </div>
                    <div className="flex gap-1.5">
                      <span className="chip border-line text-muted">Priority {r.priority}</span>
                      <span className="chip border-accent/40 text-accent">{RULE_ACTION_LABELS[r.action]}</span>
                    </div>
                  </div>
                  {editable && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-sm font-medium text-accent">Edit rule</summary>
                      <RuleForm rule={r} cameras={cameras} profiles={profiles} categories={categories} />
                      <ActionForm action={deleteRuleAction} className="mt-3 border-t border-line pt-3">
                        <input type="hidden" name="id" value={r.id} />
                        <SubmitButton className="btn-danger" confirm={`Delete rule “${r.name}”?`}>Delete rule</SubmitButton>
                      </ActionForm>
                    </details>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Section>

        {editable && (
          <Section id="new" title="Add a rule">
            <RuleForm cameras={cameras} profiles={profiles} categories={categories} />
          </Section>
        )}

        <Section
          id="preview"
          title="Test mode"
          description={`Try a hypothetical event against your current rules and settings (time zone ${settings.timezone}).`}
        >
          <RulePreview
            action={previewRulesAction}
            categories={categories.map((c) => ({ value: c, label: CATEGORY_LABELS[c] }))}
            cameras={cameras.map((c) => ({ value: c.id, label: c.name + (c.demo ? " (demo)" : "") }))}
            profiles={profiles.map((p) => ({ value: p.id, label: p.displayName + (p.demo ? " (demo)" : "") }))}
            severities={SEVERITIES.map((s) => ({ value: s, label: SEVERITY_LABELS[s] }))}
          />
        </Section>
      </div>
    </>
  );
}

function describe(r: Rule, cam: Map<string, string>, prof: Map<string, string>) {
  const parts = [r.categories.length ? r.categories.map((c) => CATEGORY_LABELS[c]).join(", ") : "Any event"];
  if (r.cameraIds.length) parts.push(`at ${r.cameraIds.map((id) => cam.get(id) ?? "removed camera").join(", ")}`);
  if (r.profileIds.length) parts.push(`for ${r.profileIds.map((id) => prof.get(id) ?? "removed profile").join(", ")}`);
  if (r.minSeverity) parts.push(`severity ≥ ${SEVERITY_LABELS[r.minSeverity].toLowerCase()}`);
  if (r.minConfidence !== null) parts.push(`confidence ≥ ${Math.round(r.minConfidence * 100)}%`);
  if (r.timeWindow) parts.push(`${r.timeWindow.start}–${r.timeWindow.end}`);
  return parts.join(" · ");
}

function RuleForm({ rule, cameras, profiles, categories }: { rule?: Rule; cameras: Camera[]; profiles: Profile[]; categories: EventCategory[] }) {
  const idp = rule?.id ?? "new";
  return (
    <ActionForm action={saveRuleAction} className="mt-3 grid gap-3 sm:grid-cols-2" resetOnSuccess={!rule}>
      {rule && <input type="hidden" name="id" value={rule.id} />}
      <div>
        <label className="label" htmlFor={`${idp}-name`}>Name</label>
        <input className="input" id={`${idp}-name`} name="name" defaultValue={rule?.name} maxLength={80} required />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor={`${idp}-action`}>Action</label>
          <select className="input" id={`${idp}-action`} name="action" defaultValue={rule?.action ?? "in_app"}>
            {RULE_ACTIONS.map((a) => <option key={a} value={a}>{RULE_ACTION_LABELS[a]}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor={`${idp}-prio`}>Priority</label>
          <input className="input" type="number" min={0} max={1000} id={`${idp}-prio`} name="priority" defaultValue={rule?.priority ?? 50} />
        </div>
      </div>
      <fieldset className="sm:col-span-2">
        <legend className="label">Event categories <span className="font-normal text-muted">(none = any)</span></legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {categories.map((c) => (
            <label key={c} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="categories" value={c} defaultChecked={rule?.categories.includes(c)} /> {CATEGORY_LABELS[c]}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="label">Cameras <span className="font-normal text-muted">(none = any)</span></legend>
        <div className="flex flex-col gap-1">
          {cameras.map((c) => (
            <label key={c.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="cameraIds" value={c.id} defaultChecked={rule?.cameraIds.includes(c.id)} /> {c.name}
              {c.demo && <span className="text-xs text-demo">demo</span>}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="label">People <span className="font-normal text-muted">(none = anyone)</span></legend>
        <div className="flex flex-col gap-1">
          {profiles.map((p) => (
            <label key={p.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="profileIds" value={p.id} defaultChecked={rule?.profileIds.includes(p.id)} /> {p.displayName}
              {p.demo && <span className="text-xs text-demo">demo</span>}
            </label>
          ))}
        </div>
      </fieldset>
      <div>
        <label className="label" htmlFor={`${idp}-sev`}>Minimum severity</label>
        <select className="input" id={`${idp}-sev`} name="minSeverity" defaultValue={rule?.minSeverity ?? ""}>
          <option value="">Any</option>
          {SEVERITIES.map((s) => <option key={s} value={s}>{SEVERITY_LABELS[s]}</option>)}
        </select>
      </div>
      <div>
        <label className="label" htmlFor={`${idp}-conf`}>Minimum confidence (%)</label>
        <input className="input" type="number" min={0} max={100} id={`${idp}-conf`} name="minConfidence" defaultValue={rule?.minConfidence != null ? Math.round(rule.minConfidence * 100) : ""} />
        <p className="hint">Events without a confidence score won&apos;t match when this is set.</p>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:col-span-2 sm:max-w-sm">
        <div>
          <label className="label" htmlFor={`${idp}-ws`}>Active from</label>
          <input className="input" type="time" id={`${idp}-ws`} name="windowStart" defaultValue={rule?.timeWindow?.start} />
        </div>
        <div>
          <label className="label" htmlFor={`${idp}-we`}>Until</label>
          <input className="input" type="time" id={`${idp}-we`} name="windowEnd" defaultValue={rule?.timeWindow?.end} />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="enabled" defaultChecked={rule?.enabled ?? true} /> Rule enabled
      </label>
      <div className="sm:col-span-2">
        <SubmitButton pendingText="Saving…">
          {rule ? "Save rule" : (
            <>
              <Plus aria-hidden className="h-4 w-4" /> Add rule
            </>
          )}
        </SubmitButton>
      </div>
    </ActionForm>
  );
}
