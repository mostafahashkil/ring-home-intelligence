"use client";

import { AlertTriangle } from "lucide-react";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center rounded-xl border border-dashed border-line px-6 py-12 text-center">
      <AlertTriangle aria-hidden className="mb-3 h-8 w-8 text-warn" />
      <p className="font-medium">Something went wrong loading this page</p>
      <p className="mt-1 max-w-md text-sm text-muted">
        Your data is safe. Try again — if it keeps happening, check the server logs{error.digest ? ` (reference ${error.digest})` : ""}.
      </p>
      <button type="button" className="btn-primary mt-4" onClick={reset}>
        Try again
      </button>
    </div>
  );
}
