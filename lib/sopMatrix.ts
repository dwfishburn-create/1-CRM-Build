// Static snapshot of Section 4 ("Which Companion SOPs Apply, By Type") from
// /1-SOPs & Templates/New_Project_Setup_and_Categorization_-_SOP.md.
//
// Added 9/1/2026 to back the get_sop_checklist MCP tool — see
// CRM_Requirements_and_Decisions_Log.md, "Project type taxonomy /
// companion-SOP checklist" entry, for the design decisions behind this:
//   - Static copy in code, not a live Dropbox fetch (simpler, no new
//     infra — but it WILL drift when the SOP doc changes; SOURCE_DATE
//     below is the tell for how stale this copy might be).
//   - MCP tool only, no CRM web UI surface for this data.
//
// Keeping this in sync with the SOP doc is the other open CRM item
// ("keeping existing deals' Claude Projects in sync as SOPs evolve") —
// when that gets solved, this file's update step should fold into it
// rather than staying a separate manual chore.

export const SOP_MATRIX_SOURCE_DATE = "2026-08-26"; // SOP doc's own "Last updated" when this was copied

export type SopStatus = "Load" | "Adapt" | "Gap" | "N/A";

export interface SopMatrixRow {
  sop: string;
  statuses: Partial<Record<ProjectTypeCode, { status: SopStatus; note?: string }>>;
}

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

export const SOP_MATRIX: SopMatrixRow[] = [
  {
    sop: "Client Property Survey Map SOP",
    statuses: {
      TR: { status: "Load" },
      BR: { status: "Load" },
      CL: { status: "Adapt", note: "comps, not candidates" },
      CS: { status: "Adapt", note: "comps, not candidates" },
      L: { status: "Adapt", note: "comps, not candidates" },
      LRT: { status: "Adapt", note: "renewal comps" },
      LRLL: { status: "Adapt", note: "renewal comps" },
      SL: { status: "Adapt", note: "comps, not candidates" },
    },
  },
  {
    sop: "Client Transaction Documents SOP",
    statuses: {
      TR: { status: "Load" },
      BR: { status: "Load" },
      CL: { status: "Load", note: "Stage 3 only — see Listing SOP, Section 6" },
      CS: { status: "Load", note: "Stage 3 only" },
      L: { status: "Load", note: "Stage 3 only" },
      LRT: { status: "Adapt", note: "amendment, not full LOI/Lease" },
      LRLL: { status: "Adapt", note: "amendment, not full LOI/Lease" },
      SL: {
        status: "Adapt",
        note: "sublease agreement + prime landlord consent, not a direct lease",
      },
    },
  },
  {
    sop: "Client Commercial Listing Engagements SOP (CL, CS, L)",
    statuses: {
      TR: { status: "N/A" },
      BR: { status: "N/A" },
      CL: { status: "Load" },
      CS: { status: "Load" },
      L: { status: "Load" },
      LRT: { status: "N/A" },
      LRLL: { status: "N/A" },
      SL: {
        status: "Adapt",
        note: "client is sublandlord/tenant, not fee owner; add master lease/prime landlord consent step",
      },
    },
  },
  {
    sop: "Client Lease Review SOP (Tenant Representation)",
    statuses: {
      TR: { status: "Load" },
      BR: { status: "N/A" },
      CL: { status: "N/A" },
      CS: { status: "N/A" },
      L: { status: "N/A" },
      LRT: { status: "Adapt" },
      LRLL: { status: "N/A" },
      SL: { status: "N/A" },
    },
  },
  {
    sop: "Client Deal Timeline SOP (Tenant Representation)",
    statuses: {
      TR: { status: "Load" },
      BR: { status: "Gap" },
      CL: { status: "Gap" },
      CS: { status: "Gap" },
      L: { status: "Gap" },
      LRT: { status: "Gap" },
      LRLL: { status: "Gap" },
      SL: { status: "Gap" },
    },
  },
];

/**
 * Companion-SOP checklist for one or more engagement-type codes.
 *
 * Accepts a single code ("TR") or a compound/undecided value as stored on
 * a live project ("TR/BR") — splits on "/", trims, uppercases, and unions
 * the rows for every recognized code found. Unrecognized codes are
 * reported back rather than silently dropped, since that usually means
 * either a typo or a genuinely new engagement type (see the SOP's Section
 * 1 instruction to stop and flag it rather than forcing a fit).
 */
export function getSopChecklist(projectType: string) {
  const requested = projectType
    .split("/")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

  const recognized = requested.filter((c): c is ProjectTypeCode =>
    (PROJECT_TYPE_CODES as readonly string[]).includes(c)
  );
  const unrecognized = requested.filter((c) => !recognized.includes(c as ProjectTypeCode));

  const checklist = SOP_MATRIX.map((row) => ({
    sop: row.sop,
    by_type: Object.fromEntries(
      recognized.map((code) => [code, row.statuses[code] ?? { status: "N/A" as const }])
    ),
  }));

  return {
    project_type: projectType,
    codes: recognized,
    unrecognized_codes: unrecognized.length ? unrecognized : undefined,
    source: "New_Project_Setup_and_Categorization_-_SOP.md, Section 4",
    source_last_synced: SOP_MATRIX_SOURCE_DATE,
    note:
      "Static snapshot, not a live fetch — if the SOP doc's own \"Last updated\" date is newer " +
      "than source_last_synced above, re-check Section 4 before relying on this.",
    checklist,
  };
}
