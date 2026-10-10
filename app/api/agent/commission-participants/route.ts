import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { supabase } from "@/lib/supabase";

// Commission participants (Tier B #5, migration 025, 10/10/2026) — everyone
// besides Dan who shares a deal's fee. Splits live only here; the old
// project_contacts.split_pct is retired and project-contacts now refuses it.
//
// GET    ?project_id=…            list (one deal, or all, newest first)
// POST   { project_id, contact_id? | entity_id? | party_name?, role?, split_pct?, off_the_top?, notes? }
// PATCH  { id, …any of the above except project_id }
// DELETE ?id=…

const ROLES = ["colleague", "co_broker", "referral", "outside_broker", "other"];
const SELECT =
  "*, project:projects!project_id(project_code), contact:contacts!contact_id(display_code, first_name, last_name), entity:entities!entity_id(display_code, name)";

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

// Shared field parsing for POST and PATCH. Returns an error string or null.
function readFields(body: Record<string, unknown>, out: Record<string, unknown>): string | null {
  for (const f of ["contact_id", "entity_id", "party_name", "notes"] as const) {
    if (f in body) out[f] = String(body[f] ?? "").trim() || null;
  }
  if ("role" in body) {
    const r = String(body.role ?? "").trim() || "other";
    if (!ROLES.includes(r)) return `role must be one of: ${ROLES.join(", ")}.`;
    out.role = r;
  }
  if ("split_pct" in body) {
    const raw = body.split_pct;
    if (raw === null || raw === "") out.split_pct = null;
    else {
      const n = Number(raw);
      if (Number.isNaN(n) || n < 0 || n > 100) return "split_pct must be a percent of gross between 0 and 100.";
      out.split_pct = n;
    }
  }
  if ("off_the_top" in body) out.off_the_top = body.off_the_top === true || body.off_the_top === "true";
  return null;
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const limit = Math.min(Number(params.get("limit")) || 100, 200);
  let query = supabase
    .from("project_commission_participants")
    .select(SELECT)
    .order("created_at", { ascending: false })
    .limit(limit);
  const projectId = params.get("project_id");
  if (projectId) query = query.eq("project_id", projectId);
  const { data, error } = await query;
  if (error) return bad(error.message, 500);
  return NextResponse.json({ commission_participants: data });
}

export async function POST(request: NextRequest) {
  const body = await readBody(request);
  if (!body) return bad("Invalid JSON body.");
  const project_id = String(body.project_id || "").trim();
  if (!project_id) return bad("project_id is required.");

  const row: Record<string, unknown> = { project_id, role: "other" };
  const err = readFields(body, row);
  if (err) return bad(err);
  if (!row.contact_id && !row.entity_id && !row.party_name) {
    return bad("Give the party: contact_id, entity_id, or party_name for someone not on file.");
  }
  for (const f of ["source_system", "source_record_id", "source_batch_id"] as const) {
    if (body[f]) row[f] = String(body[f]).trim();
  }

  const { data, error } = await supabase
    .from("project_commission_participants")
    .insert(row)
    .select(SELECT)
    .single();
  if (error) return bad(error.message, 500);
  return NextResponse.json({ commission_participant: data }, { status: 201 });
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
    return bad("Provide at least one field: contact_id, entity_id, party_name, role, split_pct, off_the_top, notes.");
  }
  patch.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from("project_commission_participants")
    .update(patch)
    .eq("id", id)
    .select(SELECT)
    .single();
  if (error) return bad(error.message, 500);
  return NextResponse.json({ commission_participant: data });
}

export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  if (!id) return bad("id is required.");
  const { error } = await supabase.from("project_commission_participants").delete().eq("id", id);
  if (error) return bad(error.message, 500);
  return NextResponse.json({ deleted: id });
}
