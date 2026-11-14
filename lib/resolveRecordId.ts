import { supabase } from "@/lib/supabase";

// Accept either a record's uuid or its display code (PROP-3515, REQ-0013, …)
// wherever an agent route takes an id. Found 11/14/2026: find_requirement_matches
// returned HTTP 500 ("invalid input syntax for type uuid") when Claude passed
// the display codes Dan uses in chat.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function resolveRecordId(table: "properties" | "requirements", value: string): Promise<string> {
  const v = value.trim();
  if (UUID_RE.test(v)) return v;
  const { data, error } = await supabase
    .from(table)
    .select("id")
    .ilike("display_code", v)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error(`${table === "properties" ? "Property" : "Requirement"} ${v} not found.`);
  return (data as { id: string }).id;
}
