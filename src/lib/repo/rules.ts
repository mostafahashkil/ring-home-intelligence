import { getDb, json, Row } from "../db";
import { Rule, RuleSchema } from "../domain/types";
import { newId } from "../util/id";

function toRule(r: Row): Rule {
  return {
    id: r.id as string,
    name: r.name as string,
    enabled: r.enabled === 1,
    priority: r.priority as number,
    categories: json.parse(r.categories, []),
    cameraIds: json.parse(r.camera_ids, []),
    profileIds: json.parse(r.profile_ids, []),
    minConfidence: (r.min_confidence as number) ?? null,
    minSeverity: (r.min_severity as Rule["minSeverity"]) ?? null,
    timeWindow: json.parse(r.time_window, null),
    action: r.action as Rule["action"],
    createdAt: r.created_at as number,
  };
}

export async function listRules(): Promise<Rule[]> {
  const rows = await (await getDb()).all("SELECT * FROM rules ORDER BY priority DESC, created_at ASC");
  return rows.map(toRule);
}

export async function getRule(id: string): Promise<Rule | null> {
  const r = await (await getDb()).get("SELECT * FROM rules WHERE id = ?", [id]);
  return r ? toRule(r) : null;
}

export async function saveRule(input: Omit<Rule, "id" | "createdAt"> & { id?: string; createdAt?: number }): Promise<Rule> {
  const rule = RuleSchema.parse({ ...input, id: input.id ?? newId("rul"), createdAt: input.createdAt ?? Date.now() });
  await (await getDb()).run(
      `INSERT INTO rules (id, name, enabled, priority, categories, camera_ids, profile_ids, min_confidence, min_severity, time_window, action, created_at)
       VALUES (@id, @name, @enabled, @priority, @categories, @cameraIds, @profileIds, @minConfidence, @minSeverity, @timeWindow, @action, @createdAt)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, enabled = excluded.enabled, priority = excluded.priority,
         categories = excluded.categories, camera_ids = excluded.camera_ids, profile_ids = excluded.profile_ids,
         min_confidence = excluded.min_confidence, min_severity = excluded.min_severity, time_window = excluded.time_window,
         action = excluded.action`,
    {
      ...rule,
      enabled: rule.enabled ? 1 : 0,
      categories: JSON.stringify(rule.categories),
      cameraIds: JSON.stringify(rule.cameraIds),
      profileIds: JSON.stringify(rule.profileIds),
      timeWindow: json.str(rule.timeWindow),
    },
  );
  return (await getRule(rule.id))!;
}

export async function deleteRule(id: string) {
  await (await getDb()).run("DELETE FROM rules WHERE id = ?", [id]);
}
