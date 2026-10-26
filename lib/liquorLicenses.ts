import { supabase } from "./supabase";
import type { ParsedRoster } from "./liquorRoster";

// Nebraska liquor licenses — the CRM side (10/26/2026, migration 032).
//
// One file for every read and write, used by /api/agent/liquor-licenses (and
// through it the MCP connector), the /liquor-licenses screens and the roster
// upload. The logic itself lives in the 032 SQL functions; this is the typed
// window onto them, so the web page, the Agent API and Claude cannot disagree
// about what a filter means.
//
// Supabase serves at most 1,000 rows per call, so anything that can be larger
// (exports, staging a roster) goes in 1,000-row pages.

export const SALE_TYPES = [
  { value: "on_premise", label: "On-premise (bar / restaurant)", short: "On-prem" },
  { value: "both", label: "On + off premise", short: "On + off" },
  { value: "off_premise", label: "Off-premise (c-store / grocery / liquor store)", short: "Off-prem" },
  { value: "maker", label: "Brewery / winery / distillery", short: "Maker" },
  { value: "wholesale", label: "Wholesale", short: "Wholesale" },
  { value: "other", label: "Other (party bus, bottle club …)", short: "Other" },
] as const;
export type SaleType = (typeof SALE_TYPES)[number]["value"];
const SALE_TYPE_VALUES = new Set<string>([...SALE_TYPES.map((s) => s.value), "shipper", "secondary"]);

export function saleTypeLabel(v: string | null | undefined, short = true): string {
  const s = SALE_TYPES.find((x) => x.value === v);
  return s ? (short ? s.short : s.label) : v ?? "";
}

export const CHANGE_TYPES = [
  { value: "new", label: "New license" },
  { value: "dropped", label: "Dropped (closed / not renewed)" },
  { value: "returned", label: "Back on the roster" },
  { value: "licensee", label: "New licensee (sale?)" },
  { value: "trade_name", label: "New trade name" },
  { value: "manager", label: "New manager" },
  { value: "class", label: "Class changed" },
  { value: "address", label: "Address changed" },
] as const;

/** 4025551234 → (402) 555-1234; anything else as given. */
export function fmtPhone(p: string | null | undefined): string {
  if (!p) return "";
  const d = p.replace(/\D/g, "");
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : p;
}

export class LiquorError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export type LicenseRow = {
  id: string;
  license_number: string;
  class: string | null;
  class_label: string | null;
  sale_type: string;
  secondary_licenses: string[];
  trade_name: string | null;
  premises_street: string | null;
  premises_city: string | null;
  premises_zip: string | null;
  county: string | null;
  phone: string | null;
  email: string | null;
  manager_name: string | null;
  licensee: string | null;
  corporate_address: string | null;
  issue_date: string | null;
  expiration_date: string | null;
  status: "active" | "dropped";
  first_seen_on: string | null;
  last_seen_on: string | null;
  dropped_on: string | null;
  brand_entity_id: string | null;
  brand_name: string | null;
  brand_code: string | null;
  brand_link_source: "auto" | "dan" | null;
  licensee_entity_id: string | null;
  licensee_entity_name: string | null;
  licensee_entity_code: string | null;
  licensee_link_source: "auto" | "dan" | null;
  property_id: string | null;
  property_code: string | null;
  property_address: string | null;
  contact_id: string | null;
  notes: string | null;
  operator_licenses: number;
  total_count: number;
};

export type LicenseFilters = {
  q?: string | null;
  city?: string | null;
  county?: string | null;
  sale_types?: string[] | string | null;
  status?: string | null;
  min_operator?: number | string | null;
  new_since?: string | null;
  dropped_since?: string | null;
  entity_id?: string | null;
  property_id?: string | null;
  brand?: string | null;
  sort?: string | null;
  limit?: number | string | null;
  offset?: number | string | null;
};

function clean(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function int(v: unknown, label: string, min = 0, max = Number.MAX_SAFE_INTEGER): number | null {
  const s = clean(v);
  if (s === null) return null;
  const n = Number(s);
  if (!Number.isInteger(n) || n < min || n > max) throw new LiquorError(`${label} must be a whole number from ${min} to ${max}.`);
  return n;
}

function isoDate(v: unknown, label: string): string | null {
  const s = clean(v);
  if (s === null) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) throw new LiquorError(`${label} must be YYYY-MM-DD.`);
  return s;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function uuid(v: unknown, label: string): string | null {
  const s = clean(v);
  if (s === null) return null;
  if (!UUID.test(s)) throw new LiquorError(`${label} must be a record id (uuid).`);
  return s;
}

export function saleTypes(v: unknown): string[] | null {
  const list = (Array.isArray(v) ? v : String(v ?? "").split(","))
    .map((x) => String(x).trim())
    .filter(Boolean);
  if (!list.length) return null;
  const bad = list.filter((x) => !SALE_TYPE_VALUES.has(x));
  if (bad.length) {
    throw new LiquorError(`Unknown sale type(s): ${bad.join(", ")}. Use: ${SALE_TYPES.map((s) => s.value).join(", ")}.`);
  }
  return list;
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], label: string, dflt: T): T {
  const s = clean(v);
  if (s === null) return dflt;
  if (!(allowed as readonly string[]).includes(s)) throw new LiquorError(`${label} must be one of ${allowed.join(", ")}.`);
  return s as T;
}

