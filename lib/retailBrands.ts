import { supabase } from "./supabase";
import { todayCentral } from "./centralDate";
import { DEFAULT_LIMIT, MAX_LIMIT } from "./listQuery";
import type { Provenance } from "./provenance";

// Retail Tenant Directory — the shared brand logic (10/13/2026, build step 1
// of 2; schema in db/026_retail_tenant_directory.sql).
//
// One file for the closed lists, the payload validation and the reads/writes,
// used by BOTH /api/agent/retail-brands (and through it the MCP connector) and
// the web server actions on /entities/[id] and /directory. The 8/26 and 8/27
// silent-field-drop bugs came from two copies of one table's field handling
// drifting apart; this is the one copy.
//
// The closed lists below mirror the CHECK constraints in 026 exactly (the
// 9/16/2026 vocabulary test: naturally closed vocabularies are constrained).
// A value outside them is refused here with a message naming the allowed
// values, rather than reaching Postgres and coming back as a bare
// "violates check constraint". Categories are data (retail_categories), so
// they are checked against the table, not a constant.

export type Choice = { value: string; label: string; short?: string };

export const TARGET_MARKETS: Choice[] = [
  { value: "omaha_metro", label: "Omaha Metro", short: "Omaha" },
  { value: "lincoln", label: "Lincoln", short: "Lincoln" },
  { value: "greater_nebraska", label: "Greater Nebraska", short: "Gr. NE" },
  { value: "cb_western_iowa", label: "Council Bluffs / Western Iowa", short: "CB / W. IA" },
];

export const FACILITY_TYPES: Choice[] = [
  { value: "free_standing", label: "Free-standing", short: "Free-std" },
  { value: "end_cap", label: "End cap", short: "End cap" },
  { value: "neighborhood_strip", label: "Neighborhood strip", short: "Nbhd strip" },
  { value: "regional_strip", label: "Regional strip", short: "Reg. strip" },
  { value: "power_center", label: "Power center", short: "Power" },
  { value: "lifestyle_center", label: "Lifestyle center", short: "Lifestyle" },
  { value: "regional_mall", label: "Regional mall", short: "Mall" },
  { value: "outlet_mall", label: "Outlet mall", short: "Outlet" },
  { value: "downtown", label: "Downtown", short: "Downtown" },
  { value: "kiosk", label: "Kiosk", short: "Kiosk" },
];

export const DRIVE_THRU: Choice[] = [
  { value: "required", label: "Required" },
  { value: "preferred", label: "Preferred" },
  { value: "no", label: "No" },
];

export const OPERATING_MODELS: Choice[] = [
  { value: "corporate", label: "Corporate" },
  { value: "franchise", label: "Franchise" },
  { value: "both", label: "Both" },
];

export const EXPANSION_STATUSES: Choice[] = [
  { value: "expanding", label: "Expanding" },
  { value: "selective", label: "Selective" },
  { value: "not_expanding", label: "Not expanding" },
  { value: "contracting", label: "Contracting" },
  { value: "unknown", label: "Unknown" },
];

/** Suggested roles for a brand contact. A UI hint only — the role stays free text. */
export const BRAND_CONTACT_ROLES = [
  "Real Estate Director",
  "Real Estate Manager",
  "Franchise Development",
  "Franchisee",
  "Tenant Rep Broker",
  "Other",
];

export function choiceLabel(list: Choice[], value: string | null | undefined, short = false): string {
  if (!value) return "—";
  const c = list.find((x) => x.value === value);
  if (!c) return value;
  return short ? c.short ?? c.label : c.label;
}

