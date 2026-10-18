import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// The RTD's only database connection. It uses the publishable key plus the
// signed-in person's own session — never the CRM's secret key. Through it the
// RTD can call exactly the rtd_* functions from migration 028 and nothing
// else: every table, view and other function in the CRM database refuses it.

export function env() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (Vercel Project Settings -> Environment Variables)."
    );
  }
  return { url, key };
}

export async function db() {
  const { url, key } = env();
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
          // Server Component render: the proxy refreshes the session instead.
        }
      },
    },
  });
}

export type Me = { email: string; display_name: string; is_admin: boolean };

// Null when signed out or not on the RTD access list.
export async function getMe(): Promise<Me | null> {
  const supabase = await db();
  const { data, error } = await supabase.rpc("rtd_me");
  if (error || !Array.isArray(data) || data.length === 0) return null;
  return data[0] as Me;
}
