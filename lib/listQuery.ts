// Shared parsing for the searchable, paginated list endpoints
// (/api/agent/contacts and /api/agent/entities, added 9/15/2026).
//
// Why this exists: finding #1 in CRM_Findings_2026-09-15_BR-HyVee.md. Both
// list endpoints returned every row with every column and no way to filter,
// so a lookup as small as "does Richard Secor already exist?" cost a
// full-table dump — 57,000 characters on 9/14 at 64 contacts, ~63,000 on
// 9/15, both over the MCP tool response cap. The fix has three parts, and
// this file is the shared half of two of them:
//
//   1. search   — matched against the search_text generated column added in
//                 migration 014, one chained ilike per whitespace-separated
//                 token. PostgREST ANDs chained filters, so "richard secor"
//                 requires both tokens rather than matching every Richard
//                 and every Secor.
//   2. fields   — a compact projection by default. The full row (notes,
//                 timestamps, search_text) is available on request but is
//                 not what a lookup needs, and notes is the single biggest
//                 contributor to the response size.
//   3. limit/offset — a bounded page, always. The old default returned up to
//                 200 rows; the cap is now 100 and the default is 25, so no
//                 caller can blow the response limit by accident again.
//
// Every list response also carries `count` (total matching rows, ignoring
// the page) and `has_more`, so a caller can tell the difference between "no
// such contact" and "not on this page" — which is the failure mode that made
// the old endpoint untrustworthy for dedupe.

export const DEFAULT_LIMIT = 25;
export const MAX_LIMIT = 100;

export type ListParams = {
  limit: number;
  offset: number;
  /** Whitespace-separated, lowercased search tokens. Empty when no search. */
  terms: string[];
  /** Requested projection: "summary" (default), "full", or explicit columns. */
  fields: string | null;
};

export function parseListParams(searchParams: URLSearchParams): ListParams {
  const limitParam = searchParams.get("limit");
  const parsedLimit = limitParam ? Number(limitParam) : NaN;
  const limit = Number.isFinite(parsedLimit) && parsedLimit > 0
    ? Math.min(Math.floor(parsedLimit), MAX_LIMIT)
    : DEFAULT_LIMIT;

  const offsetParam = searchParams.get("offset");
  const parsedOffset = offsetParam ? Number(offsetParam) : NaN;
  const offset = Number.isFinite(parsedOffset) && parsedOffset > 0
    ? Math.floor(parsedOffset)
    : 0;

  const search = (searchParams.get("search") || "").trim().toLowerCase();
  const terms = search ? search.split(/\s+/).filter(Boolean).slice(0, 6) : [];

  const fields = searchParams.get("fields");

  return { limit, offset, terms, fields: fields ? fields.trim() : null };
}

/**
 * Resolve the `fields` parameter to a PostgREST select string.
 *
 * "summary" (or omitted) and "full" are the two shorthands. Anything else is
 * treated as an explicit comma-separated column list and checked against an
 * allowlist — an unknown column is rejected rather than passed through, so a
 * typo returns a 400 naming the bad column instead of a PostgREST error, and
 * nothing the caller writes reaches the select string unvalidated.
 */
export function resolveSelect(
  fields: string | null,
  presets: { summary: string; full: string },
  allowedColumns: readonly string[]
): { select: string } | { error: string } {
  if (!fields || fields === "summary") return { select: presets.summary };
  if (fields === "full") return { select: presets.full };

  const requested = fields
    .split(",")
    .map((f) => f.trim())
    .filter(Boolean);

  if (requested.length === 0) return { select: presets.summary };

  const unknown = requested.filter((f) => !allowedColumns.includes(f));
  if (unknown.length > 0) {
    return {
      error:
        `Unknown field(s): ${unknown.join(", ")}. ` +
        `Use fields=summary, fields=full, or a comma-separated subset of: ` +
        `${allowedColumns.join(", ")}.`,
    };
  }

  // id is always included — without it nothing downstream can reference the
  // row it just read, which is the whole point of a lookup.
  const withId = requested.includes("id") ? requested : ["id", ...requested];
  return { select: withId.join(", ") };
}
