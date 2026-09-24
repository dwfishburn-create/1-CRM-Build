import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { supabase } from "@/lib/supabase";

// Entity aliases — the other names a company is known by. Added 9/24/2026
// (migration 016), closing open question #3 from 9/14/2026.
//
// trade_name has existed since 9/8/2026 and could not do this job: it holds
// exactly one alternate name, and nothing checked against it at create time.
// A company routinely has more than one — the legal name, the d/b/a, the name
// on the lease, the assessor's spelling, whatever a broker typed in an email.
// Ashley Lynn's Inc. d/b/a Palm Beach Tan is the standing example; TitleCore,
// LLC / TitleCore National is the one that actually caused a duplicate.
//
// Aliases feed entities.search_text (via the alias_text column and its
// trigger), so an alias makes the existing lookup and the near-match check on
// create_entity both find the one real record instead of making a second.
//
// GET    ?entity_id=<uuid>  — list aliases, optionally for one entity
// POST   { entity_id, alias, source?, note? }
// DELETE ?id=<uuid>         — remove one alias

export async function GET(request: NextRequest) {
  const entity_id = (request.nextUrl.searchParams.get("entity_id") || "").trim();
  const limitParam = request.nextUrl.searchParams.get("limit");
  const limit = limitParam ? Math.min(Number(limitParam) || 50, 200) : 50;

  let query = supabase
    .from("entity_aliases")
    .select("id, entity_id, alias, source, note, created_at, entity:entities!entity_id(id, display_code, name)")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (entity_id) {
    query = query.eq("entity_id", entity_id);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ aliases: data });
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const entity_id = String(body.entity_id || "").trim();
  const alias = String(body.alias || "").trim();
  const source = String(body.source || "").trim() || null;
  const note = String(body.note || "").trim() || null;

  if (!entity_id || !alias) {
    return NextResponse.json(
      { error: "entity_id and alias are both required." },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("entity_aliases")
    .insert({ entity_id, alias, source, note })
    .select("id, entity_id, alias, source, note, created_at")
    .single();

  if (error) {
    // 23505 is unique_violation — the alias is already on this entity, which
    // is a no-op rather than a failure worth a 500.
    if (error.code === "23505") {
      return NextResponse.json(
        { error: `That alias is already recorded on this entity.`, alias },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ alias: data }, { status: 201 });
}

export async function DELETE(request: NextRequest) {
  const id = (request.nextUrl.searchParams.get("id") || "").trim();
  if (!id) {
    return NextResponse.json(
      { error: "id is required, as a query parameter: ?id=<uuid>" },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("entity_aliases")
    .delete()
    .eq("id", id)
    .select("id, entity_id, alias")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: `No alias with id ${id}.` }, { status: 404 });
  }

  return NextResponse.json({ deleted: true, alias: data });
}
