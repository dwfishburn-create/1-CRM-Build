import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { supabase } from "@/lib/supabase";

// Commission payments (migration 025, 10/10/2026) — one row per expected
// payment on a deal. amount is GROSS; Dan's share of it is amount × the
// deal's dan_share_pct, returned here as dan_share_amount for convenience.
// A payment is owed once earned_date has passed and received_date is empty;
// that is what ages in the Dashboard's Waiting On.
//
// GET    ?project_id=… &unpaid=true    list
// POST   { project_id, label, amount?, earned_date? | due_note?, invoiced_date?, notes? }
// PATCH  { id, …fields; received_date + received_amount record a payment }
// DELETE ?id=…

const SELECT = "*, project:projects!project_id(project_code, dan_share_pct)";
const DATE = /^\d{4}-\d{2}-\d{2}$/;

type Row = { amount: number | null; project: { dan_share_pct: number | null } | { dan_share_pct: number | null }[] | null };

function withShare<T extends Row>(r: T): T & { dan_share_amount: number | null } {
  const p = Array.isArray(r.project) ? r.project[0] : r.project;
  const pct = p?.dan_share_pct;
  return { ...r, dan_share_amount: r.amount != null && pct != null ? Math.round(r.amount * pct) / 100 : null };
}

async function readBody(request: NextRequest): Promise<Record<string, unknown> | null> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function bad(msg: string, status = 400) {
  return NextResponse.json({ error: msg }, { status });
}

function readFields(body: Record<string, unknown>, out: Record<string, unknown>): string | null {
  for (const f of ["label", "due_note", "notes"] as const) {
    if (f in body) out[f] = String(body[f] ?? "").trim() || null;
  }
  for (const f of ["earned_date", "invoiced_date", "received_date"] as const) {
    if (f in body) {
      const v = String(body[f] ?? "").trim();
      if (v && !DATE.test(v)) return `${f} must be YYYY-MM-DD.`;
      out[f] = v || null;
    }
  }
  for (const f of ["amount", "received_amount"] as const) {
    if (f in body) {
      const raw = body[f];
      if (raw === null || raw === "") out[f] = null;
      else {
        const n = Number(raw);
        if (Number.isNaN(n)) return `${f} must be a number.`;
        out[f] = n;
      }
    }
  }
  return null;
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const limit = Math.min(Number(params.get("limit")) || 100, 200);
  let query = supabase
    .from("commission_payments")
    .select(SELECT)
    .order("earned_date", { ascending: true, nullsFirst: false })
    .limit(limit);
  const projectId = params.get("project_id");
  if (projectId) query = query.eq("project_id", projectId);
  if (params.get("unpaid") === "true") query = query.is("received_date", null);
  const { data, error } = await query;
  if (error) return bad(error.message, 500);
  return NextResponse.json({ commission_payments: (data ?? []).map((r) => withShare(r as Row)) });
}

export async function POST(request: NextRequest) {
  const body = await readBody(request);
  if (!body) return bad("Invalid JSON body.");
  const project_id = String(body.project_id || "").trim();
  if (!project_id) return bad("project_id is required.");

  const row: Record<string, unknown> = { project_id };
  const err = readFields(body, row);
  if (err) return bad(err);
  if (!row.label) return bad("label is required, e.g. \"Payment 1\".");
  if (!row.earned_date && !row.due_note) {
    return bad("Give earned_date (YYYY-MM-DD), or due_note for a payment not yet earned (e.g. \"Lease Year 6\").");
  }
  for (const f of ["source_system", "source_record_id", "source_batch_id"] as const) {
    if (body[f]) row[f] = String(body[f]).trim();
  }

  const { data, error } = await supabase.from("commission_payments").insert(row).select(SELECT).single();
  if (error) return bad(error.message, 500);
  return NextResponse.json({ commission_payment: withShare(data as Row) }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const body = await readBody(request);
  if (!body) return bad("Invalid JSON body.");
  const id = String(body.id || "").trim();
  if (!id) return bad("id is required.");

  const patch: Record<string, unknown> = {};
  const err = readFields(body, patch);
  if (err) return bad(err);
  if (Object.keys(patch).length === 0) {
    return bad("Provide at least one field: label, amount, earned_date, due_note, invoiced_date, received_date, received_amount, notes.");
  }
  patch.updated_at = new Date().toISOString();

  const { data, error } = await supabase.from("commission_payments").update(patch).eq("id", id).select(SELECT).single();
  if (error) return bad(error.message, 500);
  return NextResponse.json({ commission_payment: withShare(data as Row) });
}

export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  if (!id) return bad("id is required.");
  const { error } = await supabase.from("commission_payments").delete().eq("id", id);
  if (error) return bad(error.message, 500);
  return NextResponse.json({ deleted: id });
}
