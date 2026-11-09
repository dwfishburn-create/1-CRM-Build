// Engagement-type codes: the one source of truth for the code list.
//
// Section 1 of /1-SOPs & Templates/New_Project_Setup_and_Categorization_-_SOP.md
// is the canonical prose; this file is what the code validates against. Every
// place that used to carry its own copy of the list (the sop-matrix route, the
// MCP tools, the projects page dropdown) imports it from here. The DB keeps one
// more copy that can't import: the sop_matrix_project_type_check constraint
// (migration 013, widened in 033). Adding a code = add it here + a migration
// that widens that constraint and seeds its sop_matrix cells.
//
// projects.project_type itself stays free text (no check constraint) so a
// compound/undecided value like "TR/BR" or "BR/L" stays possible.
//
// 11/9/2026: BOV (Broker Opinion of Value) added as the ninth code and the
// first in a fourth family, Advisory. First live use: BOV-Titan Machinery -
// McCook & Gordon NE.

export const PROJECT_TYPE_CODES = [
  "TR",
  "BR",
  "CL",
  "CS",
  "L",
  "LRT",
  "LRLL",
  "SL",
  "BOV",
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
  BOV: "Broker Opinion of Value",
};

export type EngagementFamily = "search" | "listing" | "renewal" | "advisory";

export const PROJECT_TYPE_FAMILY: Record<ProjectTypeCode, EngagementFamily> = {
  TR: "search",
  BR: "search",
  CL: "listing",
  CS: "listing",
  L: "listing",
  SL: "listing",
  LRT: "renewal",
  LRLL: "renewal",
  BOV: "advisory",
};

/** Split a stored project_type ("TR", "BR/L", " tr / br ") into its codes. */
export function splitProjectType(projectType: string | null | undefined): string[] {
  return String(projectType ?? "")
    .split("/")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}

/**
 * Does this engagement belong in the deal pipeline (totals, expected value,
 * probability by phase, the first-open setup card, and any win rate)?
 *
 * Advisory work (BOV) doesn't: there's no transaction, so there's nothing to
 * win or lose, no phase to put a probability on, and a $0 flat fee would only
 * pad the deal counts. A compound type counts as pipeline if any of its codes
 * is a transaction code ("BR/BOV" stays in). An empty or unrecognized type
 * stays in too, so nothing silently drops off the pipeline over a typo.
 */
export function isPipelineType(projectType: string | null | undefined): boolean {
  const codes = splitProjectType(projectType);
  if (!codes.length) return true;
  return codes.some((c) => {
    const family = PROJECT_TYPE_FAMILY[c as ProjectTypeCode];
    return family === undefined || family !== "advisory";
  });
}
