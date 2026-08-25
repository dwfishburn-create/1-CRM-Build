import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { supabase } from "@/lib/supabase";
import { nextDisplayCode } from "@/lib/displayCode";

// GET /api/agent/activity-log?limit=50&project_id=&property_id=&entity_id=&contact_id=
// List activity log entries, most recent by activity_date first. Any of the
// four filters can be combined; omit all to get the global feed.
export async function GET(request: NextRequest) {
  const limitParam = request.nextUrl.searchParams.get("limit");
  const limit = limitParam ? Math.min(Number(limitParam) || 50, 200) : 50;
  const projectId = request.nextUrl.searchParams.get("project_id");
  const propertyId = request.nextUrl.searchParams.get("property_id");
  const entityId = request.nextUrl.searchParams.get("entity_id");
  const contactId = request.nextUrl.searchParams.get("contact_id");

  let query = supabase
    .from("activity_log")
    .select(
      "*, project:projects(project_code, client_name), property:properties(display_code, address, suite_number), entity:entities(display_code, name), contact:contacts(display_code, first_name, last_name)"
    )
    .order("activity_date", { ascending: false })
    .limit(limit);

  if (projectId) query = query.eq("project_id", projectId);
  if (propertyId) query = query.eq("property_id", propertyId);
  if (entityId) query = query.eq("entity_id", entityId);
  if (contactId) query = query.eq("contact_id", contactId);

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ activity_log: data });
}

// POST /api/agent/activity-log — log an activity (call / email / meeting /
// tour / postcard_sent / qr_scan / note / document / etc. — activity_type is
// free text, same as the schema's own comment: no fixed enum, values are a
// convention, not a DB constraint).
// Body: { activity_type, project_id?, property_id?, contact_id?, entity_id?,
//         activity_date?, performed_by?, summary?, next_step?,
//         next_step_due_date?, client_visible?, source? }
// All four link fields are optional and independent (mirrors the
// entity-optional design used for tasks) — an activity can be logged against
// any combination of project/property/contact/entity, or none at all.
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const activity_type = String(body.activity_type || "").trim();
  if (!activity_type) {
    return NextResponse.json(
      { error: "activity_type is required." },
      { status: 400 }
    );
  }

  const project_id = String(body.project_id || "").trim() || null;
  const property_id = String(body.property_id || "").trim() || null;
  const contact_id = String(body.contact_id || "").trim() || null;
  const entity_id = String(body.entity_id || "").trim() || null;
  const activity_date = body.activity_date ? String(body.activity_date) : null;
  const performed_by = String(body.performed_by || "").trim() || null;
  const summary = String(body.summary || "").trim() || null;
  const next_step = String(body.next_step || "").trim() || null;
  const next_step_due_date = body.next_step_due_date
    ? String(body.next_step_due_date)
    : null;
  const client_visible = Boolean(body.client_visible);
  const source = String(body.source || "").trim() || "agent_api";

  const display_code = await nextDisplayCode("activity_log", "LOG");

  const insertRow: Record<string, unknown> = {
    display_code,
    activity_type,
    project_id,
    property_id,
    contact_id,
    entity_id,
    performed_by,
    summary,
    next_step,
    next_step_due_date,
    client_visible,
    source,
  };
  // Only set activity_date when the caller supplied one — otherwise let the
  // column's own default (now()) apply, same pattern as the rest of this API.
  if (activity_date) insertRow.activity_date = activity_date;

  const { data, error } = await supabase
    .from("activity_log")
    .insert(insertRow)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ activity: data }, { status: 201 });
}
