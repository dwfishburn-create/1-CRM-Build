import { supabase } from "./supabase";
import { nextDisplayCode } from "./displayCode";
import { todayCentral } from "./centralDate";
import {
  compareMatches,
  scoreMatch,
  type MatchListing,
  type MatchProperty,
  type MatchRequirement,
  type MatchResult,
} from "./requirementMatchCore";

// Requirement ↔ property matching — the database side (11/14/2026, Phase 4 of
// Retail Listing Intake & Matching). The scoring rule itself is in
// lib/requirementMatchCore.ts. Used by:
//   - the property page "Who wants this?" section (matchesForProperty)
//   - the requirement page "Possible matches" (matchesForRequirement)
//   - GET/POST /api/agent/requirement-matches and through it the connector's
//     find_requirement_matches tool, which the Listing Intake Sweep calls.

export const MATCH_TASK_CATEGORY = "listing_match";

const REQ_COLUMNS =
  "id, display_code, status, deal_type, property_type, sides, asset_classes, target_markets, outside_markets, size_min, size_max, " +
  "acres_min, acres_max, budget_min, budget_max, cap_rate_min, tenancy_types, credit_floor, min_term_years, " +
  "exchange_1031, exchange_identify_by, exchange_close_by, priority, details";

const PROP_COLUMNS =
  "id, display_code, address, suite_number, city, state, county, property_type, building_sf, land_acres, market_status";

const LISTING_COLUMNS =
  "property_id, listing_type, status, asking_price, asking_rate, rate_basis, sf, cap_rate, noi, tenancy_type, " +
  "tenant_credit, term_remaining_years, land_acres, last_observed_on, is_dan_listing, is_cbre";

export type ReqRow = MatchRequirement & { priority: string | null; details: string | null };
export type PropRow = MatchProperty & { suite_number: string | null };
type ListingRow = MatchListing & { property_id: string; is_dan_listing: boolean; is_cbre: boolean };

export type Party = { contact_id: string | null; entity_id: string | null; name: string };

export type RequirementMatch = MatchResult & {
  requirement: Pick<ReqRow, "id" | "display_code" | "status" | "deal_type" | "property_type" | "priority">;
  parties: Party[];
  label: string;
};

export type PropertyMatch = MatchResult & {
  property: PropRow;
  listing: (MatchListing & { is_dan_listing: boolean; is_cbre: boolean }) | null;
};

function one<T>(x: T | T[] | null | undefined): T | null {
  return Array.isArray(x) ? (x[0] ?? null) : (x ?? null);
}

async function partiesFor(reqIds: string[]): Promise<Map<string, Party[]>> {
  const out = new Map<string, Party[]>();
  if (!reqIds.length) return out;
  const { data, error } = await supabase
    .from("requirement_parties")
    .select(
      "requirement_id, contact_id, entity_id, contact:contacts!contact_id(first_name, last_name), entity:entities!entity_id(name, trade_name)"
    )
    .in("requirement_id", reqIds)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  for (const row of data ?? []) {
    const c = one(row.contact as unknown as { first_name: string | null; last_name: string | null } | null);
    const e = one(row.entity as unknown as { name: string; trade_name: string | null } | null);
    const name = e ? e.trade_name || e.name : [c?.first_name, c?.last_name].filter(Boolean).join(" ");
    const list = out.get(row.requirement_id) ?? [];
    list.push({ contact_id: row.contact_id, entity_id: row.entity_id, name: name || "(unnamed)" });
    out.set(row.requirement_id, list);
  }
  return out;
}

function labelFor(r: Pick<ReqRow, "display_code" | "deal_type" | "property_type">, parties: Party[]): string {
  const who = parties.find((p) => p.entity_id)?.name ?? parties[0]?.name;
  const what = [r.deal_type, r.property_type].filter(Boolean).join(", ");
  return [r.display_code, who || what].filter(Boolean).join(" — ");
}

/** Best result for one requirement across a property's listing rows (or none). */
function bestFor(req: ReqRow, prop: PropRow, listings: ListingRow[], today: string): MatchResult | null {
  // A property with a live listing is scored only as that listing (a sale
  // listing is not an "off-market fit" for a tenant); no live listing → off-market.
  const AVAILABLE = ["active", "price_change", "relisted", "under_contract"];
  const live = listings.filter((l) => AVAILABLE.includes(l.status));
  const candidates: (ListingRow | null)[] = live.length ? live : [null];
  let best: MatchResult | null = null;
  for (const l of candidates) {
    const r = scoreMatch(req, prop, l, today);
    if (r && (!best || compareMatches(r, best) < 0)) best = r;
  }
  return best;
}

// ---------------------------------------------------------------------------
// Property → requirements ("Who wants this?")
// ---------------------------------------------------------------------------