function searchArgs(f: LicenseFilters, limit: number, offset: number) {
  return {
    p_q: clean(f.q),
    p_city: clean(f.city),
    p_county: clean(f.county),
    p_sale_types: saleTypes(f.sale_types),
    p_status: oneOf(f.status, ["active", "dropped", "all"] as const, "status", "active"),
    p_min_operator: int(f.min_operator, "min_operator", 1, 1000),
    p_new_since: isoDate(f.new_since, "new_since"),
    p_dropped_since: isoDate(f.dropped_since, "dropped_since"),
    p_entity_id: uuid(f.entity_id, "entity_id"),
    p_property_id: uuid(f.property_id, "property_id"),
    p_brand: oneOf(f.brand, ["any", "linked", "unlinked"] as const, "brand", "any"),
    p_sort: oneOf(f.sort, ["name", "operator", "newest", "city"] as const, "sort", "name"),
    p_limit: limit,
    p_offset: offset,
  };
}

export async function searchLicenses(f: LicenseFilters, defaultLimit = 50) {
  const limit = int(f.limit, "limit", 1, 1000) ?? defaultLimit;
  const offset = int(f.offset, "offset") ?? 0;
  const { data, error } = await supabase.rpc("liquor_search", searchArgs(f, limit, offset));
  if (error) throw new LiquorError(error.message, 500);
  const rows = (data ?? []) as LicenseRow[];
  const count = rows.length ? Number(rows[0].total_count) : 0;
  return { licenses: rows, count, limit, offset, has_more: offset + rows.length < count };
}

