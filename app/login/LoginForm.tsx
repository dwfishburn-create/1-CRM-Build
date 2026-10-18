"use client";

import { useActionState } from "react";
import { sendLink, verifyCode, type LoginState } from "./actions";

const input =
  "w-full rounded-md border border-neutral-300 bg-white px-3 py-2.5 text-[16px] text-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-white";
const button =
  "w-full rounded-md bg-blue-600 px-4 py-2.5 text-[16px] font-medium text-white hover:bg-blue-700 disabled:opacity-60";

export function LoginForm({ next, denied }: { next: string; denied: boolean }) {
  const [sent, send, sending] = useActionState<LoginState, FormData>(sendLink, { step: "email" });
  const [checked, check, checking] = useActionState<LoginState, FormData>(verifyCode, { step: "code" });

  if (sent.step === "code") {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-[15px] text-neutral-700 dark:text-neutral-200">{sent.message}</p>
        <form action={check} className="flex flex-col gap-3">
          <input type="hidden" name="email" value={sent.email} />
          <label className="flex flex-col gap-1.5 text-sm font-medium text-neutral-700 dark:text-neutral-200">
            6-digit code
            <input name="code" inputMode="numeric" autoComplete="one-time-code" className={input} />
          </label>
          {checked.error && <p className="text-sm text-red-600 dark:text-red-400">{checked.error}</p>}
          <button className={button} disabled={checking}>
            {checking ? "Checking…" : "Sign in"}
          </button>
        </form>
      </div>
    );
  }

  return (
    <form action={send} className="flex flex-col gap-3">
      {denied && (
        <p className="text-sm text-red-600 dark:text-red-400">
          That account doesn&apos;t have access to this CRM.
        </p>
      )}
      <input type="hidden" name="next" value={next} />
      <label className="flex flex-col gap-1.5 text-sm font-medium text-neutral-700 dark:text-neutral-200">
        Email
        <input name="email" type="email" autoComplete="email" required className={input} />
      </label>
      {sent.error && <p className="text-sm text-red-600 dark:text-red-400">{sent.error}</p>}
      <button className={button} disabled={sending}>
        {sending ? "Sending…" : "Email me a sign-in link"}
      </button>
    </form>
  );
}
