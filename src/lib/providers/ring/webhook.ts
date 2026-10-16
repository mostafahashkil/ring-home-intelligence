/**
 * Ring webhook (v1.1) verification and parsing, per the Ring Partner API "Notifications" docs:
 *  - X-Signature: "sha256=" + hex(HMAC-SHA256(signing_key, raw_body)). Verify raw bytes BEFORE parsing.
 *  - Idempotency via meta.request_id (Ring retries up to 6 times).
 *  - data.type ∈ motion_detected | button_press | device_added | device_removed | device_online | device_offline |
 *    app_integration_added | app_integration_removed | subscription_activated | subscription_deactivated
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { ProviderEventInput } from "../../domain/types";

export function verifyWebhookSignature(signingKey: string, rawBody: string | Buffer, header: string | null): boolean {
  if (!header) return false;
  const received = header.startsWith("sha256=") ? header.slice(7) : header;
  if (!/^[0-9a-f]{64}$/i.test(received)) return false;
  const expected = createHmac("sha256", signingKey).update(rawBody).digest("hex");
  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(received.toLowerCase(), "hex"));
}

export const RingWebhookSchema = z.object({
  meta: z.object({
    version: z.string(),
    time: z.string(),
    request_id: z.string().min(1).max(128),
    account_id: z.string().optional(),
  }),
  data: z.object({
    id: z.string().min(1).max(256),
    type: z.string().min(1).max(64),
    attributes: z
      .object({
        source: z.string().min(1).max(256),
        source_type: z.string().optional(),
        timestamp: z.number().int().positive(),
        sub_type: z.string().max(64).optional(),
        component_ids: z.array(z.string().max(16)).max(8).optional(),
      })
      .passthrough(),
  }),
});
export type RingWebhook = z.infer<typeof RingWebhookSchema>;

const KIND: Record<string, ProviderEventInput["kind"]> = {
  motion_detected: "motion",
  button_press: "doorbell",
  device_online: "device_online",
  device_offline: "device_offline",
  device_added: "device_added",
  device_removed: "device_removed",
};

export type ParsedWebhook =
  | { kind: "event"; requestId: string; accountId: string | null; input: ProviderEventInput }
  | { kind: "integration"; requestId: string; accountId: string | null; type: string }
  | { kind: "ignored"; requestId: string; type: string };

export function parseRingWebhook(body: unknown): ParsedWebhook | null {
  const parsed = RingWebhookSchema.safeParse(body);
  if (!parsed.success) return null;
  const { meta, data } = parsed.data;
  const kind = KIND[data.type];
  if (kind) {
    return {
      kind: "event",
      requestId: meta.request_id,
      accountId: meta.account_id ?? null,
      input: {
        provider: "ring",
        providerEventId: data.id,
        timestamp: data.attributes.timestamp,
        endTimestamp: null,
        providerDeviceId: data.attributes.source,
        kind,
        subType: data.attributes.sub_type ?? null,
        componentIds: data.attributes.component_ids,
        demo: false,
      },
    };
  }
  if (/^(app_integration|subscription)_/.test(data.type)) {
    return { kind: "integration", requestId: meta.request_id, accountId: meta.account_id ?? null, type: data.type };
  }
  return { kind: "ignored", requestId: meta.request_id, type: data.type };
}

/** History event_type → provider input. "on_demand" (live view sessions) is not household activity and is skipped. */
export function historyToInput(
  deviceId: string,
  e: { id: string; eventType: string; start: number; end: number | null },
  subType: string | null,
): ProviderEventInput | null {
  if (e.eventType === "ding") {
    return { provider: "ring", providerEventId: `history:${e.id}`, timestamp: e.start, endTimestamp: e.end, providerDeviceId: deviceId, kind: "doorbell", demo: false };
  }
  if (e.eventType === "motion" || e.eventType.startsWith("motion.")) {
    const sub = e.eventType.includes(".") ? e.eventType.split(".")[1]! : subType;
    return {
      provider: "ring",
      providerEventId: `history:${e.id}`,
      timestamp: e.start,
      endTimestamp: e.end,
      providerDeviceId: deviceId,
      kind: "motion",
      subType: sub,
      demo: false,
    };
  }
  return null;
}
