import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { supabase } from "@/lib/supabase";

// GET /api/agent/project-contacts?limit=50 — list project<->contact/entity
// links, most recent first. Optional ?project_id= filters to one project.
// Covers both plain contact links (decision-maker, client-side contact,
// etc.) and collaborator links (co-broker/referral, contact or entity,
// with a negotiated split_pct) — see the 8/30/2026 project_collaborators
// decision, which extended this same table rather than adding a new one.
export async function GET(request: NextRequest) {
  const limitParam = request.nextUrl.searchParams.get("limit");
  const limit = limitParam ? Math.min(Number(limitParam) || 50, 200) : 50;
  const projectId = request.nextUrl.searchParams.get("project_id");

  let query = supabase
    .from("project_contacts")
    .select(
      "*, project:projects(project_code, client_name), contact:contacts!contact_id(display_code, first_name, last_name), entity:entities!entity_id(display_code, name)"
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (projectId) {
    query = query.eq("project_id", projectId);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ project_contacts: data });
}

// POST /api/agent/project-contacts — link a contact and/or entity to a
// project (a decision-maker, a co-broker, a referral source, an outside
// brokerage before a specific contact there is known, etc.), or update the
// existing link's role/split_pct/notes if that pair is already linked.
// At least one of contact_id/entity_id is required. Re-posting the same
// project_id+contact_id (or project_id+entity_id, when contact_id is
// omitted) upserts rather than duplicating — same pattern as
// project-properties.
//
// split_pct: the negotiated split, meaning depends on role — a referral
// fee is typically 10-20% off the top of the gross commission before any
// split, while a co-broker split (50/50 or 60/40 typical) divides what's
// left after any referral fee. Stored as given, not computed into an
// actual dollar amount — that needs the still-unbuilt deal-value/EV
// scoring. See the 8/26/2026 "Solo vs. collaborator flag" idea and the
// 8/30/2026 project_collaborators decision.
// Body: { project_id, contact_id?, entity_id?, role?, split_pct?, notes? }
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const project_id = String(body.project_id || "").trim();
  if (!project_id) {
    return NextResponse.json(
      { error: "project_id is required." },
      { status: 400 }
    );
  }

  const contact_id = String(body.contact_id || "").trim() || null;
  const entity_id = String(body.entity_id || "").trim() || null;
  if (!contact_id && !entity_id) {
    return NextResponse.json(
      { error: "At least one of contact_id or entity_id is required." },
      { status: 400 }
    );
  }

  const role = String(body.role || "").trim() || null;
  const notes = String(body.notes || "").trim() || null;
  const split_pct =
    typeof body.split_pct === "number"
      ? body.split_pct
      : body.split_pct
        ? Number(body.split_pct)
        : null;

  // Upsert on whichever pair the caller is actually linking — contact_id
  // takes precedence when both are sent (matches the entity-optional
  // philosophy elsewhere: contact is the more specific link).
  const onConflict = contact_id ? "project_id,contact_id" : "project_id,entity_id";

  const { data, error } = await supabase
    .from("project_contacts")
    .upsert({ project_id, contact_id, entity_id, role, split_pct, notes }, { onConflict })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ project_contact: data }, { status: 201 });
}
