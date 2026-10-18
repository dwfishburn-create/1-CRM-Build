"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/supabase";

export type LoginState = { step: "email" | "code"; email?: string; message?: string; error?: string };

async function origin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") || h.get("host") || "localhost:3000";
  const proto = h.get("x-forwarded-proto") || (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

function safeNext(next: string | null | undefined): string {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

// Only people on the RTD access list are emailed a link; everyone sees the
// same reply, so the page never reveals who has access.
export async function sendLink(_prev: LoginState, form: FormData): Promise<LoginState> {
  const email = String(form.get("email") || "").trim().toLowerCase();
  if (!email.includes("@")) return { step: "email", error: "Enter your email address." };

  const store = await cookies();
  store.set("post_login_next", safeNext(String(form.get("next") || "")), {
    path: "/", httpOnly: true, sameSite: "lax", maxAge: 3600,
  });

  const supabase = await db();
  const { data: allowed } = await supabase.rpc("rtd_email_allowed", { p_email: email });
  if (allowed === true) {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${await origin()}/auth/confirm`, shouldCreateUser: true },
    });
    if (error) return { step: "email", email, error: `Couldn't send the email: ${error.message}` };
  }
  return {
    step: "code",
    email,
    message: "If that address has RTD access, a sign-in email is on its way. Tap the link in it, or type the 6-digit code here.",
  };
}

export async function verifyCode(_prev: LoginState, form: FormData): Promise<LoginState> {
  const email = String(form.get("email") || "").trim().toLowerCase();
  const token = String(form.get("code") || "").replace(/\s+/g, "");
  if (!/^\d{6,10}$/.test(token)) return { step: "code", email, error: "Enter the code from the email." };

  const supabase = await db();
  const { error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
  if (error) return { step: "code", email, error: "That code didn't work or has expired. Request a new email." };

  const store = await cookies();
  const next = safeNext(store.get("post_login_next")?.value);
  store.delete("post_login_next");
  redirect(next);
}
