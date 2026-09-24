import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { supabase } from "@/lib/supabase";

// POST /api/agent/properties/merge — fold a duplicate property into the
// record that should survive. Body: { keep_id, merge_id }.
//
// Added 9/24/2026 (migration 016), alongside the property lookup and delete.
// Properties were the last core table with no lookup, no merge and no delete:
// list_properties took a limit and nothing else, so "is 3606 S 61st Ave Cir
// already in here?" had no cheap answer, and the answer being "no" when it was
// really "yes, spelled differently" is how duplicates get made.
//
// Why merge matters more for properties than for anything else: spaces.
// property_id is NOT NULL ON DELETE CASCADE and leases.space_id is NOT NULL
// ON DELETE CASCADE under it. Deleting a duplicate property therefore deletes
// its spaces, every lease on them, and every lease event under those — the
// exact critical-dates history the 13-month reminder design is built on —
// silently, with no complaint from Postgres. merge_properties repoints all of
// it onto the survivor instead.
//
// The work happens in merge_properties() (migration 016): thirteen FK columns
// plus the parent_property_id self-reference, in one transaction.
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
          "Both keep_id (the property that survives) and merge_id (the duplicate " +
          "that is folded in and removed) are required.",
      },
      { status: 400 }
    );
  }

  if (keep_id === merge_id) {
    return NextResponse.json(
      { error: "keep_id and merge_id are the same property." },
      { status: 400 }
    );
  }

  const { data, error } = await supabase.rpc("merge_properties", {
    p_keep_id: keep_id,
    p_merge_id: merge_id,
  });

  if (error) {
    const status = error.code === "P0001" ? 400 : 500;
    return NextResponse.json({ error: error.message }, { status });
  }

  return NextResponse.json(data);
}
