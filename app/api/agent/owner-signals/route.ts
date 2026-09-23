import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { supabase } from "@/lib/supabase";
import { nextDisplayCode } from "@/lib/displayCode";

// Agent API for owner_signals — migration 014. See
// CRM_Requirements_and_Decisions_Log.md, "9/15/2026 — Owner signals get their
// own history table".
//
// An owner signal is a dated indication of what a property's owner would
// accept: "I'd sell if someone paid $2.4M," "I'd lease it at $18 NNN but not
// below," "not interested at any price."
//
// Three rules this route exists to enforce:
//   * A new conversation is a NEW ROW. Never update an existing signal to
//     reflect a later conversation — the movement between numbers is the
//     negotiating leverage. PATCH is for CORRECTIONS only.
//   * The current signal for a property is the newest signal_date, which is
//     why GET sorts by signal_date descending rather than created_at.
//   * CONFIDENTIAL BY DEFAULT. Never client-facing unless Dan says so.
//
// signal_type and source are free text (not DB enums), same convention used
// everywhere else in this schema. Suggested vocabulary, enforced by
// convention only:
//   signal_type: Would Sell, Would Lease, Would Sell or Lease,
//                Not Interested, Other
//   source:      Direct Conversation, Secondhand, Inferred
//
// Follows the same GET/POST/PATCH conventions as every other core table.

const SELECT_WITH_JOINS =
  "*, property:properties(display_code, address, suite_number), " +
  "contact:contacts(display_code, first_name, last_name), " +
  "entity:entities(display_code, name)";

// GET /api/agent/owner-signals?limit=50&property_id=...&entity_id=...&signal_type=...
// List owner signals, NEWEST SIGNAL_DATE FIRST — the most recent signal for a
// property is the one that counts. Optional filters: property_id, contact_id,
// entity_id, signal_type.
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const limitParam = params.get("limit");
  const limit = limitParam ? Math.min(Number(limitParam) || 50, 200) : 50;

  let query = supabase
    .from("owner_signals")
    .select(SELECT_WITH_JOINS)
    .order("signal_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);

  for (const field of ["property_id", "contact_id", "entity_id", "signal_type"]) {
    const value = params.get(field);
    if (value) query = query.eq(field, value);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ owner_signals: data });
}

// POST /api/agent/owner-signals — record a new owner signal.
// Body: { property_id, signal_type, signal_date?, contact_id?, entity_id?,
//         source?, indicated_price?, indicated_rent?, indicated_rent_basis?,
//         conditions?, notes? }
// property_id and signal_type are required. signal_date defaults to today.
// contact_id (who said it) and entity_id (the owner entity) are optional and
// independent — either can be known without the other.
//
// Use this EVERY TIME an owner says something new, even about a property that
// already has signals. A changed number is a new row, not an edit.
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const property_id = String(body.property_id || "").trim();
  if (!property_id) {
    return NextResponse.json({ error: "property_id is required." }, { status: 400 });
  }

  const signal_type = String(body.signal_type || "").trim();
  if (!signal_type) {
    return NextResponse.json({ error: "signal_type is required." }, { status: 400 });
  }

  const contact_id = String(body.contact_id || "").trim() || null;
  const entity_id = String(body.entity_id || "").trim() || null;
  const signal_date = body.signal_date ? String(body.signal_date) : null;
  const source = String(body.source || "").trim() || null;
  const indicated_rent_basis = String(body.indicated_rent_basis || "").trim() || null;
  const conditions = String(body.conditions || "").trim() || null;
  const notes = String(body.notes || "").trim() || null;

  const numericValues: Record<string, number | null> = {};
  for (const field of ["indicated_price", "indicated_rent"] as const) {
    const raw = String(body[field] ?? "").trim();
    if (!raw) {
      numericValues[field] = null;
      continue;
    }
    const num = Number(raw);
    if (Number.isNaN(num)) {
      return NextResponse.json({ error: `${field} must be a number.` }, { status: 400 });
    }
    numericValues[field] = num;
  }

  const display_code = await nextDisplayCode("owner_signals", "SIG");

  const insertPayload: Record<string, unknown> = {
    display_code,
    property_id,
    contact_id,
    entity_id,
    signal_type,
    source,
    indicated_price: numericValues.indicated_price,
    indicated_rent: numericValues.indicated_rent,
    indicated_rent_basis,
    conditions,
    notes,
  };
  // Only send signal_date when supplied, so the DB default (today) applies.
  if (signal_date) insertPayload.signal_date = signal_date;

  const { data, error } = await supabase
    .from("owner_signals")
    .insert(insertPayload)
    .select(SELECT_WITH_JOINS)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ owner_signal: data }, { status: 201 });
}

// PATCH /api/agent/owner-signals — CORRECT an existing owner signal by id.
// Body: { id, ...fields }. Only the fields present in the body are written.
//
// This is for fixing a mistake — a mistyped price, the wrong contact, a date
// off by a day. It is NOT how you record that an owner's number changed: that
// is a new POST. Overwriting a signal destroys exactly the history this table
// exists to keep.
//
// property_id, signal_date and signal_type are the three required columns and
// cannot be cleared — sending any of them as an empty string is rejected
// rather than silently written as null. Every other string field accepts ""
// to clear it. display_code is never editable.
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

  const requiredFields = ["property_id", "signal_date", "signal_type"] as const;
  const clearableStringFields = [
    "contact_id",
    "entity_id",
    "source",
    "indicated_rent_basis",
    "conditions",
    "notes",
  ] as const;
  const numericFields = ["indicated_price", "indicated_rent"] as const;

  const updatePayload: Record<string, unknown> = {};

  for (const field of requiredFields) {
    if (field in body) {
      const value = String(body[field] ?? "").trim();
      if (!value) {
        return NextResponse.json(
          { error: `${field} is required and cannot be cleared.` },
          { status: 400 }
        );
      }
      updatePayload[field] = value;
    }
  }

  for (const field of clearableStringFields) {
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

  if (Object.keys(updatePayload).length === 0) {
    return NextResponse.json(
      {
        error:
          "Provide at least one field to update: " +
          [...requiredFields, ...clearableStringFields, ...numericFields].join(", ") + ".",
      },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("owner_signals")
    .update(updatePayload)
    .eq("id", id)
    .select(SELECT_WITH_JOINS)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ owner_signal: data });
}
