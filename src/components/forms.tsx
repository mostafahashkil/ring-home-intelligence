"use client";

import { CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { createContext, startTransition, useActionState, useContext, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import type { ActionResult } from "@/lib/action-result";

/** Pending state from ActionForm (which submits manually, so useFormStatus doesn't see it). */
const PendingContext = createContext<boolean | null>(null);

export function SubmitButton({
  children,
  className = "btn-primary",
  pendingText,
  confirm,
  name,
  value,
  disabled,
}: {
  children: React.ReactNode;
  className?: string;
  pendingText?: string;
  confirm?: string;
  name?: string;
  value?: string;
  disabled?: boolean;
}) {
  const fromContext = useContext(PendingContext);
  const { pending: fromStatus } = useFormStatus();
  const pending = fromContext ?? fromStatus;
  return (
    <button
      type="submit"
      name={name}
      value={value}
      className={className}
      disabled={pending || disabled}
      aria-busy={pending}
      onClick={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {pending && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}
      {pending && pendingText ? pendingText : children}
    </button>
  );
}

/**
 * Wraps a server action and shows its success/error message inline (announced to screen readers).
 * Submits manually so typed values survive a validation error (React form actions reset the form).
 */
export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess,
}: {
  action: (prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;
  children: React.ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);
  return (
    <form
      ref={ref}
      className={className}
      onSubmit={(e) => {
        e.preventDefault();
        const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
        const data = new FormData(e.currentTarget, submitter);
        startTransition(() => formAction(data));
      }}
    >
      <PendingContext.Provider value={pending}>{children}</PendingContext.Provider>
      <ResultMessage state={state} />
    </form>
  );
}

export function ResultMessage({ state }: { state: ActionResult | null }) {
  return (
    <div aria-live="polite" className="empty:hidden">
      {state && (
        <p className={`mt-2 flex items-center gap-1.5 text-sm ${state.ok ? "text-ok" : "text-danger"}`}>
          {state.ok ? <CheckCircle2 aria-hidden className="h-4 w-4" /> : <AlertCircle aria-hidden className="h-4 w-4" />}
          {state.message}
        </p>
      )}
    </div>
  );
}
