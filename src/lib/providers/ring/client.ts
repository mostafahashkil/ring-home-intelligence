/**
 * Thin client for the Ring Partner API (Amazon Vision API), using only endpoints documented at
 * https://developer.amazon.com/docs/ring/api-documentation.html :
 *   GET  /v1/users/me
 *   GET  /v1/devices
 *   GET  /v1/devices/{id}/status
 *   GET  /v1/devices/{id}/capabilities
 *   GET  /v1/history/devices/{id}/events
 *   POST /v1/devices/{id}/media/video/download
 * All calls are server-to-server (Ring blocks browser CORS). Retries follow the documented
 * guidance: 429 → respect Retry-After / exponential backoff from 1 s; 5xx → backoff; 401 → refresh once.
 */
import { z } from "zod";
import { log } from "../../util/log";

export const RING_API_BASE = "https://api.amazonvision.com";

export class RingApiError extends Error {
  constructor(
    public status: number,
    public code: "unauthorized" | "forbidden" | "not_found" | "rate_limited" | "device_offline" | "server" | "bad_request" | "network" | "media_not_found" | "recording_not_ready",
    message: string,
    public retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "RingApiError";
  }
}

export interface RingClientOptions {
  getAccessToken: () => Promise<string>;
  /** Called once on 401; should refresh and return a new token (or throw). */
  refreshAccessToken: () => Promise<string>;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  sleep?: (ms: number) => Promise<void>;
  maxRetries?: number;
}

const DeviceListSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      type: z.string(),
      attributes: z.object({ name: z.string().optional() }).passthrough().optional(),
    }),
  ),
});

const StatusSchema = z.object({
  data: z.object({ attributes: z.object({ online: z.boolean().nullable().optional() }).passthrough() }),
});

const CapabilitiesSchema = z.object({
  data: z.object({
    attributes: z
      .object({
        video: z.unknown().nullable().optional(),
        components: z
          .object({ items: z.array(z.object({ component_id: z.string() }).passthrough()) })
          .nullable()
          .optional(),
      })
      .passthrough(),
  }),
});

const HistorySchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      type: z.literal("history-events"),
      attributes: z.object({
        event_type: z.string(),
        start: z.number(),
        end: z.number().nullable().optional(),
      }),
    }),
  ),
  links: z.object({ next: z.string().nullable().optional() }).optional(),
});

const UserSchema = z.object({ data: z.object({ id: z.string(), type: z.literal("users") }) });

