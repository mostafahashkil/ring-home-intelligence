import { getMeta, setMeta } from "../../repo/settings";
import { log } from "../../util/log";
import { Capability, EventProvider, ProviderCameraInput, ProviderConnection } from "../types";
import { EventCategory, ProviderEventInput } from "../../domain/types";
import { getAccessToken, hasAnyRingSetup, isRingConnected, loadCredentials, refreshTokens, RingAuthError, setAccountId } from "./auth";
import { RingApiError, RingClient } from "./client";
import { historyToInput } from "./webhook";

/** History queries, most specific first; the first query that returns an event id assigns its sub-type. */
const HISTORY_QUERIES: { filter: string; subType: string | null }[] = [
  { filter: "motion.human", subType: "human" },
  { filter: "motion.vehicle", subType: "vehicle" },
  { filter: "motion.animal", subType: "animal" },
  { filter: "ding", subType: null },
  { filter: "motion", subType: "motion" },
];

export function createRingClient(fetchImpl?: typeof fetch) {
  return new RingClient({
    getAccessToken: () => getAccessToken(fetchImpl),
    refreshAccessToken: () => refreshTokens(fetchImpl),
    fetchImpl,
  });
}

export class RingProvider implements EventProvider {
  id = "ring" as const;
  label = "Ring (Partner API)";
  isDemo = false;
  supportedCategories: EventCategory[] = ["arrival", "visitor", "package", "doorbell", "vehicle", "motion", "behavior", "device"];
  capabilities: Capability[] = [
    { feature: "Motion events (webhook + history)", support: "supported", note: "motion_detected webhooks and Event History." },
    { feature: "Person / vehicle / package classification", support: "partial", note: "Only when Smart Alerts are enabled on the device in the Ring app (sub_type human, vehicle, package_delivery)." },
    { feature: "Doorbell presses", support: "supported", note: "button_press webhooks and history “ding” events." },
    { feature: "Camera online/offline", support: "supported", note: "device_online / device_offline webhooks and device status." },
    { feature: "Recorded clips", support: "supported", note: "MP4 download for motion and doorbell events, proxied on demand — not stored by this app." },
    { feature: "Household member identification", support: "unsupported", note: "Ring's API does not identify people. Arrivals come only from your own confirmations." },
    { feature: "Clothing / carried-object descriptions", support: "unsupported", note: "Not provided by Ring. No video is sent to external AI services." },
    { feature: "Delivery carrier name", support: "unsupported", note: "Never inferred." },
    { feature: "Door-handle attempts / tamper detection", support: "unsupported", note: "Not reported by Ring's API." },
    { feature: "Prolonged activity", support: "partial", note: "Derived from Event History start/end times after a sync." },
    { feature: "Security routines (sirens, locks)", support: "unsupported", note: "Read-only scope (ava.v1:read). Nothing is ever actuated." },
  ];

  constructor(private fetchImpl?: typeof fetch) {}

  async connection(): Promise<ProviderConnection> {
    const lastSyncAt = Number(await getMeta("ring.lastSyncAt")) || null;
    const creds = await loadCredentials();
    if (!hasAnyRingSetup() && !creds) {
      return { state: "not_configured", message: "Ring isn't configured on this server. See README → Connecting Ring.", lastSyncAt };
    }
    if (creds?.status === "auth_expired") {
      return { state: "auth_expired", message: "Ring authorization expired. Reconnect to resume updates.", lastSyncAt };
    }
    if (!(await isRingConnected())) {
      return { state: "disconnected", message: "Ring is configured but not connected yet.", lastSyncAt };
    }
    const lastError = await getMeta("ring.lastSyncError");
    if (lastError) return { state: "error", message: lastError, lastSyncAt };
    return { state: "connected", message: "Connected to the Ring Partner API.", lastSyncAt };
  }

  async sync(): Promise<{ cameras: ProviderCameraInput[]; events: ProviderEventInput[] }> {
    const client = createRingClient(this.fetchImpl);
    try {
      if (!(await loadCredentials())?.accountId) {
        try {
          await setAccountId(await client.getAccountId());
        } catch (err) {
          log.warn("ring.account_id_unavailable", { err: err as Error });
        }
      }
      const devices = await client.listDevices();
      const cameras: ProviderCameraInput[] = [];
      const events: ProviderEventInput[] = [];
      for (const d of devices) {
        let online: boolean | null = null;
        let caps = { hasVideo: true, componentIds: [] as string[] };
        try {
          online = await client.getOnline(d.id);
        } catch (err) {
          if (!(err instanceof RingApiError) || err.code !== "device_offline") throw err;
          online = false;
        }
        try {
          caps = await client.getCapabilities(d.id);
        } catch (err) {
          log.warn("ring.capabilities_unavailable", { err: err as Error });
        }
        cameras.push({
          providerDeviceId: d.id,
          name: d.name,
          zone: null,
          status: online === null ? "unknown" : online ? "online" : "offline",
          supportsClips: caps.hasVideo,
          componentIds: caps.componentIds,
        });
        if (!caps.hasVideo) continue; // chimes etc. have no motion history
        const seen = new Set<string>();
        for (const q of HISTORY_QUERIES) {
          const page = await client.getHistory(d.id, q.filter);
          for (const h of page) {
            if (seen.has(h.id)) continue;
            seen.add(h.id);
            const input = historyToInput(d.id, h, q.subType);
            if (input) events.push(input);
          }
        }
      }
      await setMeta("ring.lastSyncAt", String(Date.now()));
      await setMeta("ring.lastSyncError", "");
      return { cameras, events };
    } catch (err) {
      const message =
        err instanceof RingApiError || err instanceof RingAuthError ? err.message : "Couldn't reach Ring. Try again later.";
      await setMeta("ring.lastSyncError", message);
      log.error("ring.sync_failed", { err: err as Error });
      throw err;
    }
  }
}
