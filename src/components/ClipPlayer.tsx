"use client";

import { Loader2, PlayCircle, RotateCw } from "lucide-react";
import { useEffect, useState } from "react";

type State = { kind: "idle" } | { kind: "loading" } | { kind: "ready"; url: string } | { kind: "error"; message: string; retry: boolean };

/**
 * Loads a recording on demand through this app's server (Ring media requires server-to-server calls).
 * Video is streamed to the browser and not stored by the app.
 */
export function ClipPlayer({ eventId }: { eventId: string }) {
  const [state, setState] = useState<State>({ kind: "idle" });

  useEffect(() => () => {
    if (state.kind === "ready") URL.revokeObjectURL(state.url);
  }, [state]);

  async function load() {
    setState({ kind: "loading" });
    try {
      const res = await fetch(`/api/events/${eventId}/clip`, { cache: "no-store" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; retry?: boolean };
        setState({ kind: "error", message: body.error ?? "The recording couldn't be loaded.", retry: !!body.retry });
        return;
      }
      setState({ kind: "ready", url: URL.createObjectURL(await res.blob()) });
    } catch {
      setState({ kind: "error", message: "Network error while loading the recording.", retry: true });
    }
  }

  if (state.kind === "ready") {
    return <video className="aspect-video w-full rounded-lg bg-black" src={state.url} controls playsInline aria-label="Event recording" />;
  }
  return (
    <div className="flex flex-col items-start gap-2">
      <button type="button" className="btn-secondary" onClick={load} disabled={state.kind === "loading"}>
        {state.kind === "loading" ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : state.kind === "error" && state.retry ? <RotateCw aria-hidden className="h-4 w-4" /> : <PlayCircle aria-hidden className="h-4 w-4" />}
        {state.kind === "loading" ? "Requesting from Ring…" : state.kind === "error" && state.retry ? "Try again" : "Load recording"}
      </button>
      <p className="text-xs text-muted" aria-live="polite">
        {state.kind === "error" ? state.message : "Fetched from Ring when you ask. Not stored by this app."}
      </p>
    </div>
  );
}