/** An error that carries the HTTP status the Agent API should answer with. */
export class RetailBrandError extends Error {
  status: number;
  body?: Record<string, unknown>;
  constructor(message: string, status = 400, body?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

// ---------------------------------------------------------------------------
// Value parsing — shared with lib/requirementReconfirm.ts
// ---------------------------------------------------------------------------

function allowed(list: Choice[]): string {
  return list.map((c) => c.value).join(", ");
}

/** Match a code or its full display label, case-insensitively. Short labels
 *  are display-only — "Mall" would be ambiguous (regional or outlet). */
function matchChoice(list: Choice[], raw: string): string | null {
  const s = raw.trim().toLowerCase();
  const hit = list.find((c) => c.value === s || c.label.toLowerCase() === s);
  return hit ? hit.value : null;
}

/** A closed-list single value. "" / null clears to null. */
export function parseChoice(list: Choice[], field: string, raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const v = matchChoice(list, s);
  if (!v) throw new RetailBrandError(`${field} must be one of: ${allowed(list)} (got "${s}").`);
  return v;
}

/**
 * A closed-list array. Accepts an array or a comma-separated string; codes or
 * display labels. "" / null / [] clears to an empty array (the columns are
 * NOT NULL DEFAULT '{}'). Duplicates are dropped.
 */
export function parseChoiceArray(list: Choice[], field: string, raw: unknown): string[] {
  if (raw === null || raw === undefined) return [];
  // A comma-separated string is split; a label containing "/" (Council Bluffs
  // / Western Iowa) has no comma in it, so it survives the split.
  const items = Array.isArray(raw) ? raw.map((x) => String(x ?? "")) : String(raw).split(",");
  const out: string[] = [];
  const bad: string[] = [];
  for (const item of items) {
    const s = item.trim();
    if (!s) continue;
    const v = matchChoice(list, s);
    if (v) {
      if (!out.includes(v)) out.push(v);
    } else {
      bad.push(s);
    }
  }
  if (bad.length) {
    throw new RetailBrandError(
      `${field}: unknown value(s) ${bad.map((b) => `"${b}"`).join(", ")}. Allowed: ${allowed(list)}.`
    );
  }
  return out;
}

/** A number. "" / null clears to null; anything non-numeric is refused. */
export function parseNumber(field: string, raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) throw new RetailBrandError(`${field} must be a number.`);
    return raw;
  }
  const s = String(raw).replace(/[,\s]/g, "");
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) throw new RetailBrandError(`${field} must be a number (got "${String(raw)}").`);
  if (n < 0) throw new RetailBrandError(`${field} cannot be negative.`);
  return n;
}

/** A YYYY-MM-DD date. "" / null clears to null. */
export function parseDate(field: string, raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(`${s}T12:00:00Z`))) {
    throw new RetailBrandError(`${field} must be a date as YYYY-MM-DD (got "${s}").`);
  }
  return s;
}

function parseText(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  return String(raw).trim() || null;
}

function parseBool(field: string, raw: unknown): boolean {
  if (typeof raw === "boolean") return raw;
  const s = String(raw ?? "").trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(s)) return true;
  if (["false", "0", "no", "off", ""].includes(s)) return false;
  throw new RetailBrandError(`${field} must be true or false.`);
}

// ---------------------------------------------------------------------------
// Brand payload
// ---------------------------------------------------------------------------

export const BRAND_FIELDS = [
  "category",
  "category_detail",
  "size_min_sf",
  "size_max_sf",
  "frontage_min_ft",
  "drive_thru",
  "facility_types",
  "site_criteria",
  "operating_model",
  "expansion_status",
  "target_markets",
  "needs_verification",
  "last_verified_on",
  "verification_note",
  "notes",
] as const;

export type BrandField = (typeof BRAND_FIELDS)[number];
export type BrandPatch = Partial<Record<BrandField, unknown>>;

/**
 * Validate and normalize whichever brand fields are present in `input`.
 * Fields not present are not in the result — PATCH semantics. Throws
 * RetailBrandError (400) naming the field and the allowed values.
 */
export async function normalizeBrandFields(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  const has = (k: string) => k in input && input[k] !== undefined;

  if (has("category")) out.category = await resolveCategory(input.category);
  for (const k of ["category_detail", "site_criteria", "verification_note", "notes"] as const) {
    if (has(k)) out[k] = parseText(input[k]);
  }
  for (const k of ["size_min_sf", "size_max_sf", "frontage_min_ft"] as const) {
    if (has(k)) out[k] = parseNumber(k, input[k]);
  }
  if (has("drive_thru")) out.drive_thru = parseChoice(DRIVE_THRU, "drive_thru", input.drive_thru);
  if (has("operating_model")) {
    out.operating_model = parseChoice(OPERATING_MODELS, "operating_model", input.operating_model);
  }
  if (has("expansion_status")) {
    // NOT NULL in the table: clearing it means "unknown".
    out.expansion_status =
      parseChoice(EXPANSION_STATUSES, "expansion_status", input.expansion_status) ?? "unknown";
  }
  if (has("facility_types")) {
    out.facility_types = parseChoiceArray(FACILITY_TYPES, "facility_types", input.facility_types);
  }
  if (has("target_markets")) {
    out.target_markets = parseChoiceArray(TARGET_MARKETS, "target_markets", input.target_markets);
  }
  if (has("needs_verification")) {
    out.needs_verification = parseBool("needs_verification", input.needs_verification);
  }
  if (has("last_verified_on")) out.last_verified_on = parseDate("last_verified_on", input.last_verified_on);

  const min = out.size_min_sf;
  const max = out.size_max_sf;
  if (typeof min === "number" && typeof max === "number" && min > max) {
    throw new RetailBrandError(`size_min_sf (${min}) is larger than size_max_sf (${max}).`);
  }
  return out;
}

