import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { supabase } from "@/lib/supabase";
import { provenance } from "@/lib/provenance";

// Job history (10/13/2026, migration 026): is_current, started_on, ended_on.
// A person who leaves a brand is marked former (is_current: false), never
// unlinked — who used to run real estate for a brand is exactly who knows
// where it went. Shared by POST and PATCH below. Only fields present in the
// body are returned; an ended_on with no explicit is_current implies former.
function historyFields(
  body: Record<string, unknown>
): { fields: Record<string, unknown> } | { error: string } {
  const fields: Record<string, unknown> = {};
  for (const key of ["started_on", "ended_on"] as const) {
    if (!(key in body) || body[key] === undefined) continue;
    const v = String(body[key] ?? "").trim();
    if (v && (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(`${v}T12:00:00Z`)))) {
      return { error: `${key} must be a date as YYYY-MM-DD (got "${v}").` };
    }
    fields[key] = v || null;
  }
  if ("is_current" in body && body.is_current !== undefined && body.is_current !== null && body.is_current !== "") {
    const raw = body.is_current;
    const s = String(raw).trim().toLowerCase();
    if (typeof raw === "boolean") fields.is_current = raw;
    else if (["true", "1", "yes"].includes(s)) fields.is_current = true;
    else if (["false", "0", "no"].includes(s)) fields.is_current = false;
    else return { error: "is_current must be true or false." };
  } else if (fields.ended_on) {
    fields.is_current = false;
  }
  return { fields };
}

// GET /api/agent/contact-entities?limit=50 — list contact<->entity
// affiliation links, most recent first. Optional ?contact_id= or
// ?entity_id= filters to one contact or one entity. Covers every entity
// affiliation a contact has BEYOND their primary one (contacts.entity_id)
// — e.g. a person who is a principal of two separate companies. See
// migration 009 and the 8/31/2026 "Contact<->Entity relationship is 1:1"
// decision in CRM_Requirements_and_Decisions_Log.md.
export async function GET(request: NextRequest) {
  const limitParam = request.nextUrl.searchParams.get("limit");
  const limit = limitParam ? Math.min(Number(limitParam) || 50, 200) : 50;
  const contactId = request.nextUrl.searchParams.get("contact_id");
  const entityId = request.nextUrl.searchParams.get("entity_id");

  let query = supabase
    .from("contact_entities")
    .select(
      "*, contact:contacts!contact_id(display_code, first_name, last_name), entity:entities!entity_id(display_code, name)"
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (contactId) {
    query = query.eq("contact_id", contactId);
  }
  if (entityId) {
    query = query.eq("entity_id", entityId);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ contact_entities: data });
}

// POST /api/agent/contact-entities — link a contact to an ADDITIONAL
// entity beyond their primary one (contacts.entity_id), or update the
// existing link's role/notes if that pair is already linked. Both
// contact_id and entity_id are required — this table is specifically for
// the "also a principal of a second company" case, not a general-purpose
// optional link. Re-posting the same pair upserts rather than duplicating
// — same pattern as project-contacts/project-properties.
// Body: { contact_id, entity_id, role?, notes?, is_current?, started_on?,
//         ended_on?, source_system?, source_record_id?, source_batch_id? }
// role is free text; for a retail brand the usual ones are Real Estate
// Director, Real Estate Manager, Franchise Development, Franchisee, Tenant Rep
// Broker. is_current/started_on/ended_on are only written when sent, so
// re-posting a pair to change its role does not reset its history.
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const contact_id = String(body.contact_id || "").trim();
  const entity_id = String(body.entity_id || "").trim();

  if (!contact_id || !entity_id) {
    return NextResponse.json(
      { error: "Both contact_id and entity_id are required." },
      { status: 400 }
    );
  }

  const role = String(body.role || "").trim() || null;
  const notes = String(body.notes || "").trim() || null;

  const history = historyFields(body);
  if ("error" in history) {
    return NextResponse.json({ error: history.error }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("contact_entities")
    .upsert(
      { ...provenance(body), contact_id, entity_id, role, notes, ...history.fields },
      { onConflict: "contact_id,entity_id" }
    )
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ contact_entity: data }, { status: 201 });
}

// PATCH /api/agent/contact-entities — update one link by id (10/13/2026):
// role, notes, is_current, started_on, ended_on. Only fields present in the
// body change; "" clears role/notes/dates. Use it to mark someone former when
// they leave a company: { id, is_current: false, ended_on: "2026-10-01" }.
// At least one field besides id is required.
export async function PATCH(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const id = String(body.id || "").trim();
  if (!id) {
    return NextResponse.json({ error: "id is required." }, { status: 400 });
  }

  const history = historyFields(body);
  if ("error" in history) {
    return NextResponse.json({ error: history.error }, { status: 400 });
  }

  const updatePayload: Record<string, unknown> = { ...history.fields };
  for (const field of ["role", "notes"] as const) {
    if (field in body) updatePayload[field] = String(body[field] ?? "").trim() || null;
  }

  if (Object.keys(updatePayload).length === 0) {
    return NextResponse.json(
      { error: "Provide at least one field to update: role, notes, is_current, started_on, ended_on." },
      { status: 400 }
    );
  }

  updatePayload.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from("contact_entities")
    .update(updatePayload)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ contact_entity: data });
}
