import {
  RetailBrandError,
  parseChoice,
  parseChoiceArray,
  parseDate,
  type Choice,
} from "./retailBrands";

// Requirement matching criteria (11/14/2026, migration 037 — Phase 4 of
// Retail Listing Intake & Matching). The closed lists mirror the CHECK
// constraints in 037 exactly; used by POST/PATCH /api/agent/requirements and
// the web forms under app/requirements, so the field handling lives in one
// place (the 8/26 silent-field-drop lesson).

export const SIDES: Choice[] = [
  { value: "tenant", label: "Tenant" },
  { value: "buyer", label: "Buyer (owner-user)" },
  { value: "investor", label: "Investor" },
  { value: "developer", label: "Developer" },
];

export const ASSET_CLASSES: Choice[] = [
  { value: "retail", label: "Retail" },
  { value: "land", label: "Land / pad" },
  { value: "industrial", label: "Industrial" },
  { value: "flex", label: "Flex" },
  { value: "office", label: "Office" },
  { value: "multifamily", label: "Multifamily" },
  { value: "hospitality", label: "Hospitality" },
  { value: "mixed_use", label: "Mixed use" },
  { value: "special_purpose", label: "Special purpose" },
];

export const TENANCY_TYPES: Choice[] = [
  { value: "single_tenant_nnn", label: "Single-tenant NNN" },
  { value: "multi_tenant", label: "Multi-tenant" },
  { value: "vacant", label: "Vacant" },
  { value: "value_add", label: "Value-add" },
  { value: "owner_user", label: "Owner-user" },
  { value: "ground_lease", label: "Ground lease" },
];

/** Highest first — rank is used for the credit floor comparison. */
export const CREDIT_LEVELS: Choice[] = [
  { value: "investment_grade", label: "Investment grade" },
  { value: "national", label: "National" },
  { value: "regional", label: "Regional" },
  { value: "local", label: "Local" },
];

export const CRITERIA_FIELDS = [
  "sides",
  "asset_classes",
  "acres_min",
  "acres_max",
  "cap_rate_min",
  "tenancy_types",
  "credit_floor",
  "min_term_years",
  "exchange_1031",
  "exchange_identify_by",
  "exchange_close_by",
] as const;

function parseNum(field: string, raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).replace(/[$,%\s]/g, "");
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) throw new RetailBrandError(`${field} must be a number (got "${String(raw)}").`);
  return n;
}

function parseBool(raw: unknown): boolean {
  if (typeof raw === "boolean") return raw;
  return /^(true|yes|on|1)$/i.test(String(raw ?? "").trim());
}

/**
 * Validate whichever criteria fields are present in `input` (PATCH semantics:
 * absent fields are not in the result). "" clears a field.
 */
export function parseCriteriaFields(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const has = (k: string) => k in input && input[k] !== undefined;
  if (has("sides")) out.sides = parseChoiceArray(SIDES, "sides", input.sides);
  if (has("asset_classes")) out.asset_classes = parseChoiceArray(ASSET_CLASSES, "asset_classes", input.asset_classes);
  if (has("tenancy_types")) out.tenancy_types = parseChoiceArray(TENANCY_TYPES, "tenancy_types", input.tenancy_types);
  if (has("credit_floor")) out.credit_floor = parseChoice(CREDIT_LEVELS, "credit_floor", input.credit_floor);
  for (const k of ["acres_min", "acres_max", "cap_rate_min", "min_term_years"] as const) {
    if (has(k)) out[k] = parseNum(k, input[k]);
  }
  if (has("exchange_1031")) out.exchange_1031 = parseBool(input.exchange_1031);
  if (has("exchange_identify_by")) out.exchange_identify_by = parseDate("exchange_identify_by", input.exchange_identify_by);
  if (has("exchange_close_by")) out.exchange_close_by = parseDate("exchange_close_by", input.exchange_close_by);
  if (out.cap_rate_min !== undefined && out.cap_rate_min !== null) {
    const c = out.cap_rate_min as number;
    // 0.065 almost certainly meant 6.5%.
    if (c > 0 && c < 1) out.cap_rate_min = Math.round(c * 10000) / 100;
  }
  return out;
}

/** The criteria fields as the web forms post them (checkbox groups via getAll). */
export function criteriaFromForm(fd: FormData): Record<string, unknown> {
  const s = (k: string) => String(fd.get(k) ?? "");
  return parseCriteriaFields({
    sides: fd.getAll("sides").map(String),
    asset_classes: fd.getAll("asset_classes").map(String),
    tenancy_types: fd.getAll("tenancy_types").map(String),
    credit_floor: s("credit_floor"),
    acres_min: s("acres_min"),
    acres_max: s("acres_max"),
    cap_rate_min: s("cap_rate_min"),
    min_term_years: s("min_term_years"),
    exchange_1031: fd.get("exchange_1031") === "on",
    exchange_identify_by: s("exchange_identify_by"),
    exchange_close_by: s("exchange_close_by"),
  });
}

export function labelOf(list: Choice[], value: string | null | undefined): string {
  if (!value) return "";
  return list.find((c) => c.value === value)?.label ?? value;
}
