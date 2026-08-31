import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { supabase } from "@/lib/supabase";

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
// Body: { contact_id, entity_id, role?, notes? }
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

  const { data, error } = await supabase
    .from("contact_entities")
    .upsert(
      { contact_id, entity_id, role, notes },
      { onConflict: "contact_id,entity_id" }
    )
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ contact_entity: data }, { status: 201 });
}
