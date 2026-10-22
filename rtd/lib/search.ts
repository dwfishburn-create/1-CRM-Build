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
  categories: string[];   // one or several (031)
  site: string;
  q: string;
  close: boolean;
  unverified: boolean;
  unsized: boolean;       // also list brands with no size on file (031)
  excludeCategories: string[];  // a center's exclusives (031)
  excludeWords: string[];       // matched against brand name, trade name, category detail
  showExcluded: boolean;        // list excluded brands anyway, marked
  offset: number;
  saved: string;          // the saved search this came from, if any
};

// What a saved search stores (rtd_saved_searches.params).
export type SavedParams = {
  size?: number; market?: string; categories?: string[]; site?: string;
  close?: boolean; unverified?: boolean; unsized?: boolean; q?: string;
  exclude_categories?: string[]; exclude_words?: string[];
};

export type SavedSearch = {
  id: string; name: string; listing: string | null; params: SavedParams;
  created_by: string; created_at: string; updated_by: string | null; updated_at: string;
  mine: boolean; can_edit: boolean; last_viewed_at: string | null; new_since: string;
  total: number | null; new_count: number | null;
};

export type BrandRow = {
  entity_id: string;
  display_code: string;
  name: string;
  category: string | null;
  category_label: string | null;
  size_min_sf: number | null;
  size_max_sf: number | null;
  fit: "fits" | "close" | "none" | "unknown";
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
  changed_at: string | null;
  excluded_by: string | null;
  excluded_count: number;
};

