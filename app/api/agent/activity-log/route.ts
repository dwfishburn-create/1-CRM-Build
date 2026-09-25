import { provenance } from "@/lib/provenance";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { supabase } from "@/lib/supabase";
import { logActivity } from "@/lib/activity";

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
// tour / note / etc. — activity_type is free text, a convention rather than a
// DB constraint).
// Body: { activity_type, project_id?, property_id?, contact_id?, entity_id?,
//         activity_date?, performed_by?, summary?, next_step?,
//         next_step_due_date?, waiting_on_contact_id?, client_visible?,
//         source?, create_task_from_next_step?, source_system?,
//         source_record_id?, source_batch_id? }
//
// A next step WITH a due date also creates a task (migration 018, Dan's call
// 9/24/2026 — the activity is the history, the task is the queue). As of the
// 9/24/2026 fifth pass, waiting_on_contact_id puts that task straight into
// the Dashboard's Waiting On column. The logic lives in lib/activity.ts and
// is shared with the web form on the record pages, so the two paths cannot
// drift.
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!String(body.activity_type || "").trim()) {
    return NextResponse.json({ error: "activity_type is required." }, { status: 400 });
  }

  try {
    const result = await logActivity({
      activity_type: String(body.activity_type),
      project_id: body.project_id as string | undefined,
      property_id: body.property_id as string | undefined,
      contact_id: body.contact_id as string | undefined,
      entity_id: body.entity_id as string | undefined,
      activity_date: body.activity_date as string | undefined,
      performed_by: body.performed_by as string | undefined,
      summary: body.summary as string | undefined,
      next_step: body.next_step as string | undefined,
      next_step_due_date: body.next_step_due_date as string | undefined,
      waiting_on_contact_id: body.waiting_on_contact_id as string | undefined,
      client_visible: Boolean(body.client_visible),
      source: (body.source as string | undefined) ?? "agent_api",
      create_task_from_next_step:
        "create_task_from_next_step" in body
          ? Boolean(body.create_task_from_next_step)
          : true,
      provenance: provenance(body),
    });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Insert failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
