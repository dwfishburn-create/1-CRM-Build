import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { supabase } from "@/lib/supabase";
import { nextDisplayCode } from "@/lib/displayCode";

// Agent API for property_expenses — Phase 2 of the Space/Lease data model
// (migration 012 — see CRM_Requirements_and_Decisions_Log.md, "9/8/2026 —
// Space/Lease data model designed and built" and its Phase 2 follow-up).
// Deliberately minimal, per the original scope note: property_id, year,
// category, amount — a CAM/tax category breakout AND multi-year expense
// history in one table, since both needs are the same shape of data.
//
// category is free text (CAM, Property Tax, Insurance, etc.), not a DB
// enum — same no-DB-enum convention used everywhere else in this schema.
// No uniqueness constraint on (property_id, year, category): a category can
// get more than one row in a year (e.g. a correction or a supplemental
// invoice) without needing an upsert-then-adjust dance.
//
// Follows the same GET/POST/PATCH conventions as every other core table.

const SELECT_WITH_JOINS = "*, property:properties(display_code, address, suite_number)";

// GET /api/agent/property-expenses?limit=50&property_id=...&year=2026&category=CAM
// List property expenses, most recently created first. Optional filters:
// property_id, year, category.
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const limitParam = params.get("limit");
  const limit = limitParam ? Math.min(Number(limitParam) || 50, 200) : 50;

  let query = supabase
    .from("property_expenses")
    .select(SELECT_WITH_JOINS)
    .order("created_at", { ascending: false })
    .limit(limit);

  for (const field of ["property_id", "category"]) {
    const value = params.get(field);
    if (value) query = query.eq(field, value);
  }

  const yearParam = params.get("year");
  if (yearParam) query = query.eq("year", Number(yearParam));

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ property_expenses: data });
}

// POST /api/agent/property-expenses — create a property expense record.
// Body: { property_id, year, category, amount, notes? }
// property_id, year, category, and amount are all required.
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

  const category = String(body.category || "").trim();
  if (!category) {
    return NextResponse.json({ error: "category is required." }, { status: 400 });
  }

  const yearRaw = String(body.year ?? "").trim();
  const year = yearRaw ? Number(yearRaw) : NaN;
  if (!yearRaw || Number.isNaN(year)) {
    return NextResponse.json({ error: "year is required and must be a number." }, { status: 400 });
  }

  const amountRaw = String(body.amount ?? "").trim();
  const amount = amountRaw ? Number(amountRaw) : NaN;
  if (!amountRaw || Number.isNaN(amount)) {
    return NextResponse.json({ error: "amount is required and must be a number." }, { status: 400 });
  }

  const notes = String(body.notes || "").trim() || null;

  const display_code = await nextDisplayCode("property_expenses", "EXP");

  const { data, error } = await supabase
    .from("property_expenses")
    .insert({
      display_code,
      property_id,
      year,
      category,
      amount,
      notes,
    })
    .select(SELECT_WITH_JOINS)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ property_expense: data }, { status: 201 });
}

// PATCH /api/agent/property-expenses — update one or more fields on an
// existing property expense by id. Body: { id, ...fields }. Only the
// fields actually present in the body are written — an omitted field is
// left untouched. A string field sent as "" clears it to null. Editable:
// property_id, year, category, amount, notes. display_code is never
// editable. At least one field besides id is required.
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

  const stringFields = ["property_id", "category", "notes"] as const;
  const numericFields = ["year", "amount"] as const;

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
    .from("property_expenses")
    .update(updatePayload)
    .eq("id", id)
    .select(SELECT_WITH_JOINS)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ property_expense: data });
}
