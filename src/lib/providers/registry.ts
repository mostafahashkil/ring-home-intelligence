import { EventCategory, ProviderId } from "../domain/types";
import { ingest } from "../pipeline";
import { audit } from "../repo/audit";
import { upsertCamera } from "../repo/cameras";
import { getSettings } from "../repo/settings";
import { DemoProvider } from "./demo";
import { RingProvider } from "./ring/provider";
import { EventProvider } from "./types";

export function getProviders(): EventProvider[] {
  return [new RingProvider(), new DemoProvider()];
}

export function getProvider(id: ProviderId): EventProvider {
  return id === "ring" ? new RingProvider() : new DemoProvider();
}

/** Providers currently contributing data (demo when enabled, Ring when connected or erroring). */
export function activeProviders(): EventProvider[] {
  return getProviders().filter((p) => {
    const s = p.connection().state;
    return p.isDemo ? s === "demo" : s === "connected" || s === "error";
  });
}

/** Only categories that at least one active provider supports are offered in filters and rules. */
export function supportedCategories(): EventCategory[] {
  const set = new Set<EventCategory>();
  for (const p of activeProviders()) p.supportedCategories.forEach((c) => set.add(c));
  return [...set];
}

export function isDemoMode(): boolean {
  return getSettings().demoEnabled;
}

export async function syncProvider(id: ProviderId, actor: string) {
  const provider = getProvider(id);
  const { cameras, events } = await provider.sync();
  for (const c of cameras) upsertCamera({ ...c, provider: provider.id, demo: provider.isDemo });
  const counts = { created: 0, merged: 0, duplicate: 0, invalid: 0 };
  // Oldest first so behavior patterns and merges see events in order.
  for (const e of [...events].sort((a, b) => a.timestamp - b.timestamp)) {
    const r = await ingest(e);
    counts[r.status]++;
  }
  audit(actor, "provider.synced", id, { cameras: cameras.length, ...counts });
  return { cameras: cameras.length, ...counts };
}
