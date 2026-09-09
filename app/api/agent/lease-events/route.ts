import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { supabase } from "@/lib/supabase";
import { nextDisplayCode } from "@/lib/displayCode";

// Agent API for lease_events — Phase 2 of the Space/Lease data model
// (migration 012 — see CRM_Requirements_and_Decisions_Log.md, "9/8/2026 —
// Space/Lease data model designed and built" and its Phase 2 follow-up).
// A lease event is a dated thing tied to one specific lease: an option/
// renewal deadline, a scheduled rent bump, rent commencement, a TI
// disbursement, CAM reconciliation, etc.
//
// event_type is free text (not a DB enum), same no-DB-enum convention used
// everywhere else in this schema. Suggested vocabulary (enforced by
// convention only, not the database): Lease Expiration, Option Notice
// Deadline, Option Exercise Deadline, Renewal Rent Step, Scheduled Rent
// Bump, Rent Commencement, TI Disbursement, CAM Reconciliation, Other.
//
// Follows the same GET/POST/PATCH conventions as every other core table
// (spaces, leases, properties, contacts, entities, projects).

const SELECT_WITH_JOINS =
  "*, lease:leases(display_code, space_id, tenant_entity_id, landlord_entity_id)";

// GET /api/agent/lease-events?limit=50&lease_id=...&event_type=...&is_completed=false
// List lease events, most recently created first. Optional filters:
// lease_id, event_type, is_completed.
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const limitParam = params.get("limit");
  const limit = limitParam ? Math.min(Number(limitParam) || 50, 200) : 50;

  let query = supabase
    .from("lease_events")
    .select(SELECT_WITH_JOINS)
    .order("created_at", { ascending: false })
    .limit(limit);

  for (const field of ["lease_id", "event_type"]) {
    const value = params.get(field);
    if (value) query = query.eq(field, value);
  }

  const isCompletedParam = params.get("is_completed");
  if (isCompletedParam !== null) {
    query = query.eq("is_completed", isCompletedParam === "true");
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ lease_events: data });
}

// POST /api/agent/lease-events — create a lease event.
// Body: { lease_id, event_type, event_date?, amount?, is_completed?, notes? }
// lease_id and event_type are required. event_date is optional — leave it
// unset when the exact date isn't known yet (e.g. a renewal still being
// negotiated) and put what's known in notes instead. is_completed defaults
// to false (matching the DB column default) unless explicitly set true.
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const lease_id = String(body.lease_id || "").trim();
  if (!lease_id) {
    return NextResponse.json({ error: "lease_id is required." }, { status: 400 });
  }

  const event_type = String(body.event_type || "").trim();
  if (!event_type) {
    return NextResponse.json({ error: "event_type is required." }, { status: 400 });
  }

  const event_date = body.event_date ? String(body.event_date) : null;
  const amountRaw = String(body.amount ?? "").trim();
  const amount = amountRaw ? Number(amountRaw) : null;
  if (amountRaw && Number.isNaN(amount)) {
    return NextResponse.json({ error: "amount must be a number." }, { status: 400 });
  }

  const is_completed = body.is_completed === undefined ? false : Boolean(body.is_completed);
  const notes = String(body.notes || "").trim() || null;

  const display_code = await nextDisplayCode("lease_events", "EVENT");

  const { data, error } = await supabase
    .from("lease_events")
    .insert({
      display_code,
      lease_id,
      event_type,
      event_date,
      amount,
      is_completed,
      notes,
    })
    .select(SELECT_WITH_JOINS)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ lease_event: data }, { status: 201 });
}

// PATCH /api/agent/lease-events — update one or more fields on an existing
// lease event by id. Body: { id, ...fields }. Only the fields actually
// present in the body are written — an omitted field is left untouched. A
// string/date field sent as "" clears it to null. Editable: lease_id,
// event_type, event_date, amount, is_completed, notes. display_code is
// never editable. At least one field besides id is required.
//
// Typical use: marking is_completed true once a TI disbursement goes out or
// an option notice is actually sent, or correcting event_date/amount as a
// deal firms up.
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

  const stringFields = ["lease_id", "event_type", "event_date", "notes"] as const;
  const numericFields = ["amount"] as const;
  const booleanFields = ["is_completed"] as const;

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
          return NextResponse.json({ error: `${field} must be a number.` }, { status: 400 });
        }
        updatePayload[field] = num;
      }
    }
  }
  for (const field of booleanFields) {
    if (field in body) {
      updatePayload[field] = Boolean(body[field]);
    }
  }

  if (Object.keys(updatePayload).length === 0) {
    return NextResponse.json(
      {
        error:
          "Provide at least one field to update: " +
          [...stringFields, ...numericFields, ...booleanFields].join(", ") + ".",
      },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("lease_events")
    .update(updatePayload)
    .eq("id", id)
    .select(SELECT_WITH_JOINS)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ lease_event: data });
}
