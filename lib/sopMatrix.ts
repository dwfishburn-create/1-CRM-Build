// The companion-SOP routing matrix — Section 4 ("Which Companion SOPs Apply,
// By Type") of /1-SOPs & Templates/New_Project_Setup_and_Categorization_-_SOP.md.
//
// 9/14/2026 — this file used to hold a hardcoded COPY of that matrix, with a
// SOP_MATRIX_SOURCE_DATE constant as the only tell for how stale the copy
// might be. That copy is gone; the matrix now lives in the `sop_matrix` table
// (migration 013) and this file just reads and shapes it.
//
// Why the change (see CRM_Requirements_and_Decisions_Log.md, 9/14/2026):
//   - Re-syncing the matrix used to mean a code change, a commit, a push and
//     a deploy. That friction IS the failure mode: the snapshot sat at
//     2026-08-26 while the SOP doc moved to 2026-09-05 and nobody re-synced.
//     It is now a row edit via PATCH /api/agent/sop-matrix.
//   - The old code could state its own sync date but could not compare it to
//     anything, so "stale label" and "stale data" were indistinguishable
//     without doing by hand the exact cross-check this tool exists to
//     eliminate. `sop_matrix_meta` carries BOTH dates, so staleness is now a
//     computed verdict rather than a note telling the reader to go look.
//   - A live Dropbox fetch at call time was considered and rejected: it would
//     parse a markdown table by position in a doc that changes often, add a
//     hard runtime Dropbox dependency to the CRM core (against the
//     vendor-independence principle), and require a Dropbox OAuth token in
//     Vercel. The SOP doc stays the canonical prose; this table is its
//     machine-readable projection.
//
// Keeping the two in sync is now a documented step rather than a hope: when an
// SOP is added or revised, update the affected rows and set
// source_last_synced. Section 5 of the SOP doc carries that step.

import { supabase } from "@/lib/supabase";

export type SopStatus = "Load" | "Adapt" | "Gap" | "N/A";

export const SOP_STATUSES: readonly SopStatus[] = ["Load", "Adapt", "Gap", "N/A"] as const;

export const PROJECT_TYPE_CODES = [
  "TR",
  "BR",
  "CL",
  "CS",
  "L",
  "LRT",
  "LRLL",
  "SL",
] as const;

export type ProjectTypeCode = (typeof PROJECT_TYPE_CODES)[number];

export const PROJECT_TYPE_LABELS: Record<ProjectTypeCode, string> = {
  TR: "Tenant Representation",
  BR: "Buyer Representation",
  CL: "Commercial Lease Listing",
  CS: "Commercial Sale Listing",
  L: "Land Listing",
  LRT: "Lease Renewal (Tenant)",
  LRLL: "Lease Renewal (Landlord)",
  SL: "Sub-Lease Listing",
};

export const SOP_MATRIX_SOURCE_DOC =
  "New_Project_Setup_and_Categorization_-_SOP.md, Section 4";

/** One cell of the matrix: what a given SOP means for a given engagement type. */
export interface SopMatrixCell {
  id: string;
  sop_name: string;
  sop_filename: string | null;
  project_type: ProjectTypeCode;
  status: SopStatus;
  note: string | null;
  sort_order: number;
}

export interface SopMatrixMeta {
  source_doc: string;
  source_doc_path: string;
  source_doc_last_updated: string;
  source_last_synced: string;
}

/** One row of the matrix, pivoted back into the shape Section 4 reads in. */
export interface SopMatrixRow {
  sop: string;
  sop_filename: string | null;
  by_type: Partial<Record<ProjectTypeCode, { status: SopStatus; note?: string }>>;
}

export interface SopStaleness {
  verdict: "CURRENT" | "STALE" | "UNKNOWN";
  source_doc_last_updated: string | null;
  source_last_synced: string | null;
  note: string;
}

/**
 * Compare the SOP doc's own "Last updated" date against the date this matrix
 * was last reconciled against it, and say plainly which way it falls.
 *
 * This is the whole point of sop_matrix_meta: the old static version could
 * report its own sync date but had nothing to compare it to, so every caller
 * had to open the SOP doc to find out whether the answer could be trusted.
 */
export function evaluateStaleness(meta: SopMatrixMeta | null): SopStaleness {
  if (!meta || !meta.source_doc_last_updated || !meta.source_last_synced) {
    return {
      verdict: "UNKNOWN",
      source_doc_last_updated: meta?.source_doc_last_updated ?? null,
      source_last_synced: meta?.source_last_synced ?? null,
      note:
        "UNKNOWN — sop_matrix_meta is missing or incomplete, so staleness can't be computed. " +
        "Cross-check Section 4 of the SOP doc by hand before relying on this result.",
    };
  }

  const stale = meta.source_doc_last_updated > meta.source_last_synced;

  return {
    verdict: stale ? "STALE" : "CURRENT",
    source_doc_last_updated: meta.source_doc_last_updated,
    source_last_synced: meta.source_last_synced,
    note: stale
      ? `STALE — the SOP doc was last updated ${meta.source_doc_last_updated} but this matrix was ` +
        `last reconciled against it on ${meta.source_last_synced}. Re-read Section 4 of ` +
        `${meta.source_doc_path}, update any changed rows via PATCH /api/agent/sop-matrix, and ` +
        `set source_last_synced. Treat the result below as provisional until that's done.`
      : `CURRENT — this matrix was reconciled against Section 4 on ${meta.source_last_synced}, ` +
        `and the SOP doc's own "Last updated" line reads ${meta.source_doc_last_updated}.`,
  };
}

