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
export async function activeProviders(): Promise<EventProvider[]> {
  const providers = getProviders();
  const states = await Promise.all(providers.map(async (p) => (await p.connection()).state));
  return providers.filter((p, i) => {
    const s = states[i];
    return p.isDemo ? s === "demo" : s === "connected" || s === "error";
  });
}

/** Only categories that at least one active provider supports are offered in filters and rules. */
export async function supportedCategories(): Promise<EventCategory[]> {
  const set = new Set<EventCategory>();
  for (const p of await activeProviders()) p.supportedCategories.forEach((c) => set.add(c));
  return [...set];
}

export async function isDemoMode(): Promise<boolean> {
  return (await getSettings()).demoEnabled;
}

export async function syncProvider(id: ProviderId, actor: string) {
  const provider = getProvider(id);
  const { cameras, events } = await provider.sync();
  for (const c of cameras) await upsertCamera({ ...c, provider: provider.id, demo: provider.isDemo });
  const counts = { created: 0, merged: 0, duplicate: 0, invalid: 0 };
  // Oldest first so behavior patterns and merges see events in order.
  for (const e of [...events].sort((a, b) => a.timestamp - b.timestamp)) {
    const r = await ingest(e);
    counts[r.status]++;
  }
  await audit(actor, "provider.synced", id, { cameras: cameras.length, ...counts });
  return { cameras: cameras.length, ...counts };
}
