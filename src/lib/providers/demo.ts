/**
 * Demo provider — sample data only. Every camera, event and profile it produces is flagged `demo`
 * and rendered with a visible "Demo" label. It exists so the app is usable without Ring credentials
 * and to illustrate features the Ring API does not support (people descriptions, door-handle signals).
 * "Matches" with household profiles here are simulated; this app has no face recognition.
 */
import { randomBytes } from "node:crypto";
import { ProviderEventInput } from "../domain/types";
import { getSettings } from "../repo/settings";
import { EventProvider, ProviderCameraInput, ProviderConnection } from "./types";

export const DEMO_CAMERAS: ProviderCameraInput[] = [
  { providerDeviceId: "demo-front-door", name: "Front door", zone: "Entrance", status: "online", supportsClips: false, componentIds: [] },
  { providerDeviceId: "demo-driveway", name: "Driveway", zone: "Driveway", status: "online", supportsClips: false, componentIds: [] },
  { providerDeviceId: "demo-side-gate", name: "Side gate", zone: "Side yard", status: "online", supportsClips: false, componentIds: [] },
  { providerDeviceId: "demo-backyard", name: "Backyard", zone: "Garden", status: "online", supportsClips: false, componentIds: [] },
  { providerDeviceId: "demo-garage", name: "Garage", zone: "Garage", status: "online", supportsClips: false, componentIds: [] },
];

export const DEMO_PROFILES = [
  { displayName: "Alex", relationship: "father" },
  { displayName: "Emily", relationship: "mother" },
  { displayName: "Jack", relationship: "son" },
  { displayName: "Sarah", relationship: "daughter" },
] as const;

type Template = Omit<ProviderEventInput, "provider" | "providerEventId" | "timestamp" | "demo"> & { durationSec?: number };

export const DEMO_TEMPLATES: Record<string, { label: string; build: () => Template }> = {
  arrival_alex: {
    label: "Alex arrives (simulated high-confidence signal)",
    build: () => arrival("demo-front-door", "Alex", 0.94),
  },
  arrival_sarah: {
    label: "Sarah arrives (simulated high-confidence signal)",
    build: () => arrival("demo-driveway", "Sarah", 0.9),
  },
  arrival_jack_uncertain: {
    label: "Jack may have arrived (simulated low-confidence signal)",
    build: () => arrival("demo-driveway", "Jack", 0.58),
  },
  delivery: {
    label: "Possible package delivery",
    build: () => ({
      providerDeviceId: "demo-front-door",
      kind: "motion",
      subType: "package_delivery",
      demoDetails: {
        category: "package",
        summary: "Possible delivery at your front door",
        observations: [
          "A person carrying a box approached the door.",
          "A box was placed near the doormat.",
          "The person walked back toward the street.",
        ],
        inference: {
          label: "Package activity detected; delivery company not confirmed.",
          basis: "Carrying and placing a parcel were observed. A uniform or vehicle alone is not used to name a carrier.",
        },
        confidence: 0.82,
      },
    }),
  },
  package_left: {
    label: "Package left at entrance",
    build: () => ({
      providerDeviceId: "demo-front-door",
      kind: "motion",
      subType: "package_delivery",
      demoDetails: {
        category: "package",
        summary: "Package appears to have been left near the entrance",
        observations: ["A box-shaped object has remained beside the door for 20 minutes."],
        inference: { label: "Likely an undelivered-to-hand package.", basis: "Object stayed in place after the visitor left." },
        confidence: 0.76,
      },
    }),
  },
  visitor: {
    label: "Unrecognized visitor rings the bell",
    build: () => ({
      providerDeviceId: "demo-front-door",
      kind: "doorbell",
      demoDetails: {
        category: "visitor",
        summary: "Unrecognized person wearing a red jacket and carrying a backpack",
        observations: ["Approached the front door.", "Rang the doorbell.", "Waited about 30 seconds, then left toward the sidewalk."],
      },
    }),
  },
  loitering: {
    label: "Person stays near the side gate for 4 minutes",
    build: () => ({
      providerDeviceId: "demo-side-gate",
      kind: "motion",
      subType: "human",
      durationSec: 240,
      demoDetails: {
        category: "visitor",
        summary: "Unrecognized person near the side gate",
        observations: ["Person stood near the gate.", "Looked toward the backyard several times."],
      },
    }),
  },
  door_attempts: {
    label: "Repeated attempts to open the side door",
    build: () => ({
      providerDeviceId: "demo-side-gate",
      kind: "motion",
      subType: "human",
      demoDetails: {
        category: "visitor",
        summary: "Unrecognized person at the side door",
        observations: ["Person tried the side door handle.", "Person wore a dark hooded top."],
        signals: ["door_handle_attempts"],
      },
    }),
  },
  vehicle: {
    label: "Vehicle in the driveway",
    build: () => ({
      providerDeviceId: "demo-driveway",
      kind: "motion",
      subType: "vehicle",
      demoDetails: { category: "vehicle", summary: "Vehicle pulled into the driveway", observations: ["A silver car stopped in the driveway."] },
    }),
  },
  motion: {
    label: "Generic backyard motion",
    build: () => ({
      providerDeviceId: "demo-backyard",
      kind: "motion",
      subType: "other_motion",
      demoDetails: { category: "motion", summary: "Motion in the backyard", observations: ["Small movement near the fence line."] },
    }),
  },
  camera_offline: {
    label: "Garage camera goes offline",
    build: () => ({ providerDeviceId: "demo-garage", kind: "device_offline" }),
  },
};

