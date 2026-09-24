import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { supabase } from "@/lib/supabase";

// POST /api/agent/entities/merge — fold a duplicate entity into the record
// that should survive. Body: { keep_id, merge_id }.
//
// Added 9/24/2026 (migration 016). Until now entities had no merge path at
// all — list_entities' own description said so: "a duplicate entity has no
// merge path and becomes permanent."
//
// What that cost, concretely: on 9/14/2026 ENT-0052 "TitleCore, LLC" (escrow,
// 210 Regency Pkwy) and "TitleCore National" (underwriting, 8701 W. Dodge,
// @titlecorenational.com) turned out to be one company operating under two
// names at two addresses. They were combined by judgment — someone noticed —
// and nothing in the schema would have caught it or could have undone it.
// With 2,083 RealNex companies waiting to import, judgment does not scale.
//
// The work happens in merge_entities() (migration 016), not here: thirteen FK
// columns across twelve tables point at entities, and doing that as thirteen
// separate calls risks a half-merged entity if one fails partway. In the
// function it is one transaction.
//
// One behaviour worth knowing: the loser's name and trade name survive as
// aliases on the keeper. Merging "TitleCore National" into "TitleCore, LLC"
// leaves "TitleCore National" searchable, which matters because that is the
// name the next document will use.
//
// This handler is the thin part: validate, call, and translate the function's
// own raised exceptions (same id twice, unknown id) into a 400 rather than a
// 500.
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const keep_id = String(body.keep_id || "").trim();
  const merge_id = String(body.merge_id || "").trim();

  if (!keep_id || !merge_id) {
    return NextResponse.json(
      {
        error:
          "Both keep_id (the entity that survives) and merge_id (the duplicate " +
          "that is folded in and removed) are required.",
      },
      { status: 400 }
    );
  }

  if (keep_id === merge_id) {
    return NextResponse.json(
      { error: "keep_id and merge_id are the same entity." },
      { status: 400 }
    );
  }

  const { data, error } = await supabase.rpc("merge_entities", {
    p_keep_id: keep_id,
    p_merge_id: merge_id,
  });

  if (error) {
    const status = error.code === "P0001" ? 400 : 500;
    return NextResponse.json({ error: error.message }, { status });
  }

  return NextResponse.json(data);
}
