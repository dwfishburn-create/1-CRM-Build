import { db } from "./supabase";

export const MARKETS: { code: string; label: string }[] = [
  { code: "omaha_metro", label: "Omaha Metro" },
  { code: "lincoln", label: "Lincoln" },
  { code: "greater_nebraska", label: "Greater Nebraska" },
  { code: "cb_western_iowa", label: "Council Bluffs / Western Iowa" },
];

export const SITES = [
  { code: "any", label: "Any site" },
  { code: "has_drive_thru", label: "Has a drive-thru" },
  { code: "no_drive_thru", label: "No drive-thru" },
];

export const EXPANSION: Record<string, string> = {
  expanding: "Expanding",
  selective: "Selective",
  not_expanding: "Not expanding",
  contracting: "Contracting",
  unknown: "Unknown",
};

export const FACILITY: Record<string, string> = {
  free_standing: "Free-standing",
  end_cap: "End cap",
  neighborhood_strip: "Neighborhood strip",
  regional_strip: "Regional strip",
  power_center: "Power center",
  lifestyle_center: "Lifestyle center",
  regional_mall: "Regional mall",
  outlet_mall: "Outlet mall",
  downtown: "Downtown",
  kiosk: "Kiosk",
};

export function marketLabel(code: string): string {
  return MARKETS.find((m) => m.code === code)?.label ?? code;
}

export type SearchParams = {
  size: number | null;
  market: string;
  category: string;
  site: string;
  q: string;
  close: boolean;
  unverified: boolean;
  offset: number;
};

export type BrandRow = {
  entity_id: string;
  display_code: string;
  name: string;
  category: string | null;
  category_label: string | null;
  size_min_sf: number | null;
  size_max_sf: number | null;
  fit: "fits" | "close" | "none";
  fit_delta_pct: number | null;
  drive_thru: string | null;
  facility_types: string[];
  expansion_status: string;
  target_markets: string[];
  market_set: boolean;
  needs_verification: boolean;
  last_verified_on: string | null;
  contact_name: string | null;
  contact_title: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  contact_count: number;
  active_requirements: number;
  total_count: number;
};

function one(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

export function parseParams(sp: Record<string, string | string[] | undefined>): SearchParams {
  const rawSize = one(sp.size).replace(/[^0-9.]/g, "");
  const size = rawSize ? Number(rawSize) : null;
  return {
    size: size && size > 0 ? size : null,
    market: one(sp.market),
    category: one(sp.category),
    site: one(sp.site) || "any",
    q: one(sp.q).trim(),
    close: one(sp.close) !== "0",
    unverified: one(sp.unverified) === "1",
    offset: Math.max(0, Number(one(sp.offset)) || 0),
  };
}

export function toQuery(p: SearchParams, overrides: Partial<SearchParams> = {}): string {
  const v = { ...p, ...overrides };
  const qs = new URLSearchParams();
  if (v.size) qs.set("size", String(v.size));
  if (v.market) qs.set("market", v.market);
  if (v.category) qs.set("category", v.category);
  if (v.site && v.site !== "any") qs.set("site", v.site);
  if (v.q) qs.set("q", v.q);
  if (!v.close) qs.set("close", "0");
  if (v.unverified) qs.set("unverified", "1");
  if (v.offset) qs.set("offset", String(v.offset));
  return qs.toString();
}

export async function searchBrands(p: SearchParams, limit = 100): Promise<{ rows: BrandRow[]; error?: string }> {
  const supabase = await db();
  const { data, error } = await supabase.rpc("rtd_search", {
    p_size: p.size,
    p_market: p.market || null,
    p_category: p.category || null,
    p_site: p.site || "any",
    p_q: p.q || null,
    p_include_close: p.close,
    p_unverified_only: p.unverified,
    p_limit: limit,
    p_offset: p.offset,
  });
  if (error) return { rows: [], error: error.message };
  return { rows: (data ?? []) as BrandRow[] };
}

export async function listCategories(): Promise<{ code: string; label: string }[]> {
  const supabase = await db();
  const { data } = await supabase.rpc("rtd_categories");
  return (data ?? []) as { code: string; label: string }[];
}

export function sf(n: number | null | undefined): string {
  return n == null ? "—" : Number(n).toLocaleString("en-US");
}

export function sizeRange(min: number | null, max: number | null): string {
  if (min == null && max == null) return "Not on file";
  if (min == null) return `Up to ${sf(max)}`;
  if (max == null) return `${sf(min)}+`;
  return min === max ? sf(min) : `${sf(min)}–${sf(max)}`;
}

export function freshness(needs: boolean, last: string | null): string {
  if (!last) return needs ? "Never verified" : "Verified";
  const d = new Date(last + "T12:00:00");
  const label = d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
  return needs ? `Unverified · last checked ${label}` : `Verified ${label}`;
}
