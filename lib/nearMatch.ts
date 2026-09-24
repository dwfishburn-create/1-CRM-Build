// Shared duplicate detection for the three create endpoints (contacts,
// entities, properties). Added 9/24/2026.
//
// Why this exists, and why it BLOCKS rather than warns:
//
// Migration 014 gave contacts a lookup (find_contact) and an undo (merge/
// delete), and the create path was left to the caller's discipline — its own
// tool description said "Run find_contact first — this tool does not check
// for duplicates." That is a rule an agent has to remember on every single
// call, and in practice four duplicates were created in three days against
// 77 contacts. Entities never even had the undo: a duplicate entity was
// permanent, and TitleCore, LLC / TitleCore National got resolved by a human
// noticing, not by anything the system did.
//
// The RealNex import waiting on this brings 26,156 contacts — 13,642 of them
// in exact first/last/company duplicate triples — plus ~2,083 companies and
// 3,834 properties. At that volume a rule the caller must remember is a rule
// that will be broken thousands of times, and every break is permanent-ish
// work to undo. So the check moved into the write path itself: a create that
// looks like an existing record is refused, with the candidates returned, and
// the caller either links to the row it was shown or says allow_duplicate:
// true on purpose.
//
// Dan's framing, 9/22/2026: duplicate prevention is a hard gate before ANY
// import, not a nice-to-have. A warning that can be ignored is not a gate.
//
// The scoring itself lives in Postgres (find_similar_contacts /
// find_similar_entities / find_similar_properties, migration 016) because it
// needs pg_trgm and the normalized columns. This file is only the policy: what
// score is close enough to refuse, and what the refusal looks like.

import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

/**
 * Score at or above which a create is refused.
 *
 * The RPCs return 1.0 for identity (same email, same normalized name, same
 * parcel), 0.9–0.95 for containment or an alias hit, and raw trigram
 * similarity otherwise. 0.8 therefore refuses "this is the same record" and
 * "one name contains the other", and merely reports anything fuzzier.
 *
 * Deliberately not configurable per call: a threshold the caller can lower is
 * a threshold that gets lowered.
 */
export const DUPLICATE_BLOCK_THRESHOLD = 0.8;

/** Score above which a candidate is worth showing at all, even if allowed. */
export const DUPLICATE_REPORT_THRESHOLD = 0.4;

export type DuplicateCandidate = {
  id: string;
  display_code?: string | null;
  score: number;
  reason: string;
  [key: string]: unknown;
};

export type NearMatchResult =
  | { ok: true; candidates: DuplicateCandidate[] }
  | { ok: false; error: string };

/**
 * Run one of the find_similar_* RPCs and return its candidates, sorted by the
 * function (most similar first).
 *
 * A failure here is returned rather than thrown, and the callers treat it as
 * non-fatal: if the duplicate check itself is broken, refusing every create
 * would take the CRM down, which is a worse failure than letting a possible
 * duplicate through. The response says the check did not run.
 */
export async function findNearMatches(
  rpc: "find_similar_contacts" | "find_similar_entities" | "find_similar_properties",
  args: Record<string, unknown>
): Promise<NearMatchResult> {
  const { data, error } = await supabase.rpc(rpc, args);

  if (error) {
    return { ok: false, error: error.message };
  }

  const candidates = Array.isArray(data) ? (data as DuplicateCandidate[]) : [];
  return {
    ok: true,
    candidates: candidates.filter(
      (c) => Number(c.score) >= DUPLICATE_REPORT_THRESHOLD
    ),
  };
}

export function blockingMatches(candidates: DuplicateCandidate[]): DuplicateCandidate[] {
  return candidates.filter((c) => Number(c.score) >= DUPLICATE_BLOCK_THRESHOLD);
}

/**
 * The 409 a blocked create returns.
 *
 * Shaped for an agent reading it: what was refused, what it looks like, and
 * the two ways forward — use the existing row's id, or repeat the create with
 * allow_duplicate: true. The merge tool is named too, because the other common
 * case is that the caller genuinely did mean a new record and the EXISTING row
 * is the mistake.
 */
export function duplicateBlockResponse(
  kind: "contact" | "entity" | "property",
  candidates: DuplicateCandidate[]
) {
  const mergeTool =
    kind === "contact"
      ? "merge_contacts"
      : kind === "entity"
        ? "merge_entities"
        : "merge_properties";

  return NextResponse.json(
    {
      error:
        `Refused: this looks like an existing ${kind} already in the CRM. ` +
        `Nothing was created. Use the id of the matching record below if it is ` +
        `the same ${kind}; if it genuinely is a different one, repeat this call ` +
        `with allow_duplicate: true. If the EXISTING record is the wrong one, ` +
        `fix it with ${mergeTool} rather than adding another.`,
      possible_duplicates: candidates,
      allow_duplicate_hint: `Repeat with "allow_duplicate": true to create it anyway.`,
    },
    { status: 409 }
  );
}
