import { EventCategory, ProviderEventInput, ProviderId } from "../domain/types";

export type ConnectionState = "connected" | "not_configured" | "disconnected" | "auth_expired" | "error" | "demo";

export interface ProviderConnection {
  state: ConnectionState;
  message: string;
  lastSyncAt: number | null;
}

export interface ProviderCameraInput {
  providerDeviceId: string;
  name: string;
  zone: string | null;
  status: "online" | "offline" | "unknown";
  supportsClips: boolean;
  componentIds: string[];
}

/** A capability row shown on the Cameras page so people know what is real vs. demo-only. */
export interface Capability {
  feature: string;
  support: "supported" | "partial" | "unsupported" | "demo_only";
  note: string;
}

export interface EventProvider {
  id: ProviderId;
  label: string;
  isDemo: boolean;
  supportedCategories: EventCategory[];
  capabilities: Capability[];
  connection(): Promise<ProviderConnection>;
  /** Pulls cameras and recent events. Real providers call their API; demo returns fixtures. */
  sync(): Promise<{ cameras: ProviderCameraInput[]; events: ProviderEventInput[] }>;
}
