import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { historyToInput, parseRingWebhook, verifyWebhookSignature } from "@/lib/providers/ring/webhook";

// Payload copied from the Ring Partner API "Motion Detection" documentation.
export const DOC_MOTION = {
  meta: {
    version: "1.1",
    time: "2026-02-13T13:39:57.200155525Z",
    request_id: "2ad45ade-1818-4154-813b-afdd8bcd8085",
    account_id: "ava1.ring.account.XXXYYY",
  },
  data: {
    id: "ava1.ring.device.XXXYYY_motion_1786715596787",
    type: "motion_detected",
    attributes: {
      source: "ava1.ring.device.XXXYYY",
      source_type: "devices",
      timestamp: 1786715596787,
      timestamp_readable: "2026-08-14 08:53:16",
      sub_type: "motion",
      component_ids: ["0"],
    },
    relationships: { devices: { links: { self: "/v1/devices/ava1.ring.device.XXXYYY" } } },
  },
};

const KEY = "test-signing-key";
const sign = (body: string, key = KEY) => "sha256=" + createHmac("sha256", key).update(body).digest("hex");

describe("webhook signature", () => {
  const raw = JSON.stringify(DOC_MOTION);

  it("accepts a valid sha256= hex signature over the raw body", () => {
    expect(verifyWebhookSignature(KEY, raw, sign(raw))).toBe(true);
  });

  it("rejects missing, malformed, wrong-key and tampered signatures", () => {
    expect(verifyWebhookSignature(KEY, raw, null)).toBe(false);
    expect(verifyWebhookSignature(KEY, raw, "sha256=nothex")).toBe(false);
    expect(verifyWebhookSignature(KEY, raw, sign(raw, "other-key"))).toBe(false);
    expect(verifyWebhookSignature(KEY, raw.replace("motion", "human"), sign(raw))).toBe(false);
  });

  it("is sensitive to re-serialization (verify raw bytes, not parsed JSON)", () => {
    const pretty = JSON.stringify(DOC_MOTION, null, 2);
    expect(verifyWebhookSignature(KEY, pretty, sign(raw))).toBe(false);
  });
});

describe("webhook parsing", () => {
  it("parses the documented motion payload", () => {
    const p = parseRingWebhook(DOC_MOTION);
    expect(p?.kind).toBe("event");
    if (p?.kind !== "event") return;
    expect(p.requestId).toBe(DOC_MOTION.meta.request_id);
    expect(p.input).toMatchObject({
      provider: "ring",
      kind: "motion",
      subType: "motion",
      providerDeviceId: "ava1.ring.device.XXXYYY",
      componentIds: ["0"],
      demo: false,
    });
  });

  it("parses button_press and device status events", () => {
    const press = { ...DOC_MOTION, data: { ...DOC_MOTION.data, id: "x_button_press_1", type: "button_press", attributes: { source: "dev", source_type: "devices", timestamp: 1771027372393 } } };
    const p = parseRingWebhook(press);
    expect(p?.kind === "event" && p.input.kind).toBe("doorbell");
    const off = parseRingWebhook({ ...press, data: { ...press.data, type: "device_offline" } });
    expect(off?.kind === "event" && off.input.kind).toBe("device_offline");
  });

  it("routes integration lifecycle events separately and ignores unknown types", () => {
    const integ = parseRingWebhook({ ...DOC_MOTION, data: { ...DOC_MOTION.data, type: "app_integration_removed" } });
    expect(integ?.kind).toBe("integration");
    const unknown = parseRingWebhook({ ...DOC_MOTION, data: { ...DOC_MOTION.data, type: "something_new" } });
    expect(unknown?.kind).toBe("ignored");
  });

  it("rejects malformed payloads", () => {
    expect(parseRingWebhook({})).toBeNull();
    expect(parseRingWebhook({ meta: DOC_MOTION.meta, data: { id: "x", type: "motion_detected", attributes: { source: "d" } } })).toBeNull();
  });
});

describe("history mapping", () => {
  it("maps motion/ding and skips on_demand live-view sessions", () => {
    expect(historyToInput("d", { id: "1", eventType: "motion", start: 10, end: 20 }, "human")).toMatchObject({ kind: "motion", subType: "human", endTimestamp: 20, providerEventId: "history:1" });
    expect(historyToInput("d", { id: "2", eventType: "ding", start: 10, end: 20 }, null)?.kind).toBe("doorbell");
    expect(historyToInput("d", { id: "3", eventType: "on_demand", start: 10, end: 20 }, null)).toBeNull();
  });
});
