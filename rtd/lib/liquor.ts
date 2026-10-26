import { db } from "./supabase";

// Nebraska liquor licenses in the RTD (10/26/2026, migration 032). Dan: "I also
// want this data available to the RTD too" — Jami and Trey get the full search
// and the Excel export. Read-only, through rtd_liquor_* only: the NLCC roster
// fields plus the directory brand a license is linked to. The CRM's own links
// (properties, operating companies, contacts) and Dan's notes never reach here.

export const SALE_TYPES = [
  { code: "on_premise", label: "Bar / restaurant", long: "On-premise only (bar, restaurant)" },
  { code: "both", label: "On + off premise", long: "On- and off-premise (most bars, many restaurants)" },
  { code: "off_premise", label: "Package / c-store", long: "Off-premise only (c-store, grocery, liquor store)" },
  { code: "maker", label: "Brewery / winery", long: "Craft brewery, farm winery, micro distillery" },
  { code: "wholesale", label: "Wholesale", long: "Wholesale" },
  { code: "other", label: "Other", long: "Party bus, bottle club, boat …" },
] as const;

export function saleLabel(code: string | null | undefined): string {
  return SALE_TYPES.find((s) => s.code === code)?.label ?? code ?? "";
}

export type LicenseRow = {
  license_number: string; class: string | null; class_label: string | null; sale_type: string;
  secondary_licenses: string[]; trade_name: string | null; premises_street: string | null;
  premises_city: string | null; premises_zip: string | null; county: string | null;
  phone: string | null; email: string | null; manager_name: string | null; licensee: string | null;
  corporate_address: string | null; issue_date: string | null; expiration_date: string | null;
  status: string; first_seen_on: string | null; dropped_on: string | null;
  brand_entity_id: string | null; brand_name: string | null; operator_licenses: number; total_count: number;
};

export type OperatorRow = {
  operator_key: string; licensee: string; license_count: number; in_area_count: number; cities: string | null;
  trade_names: string | null; brand_names: string | null; sample_email: string | null; sample_phone: string | null;
  corporate_address: string | null; total_count: number;
};

export type LiquorMeta = {
  latest_snapshot_date: string | null; active: number; counties: string[];
  snapshots: { snapshot_date: string; new: number | null; dropped: number | null; baseline: boolean }[];
};

export type LiquorParams = {
  view: "licenses" | "operators" | "new" | "dropped";
  q: string; city: string; county: string; sale: string[]; minOp: string; sort: string; offset: number;
};

function one(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v ?? "").trim();
}

export function parseLiquorParams(sp: Record<string, string | string[] | undefined>): LiquorParams {
  const view = one(sp.view);
  const sale = (Array.isArray(sp.sale) ? sp.sale : (sp.sale ?? "").split(","))
    .map((s) => s.trim()).filter((s) => SALE_TYPES.some((t) => t.code === s));
  const off = Number(one(sp.offset));
  return {
    view: view === "operators" || view === "dropped" || view === "new" ? view : "licenses",
    q: one(sp.q), city: one(sp.city), county: one(sp.county), sale,
    minOp: /^\d+$/.test(one(sp.min_operator)) ? one(sp.min_operator) : "",
    sort: ["operator", "city", "newest"].includes(one(sp.sort)) ? one(sp.sort) : "name",
    offset: Number.isFinite(off) && off > 0 ? Math.floor(off) : 0,
  };
}

export function liquorQuery(p: LiquorParams, over: Partial<LiquorParams> = {}): string {
  const x = { ...p, ...over };
  const q = new URLSearchParams();
  if (x.view !== "licenses") q.set("view", x.view);
  if (x.q) q.set("q", x.q);
  if (x.city) q.set("city", x.city);
  if (x.county) q.set("county", x.county);
  if (x.sale.length) q.set("sale", x.sale.join(","));
  if (x.minOp) q.set("min_operator", x.minOp);
  if (x.sort !== "name") q.set("sort", x.sort);
  if (x.offset) q.set("offset", String(x.offset));
  return q.toString();
}

export async function liquorMeta(): Promise<LiquorMeta | null> {
  const supabase = await db();
  const { data, error } = await supabase.rpc("rtd_liquor_meta");
  if (error) return null;
  return data as LiquorMeta;
}

export async function searchLicenses(p: LiquorParams, limit: number, offset = p.offset) {
  const supabase = await db();
  const { data, error } = await supabase.rpc("rtd_liquor_search", {
    p_q: p.q || null, p_city: p.city || null, p_county: p.county || null,
    p_sale_types: p.sale.length ? p.sale : null,
    p_status: p.view === "dropped" ? "dropped" : "active",
    p_min_operator: p.minOp ? Number(p.minOp) : null,
    // "New": first seen on any roster after the baseline (032 leaves the baseline out).
    p_new_since: p.view === "new" ? "1900-01-01" : null,
    p_sort: p.view === "dropped" ? "city" : p.view === "new" ? "newest" : p.sort,
    p_limit: limit, p_offset: offset,
  });
  const rows = (data ?? []) as LicenseRow[];
  return { rows, total: rows.length ? Number(rows[0].total_count) : 0, error: error?.message ?? null };
}

/** Every matching license for the export, 1,000 per call (Supabase's page size). */
export async function allLicenses(p: LiquorParams, max = 10000) {
  const out: LicenseRow[] = [];
  for (let off = 0; off < max; off += 1000) {
    const r = await searchLicenses(p, 1000, off);
    if (r.error) return { rows: out, error: r.error };
    out.push(...r.rows);
    if (r.rows.length < 1000) break;
  }
  return { rows: out, error: null };
}

export async function listOperators(p: LiquorParams, limit: number, offset = p.offset) {
  const supabase = await db();
  const { data, error } = await supabase.rpc("rtd_liquor_operators", {
    p_min_licenses: p.minOp ? Number(p.minOp) : 2, p_county: p.county || null, p_city: p.city || null,
    p_sale_types: p.sale.length ? p.sale : null, p_q: p.q || null, p_limit: limit, p_offset: offset,
  });
  const rows = (data ?? []) as OperatorRow[];
  return { rows, total: rows.length ? Number(rows[0].total_count) : 0, error: error?.message ?? null };
}

export type BrandLiquor = {
  active: number; latest_snapshot_date: string | null;
  licenses: { license_number: string; class: string | null; sale_type: string; trade_name: string | null;
    premises_street: string | null; premises_city: string | null; county: string | null; licensee: string | null;
    manager_name: string | null; phone: string | null; email: string | null; status: string; dropped_on: string | null }[];
};

export async function brandLiquor(entityId: string): Promise<BrandLiquor | null> {
  const supabase = await db();
  const { data, error } = await supabase.rpc("rtd_brand_liquor", { p_entity_id: entityId });
  if (error) return null;
  return data as BrandLiquor;
}

export function phone(p: string | null | undefined): string {
  if (!p) return "";
  const d = p.replace(/\D/g, "");
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : p;
}