/** Category by code or by its label; "" clears. Checked against retail_categories. */
async function resolveCategory(raw: unknown): Promise<string | null> {
  const s = parseText(raw);
  if (!s) return null;
  const cats = await listCategories(true);
  const lower = s.toLowerCase();
  const hit = cats.find((c) => c.code === lower || c.label.toLowerCase() === lower);
  if (!hit) {
    throw new RetailBrandError(
      `category "${s}" is not in retail_categories. Use one of: ${cats.map((c) => c.code).join(", ")}.`
    );
  }
  return hit.code;
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export type RetailCategory = { code: string; label: string; sort_order: number; active: boolean };

export async function listCategories(includeInactive = false): Promise<RetailCategory[]> {
  let q = supabase
    .from("retail_categories")
    .select("code, label, sort_order, active")
    .order("sort_order", { ascending: true })
    .order("label", { ascending: true });
  if (!includeInactive) q = q.eq("active", true);
  const { data, error } = await q.returns<RetailCategory[]>();
  if (error) throw new RetailBrandError(error.message, 500);
  return data ?? [];
}

// ---------------------------------------------------------------------------
// Create / update / verify
// ---------------------------------------------------------------------------

export type BrandRef = { id?: string | null; entity_id?: string | null };

async function findBrand(ref: BrandRef): Promise<{ id: string; entity_id: string } | null> {
  const id = String(ref.id ?? "").trim();
  const entityId = String(ref.entity_id ?? "").trim();
  if (!id && !entityId) throw new RetailBrandError("id (the brand profile id) or entity_id is required.");
  let q = supabase.from("retail_brands").select("id, entity_id");
  q = id ? q.eq("id", id) : q.eq("entity_id", entityId);
  const { data, error } = await q.maybeSingle();
  if (error) throw new RetailBrandError(error.message, 500);
  return data as { id: string; entity_id: string } | null;
}

/** The constraint messages a user can cause, translated. */
function dbError(message: string): RetailBrandError {
  if (/retail_brands_size_check/.test(message)) {
    return new RetailBrandError("size_min_sf is larger than size_max_sf.");
  }
  if (/retail_brands_entity_id_key/.test(message)) {
    return new RetailBrandError("This entity already has a brand profile.", 409);
  }
  return new RetailBrandError(message, 500);
}

/**
 * Put an entity in the directory. Refuses (409) if it already has a profile —
 * there is exactly one per entity; edit that one with updateBrand.
 */
export async function createBrand(
  entityId: string,
  input: Record<string, unknown>,
  prov: Provenance = {}
): Promise<Record<string, unknown>> {
  const entity_id = String(entityId ?? "").trim();
  if (!entity_id) throw new RetailBrandError("entity_id is required.");

  const { data: entity, error: entErr } = await supabase
    .from("entities")
    .select("id, name")
    .eq("id", entity_id)
    .maybeSingle();
  if (entErr) throw new RetailBrandError(entErr.message, 500);
  if (!entity) throw new RetailBrandError(`No entity with id ${entity_id}.`, 404);

  const existing = await findBrand({ entity_id });
  if (existing) {
    throw new RetailBrandError(
      `${entity.name} already has a brand profile (id ${existing.id}). Update it instead of creating a second one.`,
      409,
      { existing_brand_id: existing.id }
    );
  }

  const fields = await normalizeBrandFields(input);
  const { data, error } = await supabase
    .from("retail_brands")
    .insert({ ...prov, ...fields, entity_id })
    .select()
    .single();
  if (error) throw dbError(error.message);
  return data;
}

/**
 * PATCH a brand profile by its id or its entity_id. Only fields present in
 * `input` change; "" clears a field (an array field to empty, expansion_status
 * to unknown). At least one field is required.
 */
export async function updateBrand(ref: BrandRef, input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const fields = await normalizeBrandFields(input);
  if (Object.keys(fields).length === 0) {
    throw new RetailBrandError(`Provide at least one field to update: ${BRAND_FIELDS.join(", ")}.`);
  }
  const brand = await findBrand(ref);
  if (!brand) throw new RetailBrandError("No brand profile found for that id / entity_id.", 404);

  const { data, error } = await supabase
    .from("retail_brands")
    .update(fields)
    .eq("id", brand.id)
    .select()
    .single();
  if (error) throw dbError(error.message);
  return data;
}

/**
 * Dan has confirmed the profile is right: clears the unverified flag and
 * stamps today (Central). A note, if given, replaces verification_note; with
 * no note the old one is left as it was.
 */
export async function markVerified(ref: BrandRef | string, note?: string | null): Promise<Record<string, unknown>> {
  const brand = await findBrand(typeof ref === "string" ? { id: ref } : ref);
  if (!brand) throw new RetailBrandError("No brand profile found for that id / entity_id.", 404);
  const update: Record<string, unknown> = {
    needs_verification: false,
    last_verified_on: todayCentral(),
  };
  const n = parseText(note);
  if (n) update.verification_note = n;
  const { data, error } = await supabase
    .from("retail_brands")
    .update(update)
    .eq("id", brand.id)
    .select()
    .single();
  if (error) throw dbError(error.message);
  return data;
}

// ---------------------------------------------------------------------------
// List (reads view retail_brand_directory)
// ---------------------------------------------------------------------------

export type BrandFilters = {
  q?: string | null;
  category?: string | null;
  market?: string | null;
  expansion_status?: string | null;
  fits_sf?: number | string | null;
  needs_verification?: boolean | string | null;
  limit?: number | string | null;
  offset?: number | string | null;
};

export type DirectoryRow = {
  brand_id: string;
  entity_id: string;
  display_code: string | null;
  name: string;
  trade_name: string | null;
  website: string | null;
  category: string | null;
  category_label: string | null;
  category_detail: string | null;
  size_min_sf: number | null;
  size_max_sf: number | null;
  frontage_min_ft: number | null;
  drive_thru: string | null;
  facility_types: string[];
  site_criteria: string | null;
  operating_model: string | null;
  expansion_status: string;
  target_markets: string[];
  needs_verification: boolean;
  last_verified_on: string | null;
  notes: string | null;
  source_system: string | null;
  source_batch_id: string | null;
  updated_at: string;
  current_contacts: number;
  metro_locations: number;
  active_requirements: number;
  next_reconfirm: string | null;
};

export type BrandList = {
  brands: DirectoryRow[];
  count: number;
  limit: number;
  offset: number;
  has_more: boolean;
};

/**
 * The directory, filtered. fits_sf keeps a brand whose size range contains
 * the number, treating a missing bound as open (a brand with only a minimum
 * of 2,000 fits 3,500; a brand with no size at all fits anything — it is
 * unknown, not excluded). market is "target_markets contains". Sorted by name.
 */
export async function listBrands(filters: BrandFilters = {}): Promise<BrandList> {
  const lim = Number(filters.limit);
  const limit = Number.isFinite(lim) && lim > 0 ? Math.min(Math.floor(lim), MAX_LIMIT) : DEFAULT_LIMIT;
  const off = Number(filters.offset);
  const offset = Number.isFinite(off) && off > 0 ? Math.floor(off) : 0;

  let query = supabase
    .from("retail_brand_directory")
    .select("*", { count: "exact" })
    .order("name", { ascending: true })
    .order("brand_id", { ascending: true })
    .range(offset, offset + limit - 1);

  // PostgREST ANDs separate filters, but two .or() calls would be two `or`
  // params; the groups are combined into one and(...) tree instead.
  const orGroups: string[] = [];

  // The pattern is double-quoted so commas, periods and parentheses in a name
  // ("Dunkin', Inc.") are literal inside the or=() list; the quote and
  // backslash themselves, and the wildcards, are dropped from the search text.
  const q = String(filters.q ?? "").replace(/[*%\\"]/g, " ").replace(/\s+/g, " ").trim();
  if (q) orGroups.push(`or(name.ilike."%${q}%",trade_name.ilike."%${q}%")`);

  if (filters.fits_sf !== undefined && filters.fits_sf !== null && String(filters.fits_sf).trim() !== "") {
    const x = parseNumber("fits_sf", filters.fits_sf);
    if (x !== null) {
      orGroups.push(`or(size_min_sf.is.null,size_min_sf.lte.${x})`);
      orGroups.push(`or(size_max_sf.is.null,size_max_sf.gte.${x})`);
    }
  }
  if (orGroups.length) query = query.or(`and(${orGroups.join(",")})`);

  const category = String(filters.category ?? "").trim();
  if (category) query = query.eq("category", category);

  const market = parseChoice(TARGET_MARKETS, "market", filters.market);
  if (market) query = query.contains("target_markets", [market]);

  const status = parseChoice(EXPANSION_STATUSES, "expansion_status", filters.expansion_status);
  if (status) query = query.eq("expansion_status", status);

  const nv = filters.needs_verification;
  if (nv !== undefined && nv !== null && String(nv).trim() !== "") {
    query = query.eq("needs_verification", parseBool("needs_verification", nv));
  }

  const { data, error, count } = await query.returns<DirectoryRow[]>();
  if (error) throw new RetailBrandError(error.message, 500);
  const rows = data ?? [];
  const total = count ?? rows.length;
  return { brands: rows, count: total, limit, offset, has_more: offset + rows.length < total };
}

/** "2,000–3,500 SF", "2,000+ SF", "up to 3,500 SF", or "—". */
export function sizeRange(min: number | null, max: number | null): string {
  const f = (n: number) => Math.round(n).toLocaleString("en-US");
  if (min == null && max == null) return "—";
  if (min != null && max != null) return min === max ? `${f(min)} SF` : `${f(min)}–${f(max)} SF`;
  if (min != null) return `${f(min)}+ SF`;
  return `up to ${f(max as number)} SF`;
}