export type RingDevice = { id: string; name: string };
export type RingHistoryEvent = { id: string; eventType: string; start: number; end: number | null };

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class RingClient {
  private fetchImpl: typeof fetch;
  private baseUrl: string;
  private sleep: (ms: number) => Promise<void>;
  private maxRetries: number;

  constructor(private opts: RingClientOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.baseUrl = opts.baseUrl ?? RING_API_BASE;
    this.sleep = opts.sleep ?? defaultSleep;
    this.maxRetries = opts.maxRetries ?? 3;
  }

  /** Low-level request with retry, backoff and a single token refresh on 401. Returns the raw Response. */
  async raw(path: string, init: RequestInit = {}, attempt = 0, refreshed = false): Promise<Response> {
    const token = await this.opts.getAccessToken();
    let res: Response;
    try {
      res = await this.fetchImpl(this.baseUrl + path, {
        ...init,
        headers: { Accept: "application/json", ...(init.headers ?? {}), Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
    } catch (err) {
      if (attempt < this.maxRetries) {
        await this.sleep(1000 * 2 ** attempt);
        return this.raw(path, init, attempt + 1, refreshed);
      }
      throw new RingApiError(0, "network", `Network error contacting Ring: ${(err as Error).message}`);
    }

    if (res.status === 401 && !refreshed) {
      await this.opts.refreshAccessToken();
      return this.raw(path, init, attempt, true);
    }
    if (res.status === 429 && attempt < this.maxRetries) {
      const retryAfter = Number(res.headers.get("Retry-After"));
      const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 30) * 1000 : 1000 * 2 ** attempt;
      log.warn("ring.rate_limited", { path: redactPath(path), wait });
      await this.sleep(wait);
      return this.raw(path, init, attempt + 1, refreshed);
    }
    if ((res.status === 500 || res.status === 502 || res.status === 504) && attempt < this.maxRetries) {
      await this.sleep(1000 * 2 ** attempt);
      return this.raw(path, init, attempt + 1, refreshed);
    }
    return res;
  }

  private async json(path: string): Promise<unknown> {
    const res = await this.raw(path);
    if (!res.ok) throw await toError(res);
    return res.json();
  }

  async getAccountId(): Promise<string> {
    return UserSchema.parse(await this.json("/v1/users/me")).data.id;
  }

  async listDevices(): Promise<RingDevice[]> {
    const parsed = DeviceListSchema.parse(await this.json("/v1/devices"));
    return parsed.data
      .filter((d) => d.type === "devices")
      .map((d) => ({ id: d.id, name: d.attributes?.name ?? "Ring device" }));
  }

  async getOnline(deviceId: string): Promise<boolean | null> {
    const parsed = StatusSchema.parse(await this.json(`/v1/devices/${encodeURIComponent(deviceId)}/status`));
    return parsed.data.attributes.online ?? null;
  }

  async getCapabilities(deviceId: string): Promise<{ hasVideo: boolean; componentIds: string[] }> {
    const parsed = CapabilitiesSchema.parse(await this.json(`/v1/devices/${encodeURIComponent(deviceId)}/capabilities`));
    const a = parsed.data.attributes;
    return {
      hasVideo: a.video !== null && a.video !== undefined,
      componentIds: a.components?.items.map((c) => c.component_id) ?? [],
    };
  }

  /** One page of history (newest first). `eventTypes` uses Ring's composite syntax, e.g. "motion.human". */
  async getHistory(deviceId: string, eventTypes?: string): Promise<RingHistoryEvent[]> {
    const qs = eventTypes ? `?event_types=${encodeURIComponent(eventTypes)}` : "";
    const parsed = HistorySchema.parse(await this.json(`/v1/history/devices/${encodeURIComponent(deviceId)}/events${qs}`));
    return parsed.data.map((e) => ({ id: e.id, eventType: e.attributes.event_type, start: e.attributes.start, end: e.attributes.end ?? null }));
  }

  /** Returns the MP4 response on 200/206. Throws RingApiError (media_not_found / recording_not_ready / …) otherwise. */
  async downloadVideo(deviceId: string, body: { timestamp: number; duration: number; componentId: string | null }) {
    const res = await this.raw(`/v1/devices/${encodeURIComponent(deviceId)}/media/video/download`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "video/mp4" },
      body: JSON.stringify({
        timestamp: body.timestamp,
        duration: body.duration,
        ...(body.componentId ? { components: [{ component_id: body.componentId }] } : {}),
      }),
    });
    if (res.status === 200 || res.status === 206) return res;
    throw await toError(res);
  }
}

async function toError(res: Response): Promise<RingApiError> {
  // Never surface response bodies verbatim — they may contain identifiers.
  const retryAfter = Number(res.headers.get("Retry-After")) || undefined;
  switch (res.status) {
    case 400:
      return new RingApiError(400, "bad_request", "Ring rejected the request.");
    case 401:
      return new RingApiError(401, "unauthorized", "Ring authorization expired. Reconnect your Ring account.");
    case 403:
      return new RingApiError(403, "forbidden", "This app isn't authorized for that Ring device.");
    case 404:
      return new RingApiError(404, "not_found", "Ring device or resource not found.");
    case 416:
      return new RingApiError(416, "media_not_found", "No recording exists for that time range.");
    case 425:
      return new RingApiError(425, "recording_not_ready", "The recording is still processing. Try again shortly.");
    case 429:
      return new RingApiError(429, "rate_limited", "Ring rate limit reached. Try again shortly.", retryAfter);
    case 503:
      return new RingApiError(503, "device_offline", "The Ring device is offline.");
    default:
      return new RingApiError(res.status, "server", `Ring returned an error (${res.status}).`);
  }
}

function redactPath(path: string) {
  return path.replace(/ava1\.[^/?]+/g, "[device]");
}
