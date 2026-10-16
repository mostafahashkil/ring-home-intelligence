/**
 * On-demand clip proxy. Ring media APIs are server-to-server only; this streams the MP4 to the
 * signed-in user without storing it. Follows Ring guidance: don't request [T, T+D) before T+D+5s;
 * 416/425 on a recent event are retryable.
 */
import { NextResponse } from "next/server";
import { ForbiddenError } from "@/lib/auth/core";
import { requirePermission } from "@/lib/auth/session";
import { getEvent } from "@/lib/repo/events";
import { RingApiError } from "@/lib/providers/ring/client";
import { RingAuthError } from "@/lib/providers/ring/auth";
import { createRingClient } from "@/lib/providers/ring/provider";
import { audit } from "@/lib/repo/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROCESSING_DELAY_MS = 5_000;
const RECENT_WINDOW_MS = 2 * 60_000;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let userId: string;
  try {
    userId = (await requirePermission("events:read")).id;
  } catch (err) {
    return NextResponse.json({ error: err instanceof ForbiddenError ? err.message : "Sign in required." }, { status: 401 });
  }
  const { id } = await params;
  const event = getEvent(id);
  if (!event) return NextResponse.json({ error: "Event not found." }, { status: 404 });
  const ev = event.evidenceReference;
  if (!ev || ev.kind !== "ring_recording") {
    return NextResponse.json({ error: "No recording exists for this event." }, { status: 404 });
  }
  const readyAt = ev.timestamp + ev.durationMs + PROCESSING_DELAY_MS;
  if (Date.now() < readyAt) {
    return NextResponse.json(
      { error: `The recording is still being processed. Try again in ${Math.ceil((readyAt - Date.now()) / 1000)} s.`, retry: true },
      { status: 425 },
    );
  }
  try {
    const res = await createRingClient().downloadVideo(ev.deviceId, { timestamp: ev.timestamp, duration: ev.durationMs, componentId: ev.componentId });
    audit(userId, "clip.viewed", event.id);
    return new Response(res.body, {
      status: 200,
      headers: {
        "Content-Type": res.headers.get("Content-Type") ?? "video/mp4",
        "Cache-Control": "private, no-store",
        "Content-Disposition": "inline",
      },
    });
  } catch (err) {
    if (err instanceof RingAuthError) {
      return NextResponse.json({ error: "Ring isn't connected. Reconnect in Privacy & Settings.", retry: false }, { status: 409 });
    }
    if (err instanceof RingApiError) {
      const recent = Date.now() - (ev.timestamp + ev.durationMs) < RECENT_WINDOW_MS;
      const retry = err.code === "recording_not_ready" || (err.code === "media_not_found" && recent) || err.code === "rate_limited" || err.code === "network";
      const message =
        err.code === "media_not_found" && !recent ? "No recording is available for this event (the camera may not have been recording)." : err.message;
      return NextResponse.json({ error: message, retry }, { status: err.status >= 400 && err.status < 600 ? err.status : 502 });
    }
    return NextResponse.json({ error: "Couldn't load the recording.", retry: true }, { status: 502 });
  }
}