function one(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}
function many(v: string | string[] | undefined): string[] {
  const all = (Array.isArray(v) ? v : v ? [v] : []).flatMap((x) => x.split(","));
  return [...new Set(all.map((x) => x.trim()).filter(Boolean))].sort();
}
function words(v: string | string[] | undefined): string[] {
  const all = (Array.isArray(v) ? v : v ? [v] : []).flatMap((x) => x.split(","));
  return [...new Set(all.map((x) => x.trim().toLowerCase()).filter((x) => x.length >= 2))].sort();
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseParams(sp: Record<string, string | string[] | undefined>): SearchParams {
  const rawSize = one(sp.size).replace(/[^0-9.]/g, "");
  const size = rawSize ? Number(rawSize) : null;
  return {
    size: size && size > 0 ? size : null,
    market: one(sp.market),
    categories: many(sp.category),
    site: one(sp.site) || "any",
    q: one(sp.q).trim(),
    close: one(sp.close) !== "0",
    unverified: one(sp.unverified) === "1",
    unsized: one(sp.unsized) === "1",
    excludeCategories: many(sp.xcat),
    excludeWords: words(sp.xwords),
    showExcluded: one(sp.showx) === "1",
    offset: Math.max(0, Number(one(sp.offset)) || 0),
    saved: UUID_RE.test(one(sp.saved)) ? one(sp.saved) : "",
  };
}

export function toQuery(p: SearchParams, overrides: Partial<SearchParams> = {}): string {
  const v = { ...p, ...overrides };
  const qs = new URLSearchParams();
  if (v.size) qs.set("size", String(v.size));
  if (v.market) qs.set("market", v.market);
  if (v.categories.length) qs.set("category", v.categories.join(","));
  if (v.site && v.site !== "any") qs.set("site", v.site);
  if (v.q) qs.set("q", v.q);
  if (!v.close) qs.set("close", "0");
  if (v.unverified) qs.set("unverified", "1");
  if (v.unsized) qs.set("unsized", "1");
  if (v.excludeCategories.length) qs.set("xcat", v.excludeCategories.join(","));
  if (v.excludeWords.length) qs.set("xwords", v.excludeWords.join(", "));
  if (v.showExcluded) qs.set("showx", "1");
  if (v.offset) qs.set("offset", String(v.offset));
  if (v.saved) qs.set("saved", v.saved);
  return qs.toString();
}

// Page params ⇄ what a saved search stores.
export function toSaved(p: SearchParams): SavedParams {
  const out: SavedParams = { close: p.close, unverified: p.unverified, unsized: p.unsized, site: p.site || "any" };
  if (p.size) out.size = p.size;
  if (p.market) out.market = p.market;
  if (p.categories.length) out.categories = [...p.categories].sort();
  if (p.q) out.q = p.q;
  if (p.excludeCategories.length) out.exclude_categories = [...p.excludeCategories].sort();
  if (p.excludeWords.length) out.exclude_words = [...p.excludeWords].sort();
  return out;
}

export function fromSaved(s: SavedParams, saved = ""): SearchParams {
  return {
    size: s.size ?? null,
    market: s.market ?? "",
    categories: [...(s.categories ?? [])].sort(),
    site: s.site || "any",
    q: s.q ?? "",
    close: s.close ?? true,
    unverified: !!s.unverified,
    unsized: !!s.unsized,
    excludeCategories: [...(s.exclude_categories ?? [])].sort(),
    excludeWords: [...(s.exclude_words ?? [])].sort(),
    showExcluded: false,
    offset: 0,
    saved,
  };
}

export function sameSearch(a: SearchParams, b: SearchParams): boolean {
  const norm = (p: SearchParams) => toQuery({ ...p, offset: 0, saved: "", showExcluded: false });
  return norm(a) === norm(b);
}

export function siteLabel(code: string): string {
  return SITES.find((x) => x.code === code)?.label ?? code;
}

// One line describing a search: "3,200 SF · Omaha Metro · QSR, Coffee · Has a drive-thru".
export function describeSearch(p: SearchParams, categories: { code: string; label: string }[]): string {
  const cat = (c: string) => categories.find((x) => x.code === c)?.label ?? c;
  return [
    p.size ? `${p.size.toLocaleString("en-US")} SF` : "Any size",
    p.market ? marketLabel(p.market) : "Any market",
    p.categories.length ? p.categories.map(cat).join(", ") : "Any category",
    p.site !== "any" ? siteLabel(p.site) : "",
    p.q ? `name contains "${p.q}"` : "",
    !p.close ? "exact fits only" : "",
    p.unsized ? "incl. no size on file" : "",
    p.unverified ? "unverified only" : "",
  ].filter(Boolean).join(" · ");
}

// "Excludes: Beauty, Salon & Spa; "pizza", "pizzeria"" — or "".
export function describeExclusions(p: SearchParams, categories: { code: string; label: string }[]): string {
  const cat = (c: string) => categories.find((x) => x.code === c)?.label ?? c;
  const parts = [...p.excludeCategories.map(cat), ...p.excludeWords.map((w) => `"${w}"`)];
  return parts.length ? `Excludes ${parts.join(", ")}` : "";
}

export async function searchBrands(p: SearchParams, limit = 100): Promise<{ rows: BrandRow[]; error?: string }> {
  const supabase = await db();
  const { data, error } = await supabase.rpc("rtd_search", {
    p_size: p.size,
    p_market: p.market || null,
    p_category: p.categories.length ? p.categories.join(",") : null,
    p_site: p.site || "any",
    p_q: p.q || null,
    p_include_close: p.close,
    p_unverified_only: p.unverified,
    p_limit: limit,
    p_offset: p.offset,
    p_include_unsized: p.unsized,
    p_exclude_categories: p.excludeCategories.length ? p.excludeCategories.join(",") : null,
    p_exclude_words: p.excludeWords.length ? p.excludeWords.join(",") : null,
    p_show_excluded: p.showExcluded,
  });
  if (error) return { rows: [], error: error.message };
  return { rows: (data ?? []) as BrandRow[] };
}

export async function listSavedSearches(): Promise<{ rows: SavedSearch[]; error?: string }> {
  const supabase = await db();
  const { data, error } = await supabase.rpc("rtd_saved_searches");
  if (error) return { rows: [], error: error.message };
  return { rows: (data ?? []) as SavedSearch[] };
}

export async function getSavedSearch(id: string): Promise<SavedSearch | null> {
  const supabase = await db();
  const { data } = await supabase.rpc("rtd_saved_search", { p_id: id });
  return (data as SavedSearch | null) ?? null;
}

export async function markSearchViewed(id: string): Promise<void> {
  const supabase = await db();
  await supabase.rpc("rtd_mark_search_viewed", { p_id: id });
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
