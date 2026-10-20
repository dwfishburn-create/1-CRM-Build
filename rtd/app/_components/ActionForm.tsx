"use client";

import { startTransition, useActionState, useEffect, useRef, type ReactNode } from "react";

// The RTD's form wrapper (same pattern as the CRM's, 10/5/2026): a rejected
// save shows its reason in place and keeps what was typed; a successful one
// resets the fields and says what happened. Submits through onSubmit +
// startTransition because React resets a <form action> even when it fails.
//
// When the database finds likely duplicates, they are listed with a "it's a
// different one" box; ticking it and saving again sends force=true.

export type FormMatch = { label: string; href?: string };
export type FormResult = {
  ok: boolean;
  error?: string;
  message?: string;
  matches?: FormMatch[];
  forceLabel?: string;
  at: number;
} | null;

export function ActionForm({
  action,
  className,
  children,
  submitLabel,
  submitClass = "btn btn-primary",
  resetOnOk = true,
  confirm,
}: {
  action: (prev: FormResult, fd: FormData) => Promise<FormResult>;
  className?: string;
  children?: ReactNode;
  submitLabel: string;
  submitClass?: string;
  resetOnOk?: boolean;
  confirm?: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok && resetOnOk) ref.current?.reset();
  }, [state, resetOnOk]);

  return (
    <form
      ref={ref}
      className={className ?? "aform"}
      onSubmit={(e) => {
        e.preventDefault();
        if (confirm && !window.confirm(confirm)) return;
        const fd = new FormData(e.currentTarget);
        startTransition(() => formAction(fd));
      }}
    >
      <fieldset disabled={pending} className="contents">
        {children}
        {!pending && state?.matches && state.matches.length > 0 && (
          <div className="matches">
            <span>Already on file?</span>
            <ul>
              {state.matches.map((m) => (
                <li key={m.label}>{m.href ? <a href={m.href}>{m.label}</a> : m.label}</li>
              ))}
            </ul>
            <label className="check">
              <input type="checkbox" name="force" value="1" /> {state.forceLabel ?? "It's a different one — save it anyway"}
            </label>
          </div>
        )}
        <div className="formfoot">
          <button className={submitClass}>{pending ? "Saving…" : submitLabel}</button>
          {!pending && state?.error && <p role="alert" className="error">{state.error}</p>}
          {!pending && state?.ok && state.message && <p role="status" className="okmsg">{state.message}</p>}
        </div>
      </fieldset>
    </form>
  );
}