export async function matchesForProperty(propertyId: string): Promise<{
  property: PropRow;
  listings: ListingRow[];
  matches: RequirementMatch[];
  owners: { id: string; name: string; do_not_solicit: boolean; represented_by: string | null }[];
}> {
  const [propRes, listRes, reqRes, ownerRes] = await Promise.all([
    supabase.from("properties").select(PROP_COLUMNS).eq("id", propertyId).maybeSingle(),
    supabase.from("listing_price_summary").select(LISTING_COLUMNS).eq("property_id", propertyId),
    supabase.from("requirements").select(REQ_COLUMNS).in("status", ["active", "on_hold"]),
    supabase
      .from("property_owner")
      .select("entity:entities!entity_id(id, name, do_not_solicit, represented_by)")
      .eq("property_id", propertyId)
      .eq("is_current", true),
  ]);
  for (const r of [propRes, listRes, reqRes, ownerRes]) if (r.error) throw new Error(r.error.message);
  const property = propRes.data as unknown as PropRow | null;
  if (!property) throw new Error("Property not found.");
  const listings = (listRes.data ?? []) as unknown as ListingRow[];
  const reqs = (reqRes.data ?? []) as unknown as ReqRow[];
  const parties = await partiesFor(reqs.map((r) => r.id));
  const today = todayCentral();

  const matches: RequirementMatch[] = [];
  for (const req of reqs) {
    const m = bestFor(req, property, listings, today);
    if (!m || m.score === null || m.met.length === 0) continue;
    const ps = parties.get(req.id) ?? [];
    matches.push({
      ...m,
      requirement: {
        id: req.id,
        display_code: req.display_code,
        status: req.status,
        deal_type: req.deal_type,
        property_type: req.property_type,
        priority: req.priority,
      },
      parties: ps,
      label: labelFor(req, ps),
    });
  }
  matches.sort(compareMatches);

  const owners = (ownerRes.data ?? [])
    .map((o) => one(o.entity as unknown as { id: string; name: string; do_not_solicit: boolean; represented_by: string | null } | null))
    .filter((e): e is NonNullable<typeof e> => !!e);

  return { property, listings, matches, owners };
}

// ---------------------------------------------------------------------------
// Requirement → properties
// ---------------------------------------------------------------------------

async function allProperties(): Promise<PropRow[]> {
  const out: PropRow[] = [];
  const page = 1000;
  for (let from = 0; from < 20000; from += page) {
    const { data, error } = await supabase
      .from("properties")
      .select(PROP_COLUMNS)
      .is("parent_property_id", null)
      .order("id")
      .range(from, from + page - 1);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as unknown as PropRow[]));
    if (!data || data.length < page) break;
  }
  return out;
}

/**
 * Score every listed property (anything with listing history, or marked
 * on-market) and, when includeOffMarket, every other property too — returning
 * only the strong off-market fits, capped at offMarketLimit.
 */
export async function matchesForRequirement(
  requirementId: string,
  opts: { includeOffMarket?: boolean; offMarketLimit?: number } = {}
): Promise<{ requirement: ReqRow; listed: PropertyMatch[]; off_market: PropertyMatch[]; off_market_total: number }> {
  const { data: reqData, error: reqErr } = await supabase
    .from("requirements")
    .select(REQ_COLUMNS)
    .eq("id", requirementId)
    .maybeSingle();
  if (reqErr) throw new Error(reqErr.message);
  const requirement = reqData as unknown as ReqRow | null;
  if (!requirement) throw new Error("Requirement not found.");

  const { data: lData, error: lErr } = await supabase.from("listing_price_summary").select(LISTING_COLUMNS);
  if (lErr) throw new Error(lErr.message);
  const listingsByProp = new Map<string, ListingRow[]>();
  for (const l of (lData ?? []) as unknown as ListingRow[]) {
    const arr = listingsByProp.get(l.property_id) ?? [];
    arr.push(l);
    listingsByProp.set(l.property_id, arr);
  }

  let props: PropRow[];
  if (opts.includeOffMarket) {
    props = await allProperties();
  } else {
    const ids = [...listingsByProp.keys()];
    const [a, b] = await Promise.all([
      ids.length ? supabase.from("properties").select(PROP_COLUMNS).in("id", ids) : Promise.resolve({ data: [], error: null }),
      supabase.from("properties").select(PROP_COLUMNS).eq("market_status", "on_market").is("parent_property_id", null).limit(1000),
    ]);
    if (a.error) throw new Error(a.error.message);
    if (b.error) throw new Error(b.error.message);
    const seen = new Map<string, PropRow>();
    for (const p of [...((a.data ?? []) as unknown as PropRow[]), ...((b.data ?? []) as unknown as PropRow[])]) seen.set(p.id, p);
    props = [...seen.values()];
  }

  const today = todayCentral();
  const listed: PropertyMatch[] = [];
  const off: PropertyMatch[] = [];
  for (const p of props) {
    const ls = listingsByProp.get(p.id) ?? [];
    const m = bestFor(requirement, p, ls, today);
    if (!m || m.score === null || m.met.length === 0) continue;
    const isListed = m.lane !== "off_market" || p.market_status === "on_market";
    const used = ls.find((l) => l.listing_type === m.listing_type) ?? null;
    const row: PropertyMatch = {
      ...m,
      property: p,
      listing: used
        ? { ...used, is_dan_listing: used.is_dan_listing, is_cbre: used.is_cbre }
        : null,
    };
    if (isListed) listed.push(row);
    else if (m.strong) off.push(row);
  }
  listed.sort(compareMatches);
  off.sort(compareMatches);
  const limit = opts.offMarketLimit ?? 25;
  return { requirement, listed, off_market: off.slice(0, limit), off_market_total: off.length };
}

