"use client";

import { useActionState } from "react";
import { sendLink, verifyCode, type LoginState } from "./actions";

export function LoginForm({ next }: { next: string }) {
  const [sent, send, sending] = useActionState<LoginState, FormData>(sendLink, { step: "email" });
  const [checked, check, checking] = useActionState<LoginState, FormData>(verifyCode, { step: "code" });

  if (sent.step === "code") {
    return (
      <div className="stack">
        <p className="muted">{sent.message}</p>
        <form action={check} className="stack">
          <input type="hidden" name="email" value={sent.email} />
          <label className="field">
            6-digit code
            <input name="code" inputMode="numeric" autoComplete="one-time-code" />
          </label>
          {checked.error && <p className="error">{checked.error}</p>}
          <button className="btn btn-primary" disabled={checking}>{checking ? "Checking…" : "Sign in"}</button>
        </form>
      </div>
    );
  }

  return (
    <form action={send} className="stack">
      <input type="hidden" name="next" value={next} />
      <label className="field">
        Email
        <input name="email" type="email" autoComplete="email" required placeholder="you@cbre.com" />
      </label>
      {sent.error && <p className="error">{sent.error}</p>}
      <button className="btn btn-primary" disabled={sending}>{sending ? "Sending…" : "Email me a sign-in link"}</button>
    </form>
  );
}
