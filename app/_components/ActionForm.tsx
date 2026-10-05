"use client";

import { startTransition, useActionState, useEffect, useRef, type ReactNode } from "react";

// A form that reports a failed save in place instead of crashing the page
// (10/5/2026). Before this, a server action that threw — even a plain
// validation message like "A follow-up date needs a next step" — replaced the
// whole page with Next.js's production error screen and threw away what Dan
// had typed.
//
// The action returns a FormResult rather than throwing. On an error the
// message shows in red under the fields and every field keeps its value; on
// success the fields reset, and any warning (e.g. "activity saved, but the
// follow-up task was not created") shows in amber. When a web add form
// finds existing look-alikes, they are listed as links with a "create it
// anyway" box, so the record Dan meant is one click away.
//
// Submission goes through onSubmit + startTransition rather than <form
// action>, because React resets a form after any action submission —
// including one that failed — which is exactly the lost-input problem.

export type FormMatch = { label: string; href: string };
export type FormResult = {
  ok: boolean;
  error?: string;
  warning?: string;
  /** Existing records the new one looks like (web add forms, 10/5/2026). */
  matches?: FormMatch[];
  at: number;
} | null;

export function ActionForm({
  action,
  className,
  children,
}: {
  action: (prev: FormResult, fd: FormData) => Promise<FormResult>;
  className?: string;
  children: ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok) ref.current?.reset();
  }, [state]);

  return (
    <form
      ref={ref}
      className={className}
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        startTransition(() => formAction(fd));
      }}
    >
      {/* display:contents keeps the fields in the parent grid; disabled stops a double submit. */}
      <fieldset disabled={pending} className="contents">
        {children}
      </fieldset>
      {pending && <p className="col-span-full text-xs text-gray-500">Saving…</p>}
      {!pending && state?.error && (
        <p role="alert" className="col-span-full text-sm text-red-600">
          Not saved — {state.error}
        </p>
      )}
      {!pending && state?.matches && state.matches.length > 0 && (
        <div className="col-span-full flex flex-col gap-1 text-sm">
          <ul className="list-disc pl-5">
            {state.matches.map((m) => (
              <li key={m.href}>
                <a href={m.href} className="text-blue-600 underline">
                  {m.label}
                </a>
              </li>
            ))}
          </ul>
          <label className="flex items-center gap-2 text-gray-600">
            <input type="checkbox" name="allow_duplicate" value="true" />
            It&apos;s a different one — create it anyway
          </label>
        </div>
      )}
      {!pending && state?.ok && state.warning && (
        <p role="status" className="col-span-full text-sm text-amber-600">
          {state.warning}
        </p>
      )}
    </form>
  );
}
