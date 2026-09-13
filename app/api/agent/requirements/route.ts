import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { supabase } from "@/lib/supabase";
import { nextDisplayCode } from "@/lib/displayCode";

// GET /api/agent/requirements?limit=50&status=active — list requirements,
// most recent first. Optional ?status= filter.
export async function GET(request: NextRequest) {
  const limitParam = request.nextUrl.searchParams.get("limit");
  const limit = limitParam ? Math.min(Number(limitParam) || 50, 200) : 50;
  const status = request.nextUrl.searchParams.get("status");

  let query = supabase
    .from("requirements")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (status) {
    query = query.eq("status", status);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ requirements: data });
}

// POST /api/agent/requirements — create a requirement (a standing, informal
// capture of what someone told Dan they need — not a formal Assignment).
// Body: { deal_type?, property_type?, size_min?, size_max?, budget_min?,
//         budget_max?, target_location?, timeline?, status?, priority?,
//         details?, source? }
// Mirrors app/requirements/actions.ts:createRequirement field-for-field.
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const deal_type = body.deal_type ? String(body.deal_type).trim() : null;
  const property_type = body.property_type
    ? String(body.property_type).trim()
    : null;
  const size_min = body.size_min !== undefined && body.size_min !== null ? Number(body.size_min) : null;
  const size_max = body.size_max !== undefined && body.size_max !== null ? Number(body.size_max) : null;
  const budget_min =
    body.budget_min !== undefined && body.budget_min !== null ? Number(body.budget_min) : null;
  const budget_max =
    body.budget_max !== undefined && body.budget_max !== null ? Number(body.budget_max) : null;
  const target_location = body.target_location
    ? String(body.target_location).trim()
    : null;
  const timeline = body.timeline ? String(body.timeline).trim() : null;
  const status = String(body.status || "").trim() || "active";
  const priority = String(body.priority || "").trim() || "medium";
  const details = body.details ? String(body.details).trim() : null;
  const source = body.source ? String(body.source).trim() : null;

  const display_code = await nextDisplayCode("requirements", "REQ");

  const { data, error } = await supabase
    .from("requirements")
    .insert({
      display_code,
      deal_type,
      property_type,
      size_min,
      size_max,
      budget_min,
      budget_max,
      target_location,
      timeline,
      status,
      priority,
      details,
      source,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ requirement: data }, { status: 201 });
}

// PATCH /api/agent/requirements — partial update of one or more editable
// fields on an EXISTING requirement by id: deal_type, property_type,
// target_location, timeline, status, priority, details, source (strings),
// and size_min, size_max, budget_min, budget_max (numbers). Only fields
// present in the body are written — an omitted field is left untouched. A
// string field sent as "" clears it to null. A numeric field accepts a
// number or numeric string; an empty value clears it to null. display_code
// is never editable. At least one field besides id is required.
//
// Added 9/13/2026 to close the gap flagged 9/11/2026 — the 9/3/2026
// Requirements build shipped create/list/link but no way to edit an
// existing requirement (REQ-0001, REQ-0002, etc.) once created. Same
// convention as update_property/update_contact/update_entity/update_project
// — see CRM_Requirements_and_Decisions_Log.md.
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

  const stringFields = [
    "deal_type",
    "property_type",
    "target_location",
    "timeline",
    "status",
    "priority",
    "details",
    "source",
  ] as const;
  const numericFields = ["size_min", "size_max", "budget_min", "budget_max"] as const;

  const updatePayload: Record<string, unknown> = {};
  for (const field of stringFields) {
    if (field in body) {
      const value = String(body[field] ?? "").trim();
      updatePayload[field] = value || null;
    }
  }
  for (const field of numericFields) {
    if (field in body) {
      const raw = body[field];
      if (raw === null || raw === "") {
        updatePayload[field] = null;
      } else {
        const num = Number(raw);
        if (Number.isNaN(num)) {
          return NextResponse.json(
            { error: `${field} must be a number.` },
            { status: 400 }
          );
        }
        updatePayload[field] = num;
      }
    }
  }

  if (Object.keys(updatePayload).length === 0) {
    return NextResponse.json(
      {
        error:
          "Provide at least one field to update: " +
          [...stringFields, ...numericFields].join(", ") + ".",
      },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("requirements")
    .update(updatePayload)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ requirement: data });
}