async function loadMeta(): Promise<SopMatrixMeta | null> {
  const { data, error } = await supabase
    .from("sop_matrix_meta")
    .select("source_doc, source_doc_path, source_doc_last_updated, source_last_synced")
    .eq("id", 1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to read sop_matrix_meta: ${error.message}`);
  }

  return (data as SopMatrixMeta | null) ?? null;
}

async function loadCells(projectTypes?: ProjectTypeCode[]): Promise<SopMatrixCell[]> {
  let query = supabase
    .from("sop_matrix")
    .select("id, sop_name, sop_filename, project_type, status, note, sort_order")
    .order("sort_order", { ascending: true })
    .order("sop_name", { ascending: true });

  if (projectTypes && projectTypes.length) {
    query = query.in("project_type", projectTypes);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to read sop_matrix: ${error.message}`);
  }

  return (data as SopMatrixCell[]) ?? [];
}

/** Pivot flat cells back into one row per SOP, preserving sort_order. */
function pivot(cells: SopMatrixCell[]): SopMatrixRow[] {
  const rows = new Map<string, SopMatrixRow>();

  for (const cell of cells) {
    let row = rows.get(cell.sop_name);
    if (!row) {
      row = { sop: cell.sop_name, sop_filename: cell.sop_filename, by_type: {} };
      rows.set(cell.sop_name, row);
    }
    row.by_type[cell.project_type] = cell.note
      ? { status: cell.status, note: cell.note }
      : { status: cell.status };
  }

  return [...rows.values()];
}

/**
 * The whole matrix, plus metadata and a staleness verdict. Backs
 * GET /api/agent/sop-matrix with no project_type filter.
 */
export async function getSopMatrix() {
  const [cells, meta] = await Promise.all([loadCells(), loadMeta()]);

  return {
    source: SOP_MATRIX_SOURCE_DOC,
    source_doc_path: meta?.source_doc_path ?? null,
    source_last_synced: meta?.source_last_synced ?? null,
    source_doc_last_updated: meta?.source_doc_last_updated ?? null,
    staleness: evaluateStaleness(meta),
    project_types: PROJECT_TYPE_CODES,
    row_count: cells.length,
    matrix: pivot(cells),
  };
}

/**
 * Companion-SOP checklist for one or more engagement-type codes.
 *
 * Accepts a single code ("TR") or a compound/undecided value as stored on a
 * live project ("TR/BR") — splits on "/", trims, uppercases, and unions the
 * rows for every recognized code found. Unrecognized codes are reported back
 * rather than silently dropped, since that usually means either a typo or a
 * genuinely new engagement type (see the SOP's Section 1 instruction to stop
 * and flag it rather than forcing a fit).
 *
 * Response shape note: `source_last_synced` is kept at the top level under
 * that exact name because Section 8 of the SOP doc — the standing self-check
 * instruction pasted into every deal-specific Claude Project — references it
 * by name. Don't rename it without updating that instruction.
 */
export async function getSopChecklist(projectType: string) {
  const requested = projectType
    .split("/")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

  const recognized = requested.filter((c): c is ProjectTypeCode =>
    (PROJECT_TYPE_CODES as readonly string[]).includes(c)
  );
  const unrecognized = requested.filter((c) => !recognized.includes(c as ProjectTypeCode));

  const [cells, meta] = await Promise.all([
    recognized.length ? loadCells(recognized) : Promise.resolve([] as SopMatrixCell[]),
    loadMeta(),
  ]);

  const staleness = evaluateStaleness(meta);

  const checklist = pivot(cells).map((row) => ({
    sop: row.sop,
    sop_filename: row.sop_filename,
    by_type: Object.fromEntries(
      recognized.map((code) => [code, row.by_type[code] ?? { status: "N/A" as const }])
    ),
  }));

  return {
    project_type: projectType,
    codes: recognized,
    unrecognized_codes: unrecognized.length ? unrecognized : undefined,
    source: SOP_MATRIX_SOURCE_DOC,
    source_last_synced: staleness.source_last_synced,
    source_doc_last_updated: staleness.source_doc_last_updated,
    staleness: staleness.verdict,
    note: staleness.note,
    checklist,
  };
}
