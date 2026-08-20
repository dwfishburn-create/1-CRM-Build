import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

if (!supabaseUrl || !supabaseSecretKey) {
  throw new Error(
    "Missing SUPABASE_URL or SUPABASE_SECRET_KEY environment variables. " +
      "Set them in .env.local for local dev, or in Vercel Project Settings for deployment."
  );
}

// Server-only client. Uses the Supabase secret key, which bypasses Row Level
// Security entirely — this file must never be imported into a Client
// Component or exposed to the browser. All reads/writes for this app go
// through Server Components and Server Actions.
export const supabase = createClient(supabaseUrl, supabaseSecretKey, {
  auth: { persistSession: false },
});
