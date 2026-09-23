import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { supabase } from "@/lib/supabase";

// POST /api/agent/contacts/merge — fold a duplicate contact into the record
// that should survive. Body: { keep_id, merge_id }.
//
// Added 9/15/2026 for finding #2 in CRM_Findings_2026-09-15_BR-HyVee.md.
//
// What went wrong without it: on 9/14 a title commitment listed
// danocox860@cox.net under the seller trust's display name with no personal
// name anywhere in the thread. Because list_contacts had no lookup (finding
// #1), there was no practical way to check whether that address was already
// on file, so it went in as a placeholder — CON-0068, "Unidentified Moore
// Trust Contact". It was already on file: the address belongs to Daniel E.
// Moore (CON-0058), co-trustee of both selling trusts and a required
// signatory on the executed Purchase Agreement. With no delete and no merge,
// the correction could only be cosmetic — CON-0068 became a permanent
// tombstone row renamed "[MERGED] see Daniel E. Moore CON-0058", visible in
// every future list call forever.
//
// The actual work happens in the merge_contacts() plpgsql function from
// migration 014, not here. Ten FK columns across nine tables point at
// contacts; doing that repointing as ten separate calls from this handler
// would risk a half-merged contact if one failed partway, which is worse
// than the tombstone it replaces. In the function it is one transaction.
//
// This handler is the thin part: validate, call, translate a raised
// exception into a 400 rather than a 500, since every exception the function
// raises is a bad-input condition (same id twice, either id missing from the
// table).
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
          "Both keep_id (the contact that survives) and merge_id (the duplicate " +
          "that is folded in and removed) are required.",
      },
      { status: 400 }
    );
  }

  if (keep_id === merge_id) {
    return NextResponse.json(
      { error: "keep_id and merge_id are the same contact." },
      { status: 400 }
    );
  }

  const { data, error } = await supabase.rpc("merge_contacts", {
    p_keep_id: keep_id,
    p_merge_id: merge_id,
  });

  if (error) {
    // P0001 is raise_exception — the function's own guards (unknown id, same
    // id twice). Those are the caller's problem, not the server's.
    const status = error.code === "P0001" ? 400 : 500;
    return NextResponse.json({ error: error.message }, { status });
  }

  return NextResponse.json(data);
}
