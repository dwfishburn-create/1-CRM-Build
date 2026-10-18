import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Sign-in for the CRM (10/16/2026 — see CRM_Requirements_and_Decisions_Log.md).
//
// This client is ONLY for Supabase Auth (the emailed sign-in link and the
// session cookie). It uses the publishable key, which is safe in a browser:
// migration 028 removed every grant the browser-facing roles had, so the key
// alone reads nothing. All CRM data still goes through lib/supabase.ts and the
// secret key, exactly as before.
//
// Who may sign in: CRM_ALLOWED_EMAILS (comma-separated), default Dan's email.

export function authEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY. " +
        "Set them in Vercel Project Settings -> Environment Variables."
    );
  }
  return { url, key };
}

export function allowedEmails(): string[] {
  return (process.env.CRM_ALLOWED_EMAILS || "dwfishburn@gmail.com")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isAllowedEmail(email: string | null | undefined): boolean {
  return !!email && allowedEmails().includes(email.trim().toLowerCase());
}

// For Server Components, Server Actions and Route Handlers.
export async function authClient() {
  const { url, key } = authEnv();
  const store = await cookies();
  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return store.getAll();
      },
      setAll(list) {
        try {
          list.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          // Called from a Server Component: the proxy refreshes the session.
        }
      },
    },
  });
}