function arrival(device: string, profileName: string, matchConfidence: number): Template {
  return {
    providerDeviceId: device,
    kind: "motion",
    subType: "human",
    demoDetails: {
      category: "arrival",
      profileName,
      matchConfidence,
      observations: ["A person walked up and entered the house.", "Simulated household-match signal (demo only)."],
    },
  };
}

/** Seeded sample timeline, minutes before "now". */
export const DEMO_SEED: { template: keyof typeof DEMO_TEMPLATES; minutesAgo: number; confirmProfile?: string }[] = [
  { template: "motion", minutesAgo: 26 * 60 },
  { template: "vehicle", minutesAgo: 9 * 60 + 10 },
  { template: "visitor", minutesAgo: 8 * 60, confirmProfile: "Emily" },
  { template: "delivery", minutesAgo: 6 * 60 },
  { template: "package_left", minutesAgo: 5 * 60 + 40 },
  { template: "visitor", minutesAgo: 4 * 60 },
  { template: "vehicle", minutesAgo: 3 * 60 + 20 },
  { template: "loitering", minutesAgo: 2 * 60 + 45 },
  { template: "door_attempts", minutesAgo: 2 * 60 },
  { template: "arrival_sarah", minutesAgo: 90 },
  { template: "arrival_jack_uncertain", minutesAgo: 60 },
  { template: "arrival_alex", minutesAgo: 40 },
  { template: "motion", minutesAgo: 25 },
  { template: "camera_offline", minutesAgo: 10 },
];

export function buildDemoEvent(key: keyof typeof DEMO_TEMPLATES, timestamp: number): ProviderEventInput {
  const t = DEMO_TEMPLATES[key]!.build();
  const { durationSec, ...rest } = t;
  return {
    ...rest,
    provider: "demo",
    providerEventId: `demo:${key}:${timestamp}:${randomBytes(4).toString("hex")}`,
    timestamp,
    endTimestamp: durationSec ? timestamp + durationSec * 1000 : null,
    demo: true,
  };
}

export class DemoProvider implements EventProvider {
  id = "demo" as const;
  label = "Demo data";
  isDemo = true;
  supportedCategories: EventProvider["supportedCategories"] = ["arrival", "visitor", "package", "doorbell", "vehicle", "motion", "behavior", "device"];
  capabilities: EventProvider["capabilities"] = [
    { feature: "All event categories", support: "demo_only", note: "Sample events for exploring the app. Not from any camera." },
    { feature: "Household matches", support: "demo_only", note: "Simulated confidence values. No recognition is performed." },
    { feature: "People descriptions & door-handle signals", support: "demo_only", note: "Illustrative text written for the demo." },
    { feature: "Recorded clips", support: "unsupported", note: "Demo events have no video." },
  ];

  connection(): ProviderConnection {
    const enabled = getSettings().demoEnabled;
    return {
      state: enabled ? "demo" : "disconnected",
      message: enabled ? "Showing sample data — not from your cameras." : "Demo data is turned off.",
      lastSyncAt: null,
    };
  }

  async sync() {
    return { cameras: DEMO_CAMERAS, events: [] };
  }
}
