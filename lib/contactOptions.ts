import { supabase } from "./supabase";
import { personName } from "./records";

// Contact pick-list for the Log Activity form's "waiting on" select and the
// task editor (9/24/2026). A plain <select> of every contact is fine at ~90
// contacts; at the RealNex import's 26,156 it is not, and this becomes a
// type-ahead backed by search_contact_ids (017). Capped so a big table can't
// blow up a page render in the meantime.
export type Option = { id: string; label: string };

export async function contactOptions(limit = 1000): Promise<Option[]> {
  const { data, error } = await supabase
    .from("contacts")
    .select("id, first_name, last_name, entity:entities!entity_id(name)")
    .order("last_name", { ascending: true, nullsFirst: false })
    .order("first_name", { ascending: true })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map((c) => {
    const ent = Array.isArray(c.entity) ? c.entity[0] : c.entity;
    const name = personName(c);
    return { id: c.id as string, label: ent?.name ? `${name} — ${ent.name}` : name };
  });
}

/** Central-time "today" as YYYY-MM-DD, for form defaults. */
export function todayCentral(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date());
}
