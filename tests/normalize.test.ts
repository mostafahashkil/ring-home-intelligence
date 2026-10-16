import { describe, expect, it } from "vitest";
import { normalize, evidenceFor } from "@/lib/events/normalize";
import { ProviderEventInput } from "@/lib/domain/types";

const ctx = { cameraId: "cam_1", cameraName: "Front door", zone: null, now: 1 };
const ring = (over: Partial<ProviderEventInput>): ProviderEventInput => ({
  provider: "ring",
  providerEventId: "dev_motion_1",
  timestamp: 1_786_715_596_787,
  providerDeviceId: "ava1.ring.device.X",
  kind: "motion",
  demo: false,
  ...over,
});

describe("Ring normalization", () => {
  it.each([
    ["human", "visitor", /not identified/],
    ["vehicle", "vehicle", /Vehicle detected/],
    ["package_delivery", "package", /Possible delivery/],
    ["motion", "motion", /Motion detected/],
    ["other_motion", "motion", /Motion detected/],
    ["animal", "motion", /Animal motion/],
  ])("maps sub_type %s → %s", (sub, category, summary) => {
    const e = normalize(ring({ subType: sub }), ctx);
    expect(e.eventType).toBe(category);
    expect(e.summary).toMatch(summary);
    expect(e.observations.every((o) => o.source === "provider")).toBe(true);
    expect(e.demo).toBe(false);
    expect(e.householdProfileId).toBeNull();
  });

  it("passes unknown sub_types through instead of dropping them", () => {
    const e = normalize(ring({ subType: "drone" }), ctx);
    expect(e.eventType).toBe("motion");
    expect(e.providerType).toBe("motion.drone");
    expect(e.observations[0]!.text).toContain("drone");
  });

  it("labels package classification as an inference with no carrier named", () => {
    const e = normalize(ring({ subType: "package_delivery" }), ctx);
    expect(e.inference?.label).toMatch(/delivery company not confirmed/);
    expect(e.summary).not.toMatch(/UPS|FedEx|Amazon|USPS|DHL/i);
  });

  it("never invents a confidence score for Ring events", () => {
    expect(normalize(ring({ subType: "human" }), ctx).confidence).toBeNull();
  });

  it("maps doorbell and device status events", () => {
    expect(normalize(ring({ kind: "doorbell" }), ctx).eventType).toBe("doorbell");
    const off = normalize(ring({ kind: "device_offline" }), ctx);
    expect(off.eventType).toBe("device");
    expect(off.severity).toBe("attention");
  });

  it("only motion and doorbell events reference a recording", () => {
    expect(evidenceFor(ring({ kind: "motion" }))?.kind).toBe("ring_recording");
    expect(evidenceFor(ring({ kind: "doorbell" }))?.kind).toBe("ring_recording");
    expect(evidenceFor(ring({ kind: "device_online" }))).toBeNull();
  });

  it("uses history start/end for clip duration and keeps the component id", () => {
    const ev = evidenceFor(ring({ endTimestamp: 1_786_715_596_787 + 45_000, componentIds: ["2"] }));
    expect(ev).toMatchObject({ kind: "ring_recording", durationMs: 45_000, componentId: "2" });
    const long = evidenceFor(ring({ endTimestamp: 1_786_715_596_787 + 3_600_000 }));
    expect(long && long.kind === "ring_recording" && long.durationMs).toBe(120_000);
  });
});

describe("demo normalization", () => {
  it("marks demo observations and evidence as demo", () => {
    const e = normalize(
      {
        provider: "demo",
        providerEventId: "d1",
        timestamp: 5,
        providerDeviceId: "demo-front-door",
        kind: "doorbell",
        demo: true,
        demoDetails: { category: "visitor", summary: "Unrecognized person wearing a red jacket", observations: ["Rang the doorbell."] },
      },
      ctx,
    );
    expect(e.demo).toBe(true);
    expect(e.observations[0]!.source).toBe("demo");
    expect(e.evidenceReference?.kind).toBe("demo");
    expect(e.summary).not.toMatch(/suspicious/i);
  });
});