// ---------------------------------------------------------------------------
// Tasks for strong matches (the sweep's output, design doc §8)
// ---------------------------------------------------------------------------

export type MatchTaskResult = {
  requirement: string;
  pct: number | null;
  action: "created" | "skipped";
  reason?: string;
  task_id?: string;
  task_code?: string;
};

/**
 * One Your Move task per strong match on a LIVE listing (sale/land → buyers,
 * lease/sublease → tenants). Never for off-market fits, paused requirements
 * or weak scores. De-duplicated: skipped when an open listing-match task
 * already exists for the same requirement + property, or one was closed on or
 * after the listing's latest observation (a new price observation re-opens
 * the question; the same listing doesn't nag twice).
 */
export async function createMatchTasks(propertyId: string, opts: { dryRun?: boolean } = {}): Promise<{
  property: PropRow;
  results: MatchTaskResult[];
  matches: RequirementMatch[];
}> {
  const { property, listings, matches } = await matchesForProperty(propertyId);
  const results: MatchTaskResult[] = [];
  const today = todayCentral();
  const where = [property.address, property.city].filter(Boolean).join(", ");

  for (const m of matches) {
    if (!m.strong || m.lane === "off_market") continue;
    const listing = listings.find((l) => l.listing_type === m.listing_type);
    const observed = listing?.last_observed_on ?? null;

    const { data: existing, error } = await supabase
      .from("tasks")
      .select("id, display_code, status, updated_at")
      .eq("category", MATCH_TASK_CATEGORY)
      .eq("requirement_id", m.requirement_id)
      .eq("property_id", propertyId);
    if (error) throw new Error(error.message);
    const open = (existing ?? []).find((t) => t.status === "open");
    if (open) {
      results.push({ requirement: m.label, pct: m.pct, action: "skipped", reason: `open task ${open.display_code}`, task_id: open.id });
      continue;
    }
    const closedSince = (existing ?? []).find((t) => observed && t.updated_at.slice(0, 10) >= observed);
    if (closedSince) {
      results.push({ requirement: m.label, pct: m.pct, action: "skipped", reason: `already worked (${closedSince.display_code}) since the last price observation` });
      continue;
    }
    if (opts.dryRun) {
      results.push({ requirement: m.label, pct: m.pct, action: "skipped", reason: "dry run" });
      continue;
    }

    const who = m.parties.find((p) => p.entity_id) ?? m.parties[0] ?? null;
    const lines = [
      `${m.pct}% match (${m.met.length} of ${m.met.length + m.missed.length} known criteria) — ${m.lane === "buyer" ? "sale listing vs. buy-side requirement" : "lease listing vs. tenant requirement"}.`,
      ...m.met.map((c) => `✓ ${c.label}: ${c.detail}`),
      ...m.missed.map((c) => `✗ ${c.label}: ${c.detail}`),
      ...m.unknown.map((c) => `? ${c.label}: ${c.detail}`),
      m.exchange_note,
      listing?.is_dan_listing ? "This is one of Dan's listings — pitch it." : null,
    ].filter(Boolean);

    const display_code = await nextDisplayCode("tasks", "TASK");
    const { data: task, error: insErr } = await supabase
      .from("tasks")
      .insert({
        display_code,
        title: `Listing match: ${who?.name ?? m.requirement.display_code} → ${where} (${m.pct}%)`,
        description: lines.join("\n"),
        due_date: today,
        status: "open",
        category: MATCH_TASK_CATEGORY,
        requirement_id: m.requirement_id,
        property_id: propertyId,
        entity_id: who?.entity_id ?? null,
        contact_id: who?.contact_id ?? null,
      })
      .select("id, display_code")
      .single();
    if (insErr) throw new Error(insErr.message);
    results.push({ requirement: m.label, pct: m.pct, action: "created", task_id: task.id, task_code: task.display_code });
  }
  return { property, results, matches };
}
