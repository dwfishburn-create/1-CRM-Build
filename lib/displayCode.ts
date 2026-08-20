import { supabase } from "./supabase";

/**
* Generates the next human-readable display code for a table, e.g. PROP-0001.
*
* v1 implementation: counts existing rows and pads +1. Good enough for a
* single-user tool; not safe against concurrent inserts or code reuse after
* deletes. Revisit with a Postgres sequence if/when the CRM gets multi-user.
*/
export async function nextDisplayCode(
  table: string,
  prefix: string
  ): Promise<string> {
  const { count, error } = await supabase
    .from(table)
    .select("id", { count: "exact", head: true });

  if (error) throw new Error(error.message);

  const n = (count ?? 0) + 1;
  return `${prefix}-${String(n).padStart(4, "0")}`;
}