/** Every matching license, paged 1,000 at a time (for exports), capped at max. */
export async function searchAllLicenses(f: LicenseFilters, max = 10000): Promise<LicenseRow[]> {
  const out: LicenseRow[] = [];
  for (let offset = 0; offset < max; offset += 1000) {
    const { data, error } = await supabase.rpc("liquor_search", searchArgs(f, Math.min(1000, max - offset), offset));
    if (error) throw new LiquorError(error.message, 500);
    const rows = (data ?? []) as LicenseRow[];
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

export type OperatorRow = {
  operator_key: string;
  licensee: string;
  licensee_entity_id: string | null;
  licensee_entity_name: string | null;
  licensee_entity_code: string | null;
  license_count: number;
  in_area_count: number;
  cities: string | null;
  trade_names: string | null;
  brand_names: string | null;
  sample_email: string | null;
  sample_phone: string | null;
  corporate_address: string | null;
  total_count: number;
};

export type OperatorFilters = {
  min_licenses?: number | string | null;
  county?: string | null;
  city?: string | null;
  sale_types?: string[] | string | null;
  q?: string | null;
  limit?: number | string | null;
  offset?: number | string | null;
};

export async function listOperators(f: OperatorFilters, defaultLimit = 100) {
  // limit max 1000 = one Supabase page; exports page with offset.
  const limit = int(f.limit, "limit", 1, 1000) ?? defaultLimit;
  const offset = int(f.offset, "offset") ?? 0;
  const { data, error } = await supabase.rpc("liquor_operators", {
    p_min_licenses: int(f.min_licenses, "min_licenses", 1, 1000) ?? 2,
    p_county: clean(f.county),
    p_city: clean(f.city),
    p_sale_types: saleTypes(f.sale_types),
    p_q: clean(f.q),
    p_limit: limit,
    p_offset: offset,
  });
  if (error) throw new LiquorError(error.message, 500);
  const rows = (data ?? []) as OperatorRow[];
  const count = rows.length ? Number(rows[0].total_count) : 0;
  return { operators: rows, count, limit, offset, has_more: offset + rows.length < count };
}

export type ChangeRow = {
  change_id: string;
  snapshot_date: string;
  change_type: string;
  old_value: string | null;
  new_value: string | null;
  license_number: string;
  trade_name: string | null;
  premises_street: string | null;
  premises_city: string | null;
  county: string | null;
  sale_type: string;
  licensee: string | null;
  manager_name: string | null;
  phone: string | null;
  email: string | null;
  status: string;
  brand_entity_id: string | null;
  licensee_entity_id: string | null;
  property_id: string | null;
  total_count: number;
};

export async function listChanges(f: {
  since?: string | null; types?: string[] | string | null; county?: string | null; city?: string | null;
  sale_types?: string[] | string | null; limit?: number | string | null; offset?: number | string | null;
}) {
  const types = (Array.isArray(f.types) ? f.types : String(f.types ?? "").split(","))
    .map((x) => String(x).trim()).filter(Boolean);
  const known = new Set<string>(CHANGE_TYPES.map((c) => c.value));
  const bad = types.filter((t) => !known.has(t));
  if (bad.length) throw new LiquorError(`Unknown change type(s): ${bad.join(", ")}. Use: ${[...known].join(", ")}.`);
  const limit = int(f.limit, "limit", 1, 1000) ?? 100;
  const offset = int(f.offset, "offset") ?? 0;
  const { data, error } = await supabase.rpc("liquor_changes", {
    p_since: isoDate(f.since, "since"),
    p_types: types.length ? types : null,
    p_county: clean(f.county),
    p_city: clean(f.city),
    p_sale_types: saleTypes(f.sale_types),
    p_limit: limit,
    p_offset: offset,
  });
  if (error) throw new LiquorError(error.message, 500);
  const rows = (data ?? []) as ChangeRow[];
  const count = rows.length ? Number(rows[0].total_count) : 0;
  return { changes: rows, count, limit, offset, has_more: offset + rows.length < count };
}

export type SnapshotInfo = {
  batch_id: string; snapshot_date: string; source_file: string | null; imported_at: string | null;
  baseline: boolean; rows: number; new: number | null; dropped: number | null; returned: number | null; changed: number | null;
};
export type LiquorMeta = {
  latest_snapshot_date: string | null;
  active: number; dropped: number; with_brand: number; with_licensee_company: number; with_property: number;
  snapshots: SnapshotInfo[];
  counties: string[];
  classes: { code: string; label: string; sale_type: string }[];
};

export async function liquorMeta(): Promise<LiquorMeta> {
  const { data, error } = await supabase.rpc("liquor_meta");
  if (error) throw new LiquorError(error.message, 500);
  return data as LiquorMeta;
}

/** One license by number, with its change history across roster pulls. */
export async function getLicense(licenseNumber: string) {
  const num = clean(licenseNumber);
  if (!num) throw new LiquorError("license_number is required.");
  const { data, error } = await supabase
    .from("liquor_licenses")
    .select(
      "*, brand:entities!liquor_licenses_brand_entity_id_fkey(id, display_code, name, trade_name)," +
        " licensee_entity:entities!liquor_licenses_licensee_entity_id_fkey(id, display_code, name)," +
        " property:properties(id, display_code, address, city)," +
        " contact:contacts(id, display_code, first_name, last_name, email, phone)"
    )
    .eq("license_number", num)
    .maybeSingle();
  if (error) throw new LiquorError(error.message, 500);
  if (!data) throw new LiquorError(`No liquor license ${num}.`, 404);
  const lic = data as unknown as Record<string, unknown> & { id: string };
  const { data: changes, error: e2 } = await supabase
    .from("liquor_license_changes")
    .select("id, change_type, old_value, new_value, snapshot:liquor_license_snapshots(snapshot_date, batch_id)")
    .eq("license_id", lic.id)
    .order("created_at", { ascending: false });
  if (e2) throw new LiquorError(e2.message, 500);
  return { license: lic, changes: changes ?? [] };
}

export async function linkLicense(body: Record<string, unknown>) {
  const num = clean(body.license_number);
  if (!num) throw new LiquorError("license_number is required.");
  const clear = (Array.isArray(body.clear) ? body.clear : clean(body.clear)?.split(",") ?? [])
    .map((x) => String(x).trim()).filter(Boolean);
  const okClear = new Set(["brand", "licensee", "property", "contact"]);
  const badClear = clear.filter((c) => !okClear.has(c));
  if (badClear.length) throw new LiquorError(`clear accepts: brand, licensee, property, contact (got ${badClear.join(", ")}).`);
  const args = {
    p_license_number: num,
    p_brand_entity_id: uuid(body.brand_entity_id, "brand_entity_id"),
    p_licensee_entity_id: uuid(body.licensee_entity_id, "licensee_entity_id"),
    p_property_id: uuid(body.property_id, "property_id"),
    p_contact_id: uuid(body.contact_id, "contact_id"),
    p_notes: body.notes === undefined ? null : String(body.notes ?? ""),
    p_clear: clear,
  };
  if (!args.p_brand_entity_id && !args.p_licensee_entity_id && !args.p_property_id && !args.p_contact_id
      && args.p_notes === null && clear.length === 0) {
    throw new LiquorError("Nothing to change: give brand_entity_id, licensee_entity_id, property_id, contact_id, notes or clear.");
  }
  const { data, error } = await supabase.rpc("liquor_link_license", args);
  if (error) {
    const status = /No liquor license/.test(error.message) ? 404 : /brand profile/.test(error.message) ? 409 : 500;
    throw new LiquorError(error.message, status);
  }
  return data as Record<string, unknown>;
}

export type BrandSuggestion = {
  brand_key: string; sample_trade_name: string; license_count: number; cities: string | null;
  entity_id: string; display_code: string; brand_name: string; score: number; reason: string; rank: number;
};

export async function brandSuggestions(minScore?: number | string | null, limit?: number | string | null) {
  const { data, error } = await supabase.rpc("liquor_brand_suggestions", {
    p_min_score: clean(minScore) === null ? 0.55 : Number(minScore),
    p_limit: int(limit, "limit", 1, 5000) ?? 1000,
  });
  if (error) throw new LiquorError(error.message, 500);
  return (data ?? []) as BrandSuggestion[];
}

export async function decideBrand(body: Record<string, unknown>) {
  const key = clean(body.brand_key);
  if (!key) throw new LiquorError("brand_key is required.");
  const decision = oneOf(body.decision, ["link", "not_a_match", "clear"] as const, "decision", "link");
  const entity = uuid(body.entity_id, "entity_id");
  if (decision === "link" && !entity) throw new LiquorError("decision 'link' needs entity_id (a directory brand).");
  const { data, error } = await supabase.rpc("liquor_decide_brand", {
    p_brand_key: key,
    p_entity_id: decision === "link" ? entity : null,
    p_note: clean(body.note),
    p_clear: decision === "clear",
  });
  if (error) throw new LiquorError(error.message, /brand profile/.test(error.message) ? 409 : 500);
  return data as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Roster import (the upload page). Begin → stage in 1,000-row chunks → import.
// The diff, the drop detection and the auto-linking all happen in SQL.
// ---------------------------------------------------------------------------
export function batchIdFor(snapshotDate: string): string {
  return `nlcc-${snapshotDate}`;
}

export async function importRoster(parsed: ParsedRoster, snapshotDate: string, sourceFile: string) {
  const date = isoDate(snapshotDate, "Roster date");
  if (!date) throw new LiquorError("Roster date is required.");
  if (!parsed.rows.length) throw new LiquorError("The file has no Nebraska licenses to import.");
  const batch = batchIdFor(date);

  const begin = await supabase.rpc("liquor_begin_snapshot", {
    p_batch_id: batch, p_snapshot_date: date, p_source_file: sourceFile,
    p_note: `${parsed.total} rows in file; skipped ${parsed.skipped_out_of_state} out-of-state, ${parsed.skipped_shipper} shipper`,
    p_reset: true,   // a fresh upload: drop rows an earlier, interrupted upload left staged
  });
  if (begin.error) throw new LiquorError(begin.error.message, 409);

  for (let i = 0; i < parsed.rows.length; i += 1000) {
    const { error } = await supabase.rpc("liquor_stage_rows", { p_batch_id: batch, p_rows: parsed.rows.slice(i, i + 1000) });
    if (error) {
      await supabase.rpc("liquor_rollback_snapshot", { p_batch_id: batch });   // discards the unimported snapshot
      throw new LiquorError(`Staging failed at row ${i + 1}: ${error.message}`, 500);
    }
  }
  const { data, error } = await supabase.rpc("liquor_import_snapshot", { p_batch_id: batch });
  if (error) {
    await supabase.rpc("liquor_rollback_snapshot", { p_batch_id: batch });
    throw new LiquorError(`Import failed: ${error.message}`, 500);
  }
  return data as {
    batch_id: string; snapshot_date: string; baseline: boolean; rows: number; added_to_file: number;
    new: number; dropped: number; returned: number; changed: number; active_on_file: number;
    links: { active_with_brand: number; active_with_licensee_company: number; active_with_property: number };
  };
}

export async function rollbackSnapshot(batchId: string) {
  const b = clean(batchId);
  if (!b) throw new LiquorError("batch_id is required.");
  const { data, error } = await supabase.rpc("liquor_rollback_snapshot", { p_batch_id: b });
  if (error) throw new LiquorError(error.message, 409);
  return data as Record<string, unknown>;
}
