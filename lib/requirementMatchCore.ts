// Requirement ↔ listing scoring — pure functions, no database access, so the
// rule can be read and tested in one place (11/14/2026, Phase 4).
//
// Dan's rule (11/10/2026, design doc §10.1):
//   score = share of the requirement's STATED criteria the listing meets.
//   A criterion the requirement leaves blank is not counted. A criterion the
//   listing doesn't state is UNKNOWN — not a miss — and is named in the report.
//   Strong match = 50% or better.
// So score = met / (met + missed), with unknowns listed separately.
//
// Two guards (Claude's call 11/14, flag if wrong), both from the 11/10 Wildcat
// lesson that thin matches are noise:
//   - strong needs at least 2 criteria actually known (met or missed);
//   - strong needs the asset class AND the market not to be a miss (an
//     Omaha-only buyer is not a strong match for a Lincoln listing just
//     because the property type fits — 2 known criteria, 1 met = 50%).
// Requirements on hold are scored and shown as "paused", never strong
// (lesson b, 11/10).

export type Side = "tenant" | "buyer" | "investor" | "developer";
export type Market = "omaha_metro" | "lincoln" | "greater_nebraska" | "cb_western_iowa";

export type MatchRequirement = {
  id: string;
  display_code: string | null;
  status: string;
  deal_type: string | null;
  property_type: string | null;
  sides: string[] | null;
  asset_classes: string[] | null;
  target_markets: string[] | null;
  size_min: number | null;
  size_max: number | null;
  acres_min: number | null;
  acres_max: number | null;
  budget_min: number | null;
  budget_max: number | null;
  cap_rate_min: number | null;
  tenancy_types: string[] | null;
  credit_floor: string | null;
  min_term_years: number | null;
  exchange_1031: boolean | null;
  exchange_identify_by: string | null;
  exchange_close_by: string | null;
};

export type MatchProperty = {
  id: string;
  display_code: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  county: string | null;
  property_type: string | null;
  building_sf: number | null;
  land_acres: number | null;
  market_status: string | null;
};

/** Latest listing observation (a listing_price_summary row), if any. */
export type MatchListing = {
  listing_type: string; // sale | lease | sublease | land
  status: string;
  asking_price: number | null;
  asking_rate: number | null;
  rate_basis: string | null;
  sf: number | null;
  cap_rate: number | null;
  noi: number | null;
  tenancy_type: string | null;
  tenant_credit: string | null;
  term_remaining_years: number | null;
  land_acres: number | null;
  last_observed_on?: string | null;
};

export type Criterion = { key: string; label: string; detail: string };

export type MatchResult = {
  requirement_id: string;
  property_id: string;
  /** buyer = lane 1 (sale/land listing vs buy-side), tenant = lane 2, off_market = no live listing */
  lane: "buyer" | "tenant" | "off_market";
  listing_type: string | null;
  score: number | null; // 0..1; null when nothing is known
  pct: number | null;
  met: Criterion[];
  missed: Criterion[];
  unknown: Criterion[];
  strong: boolean;
  paused: boolean;
  exchange_note: string | null;
};

const BUY_SIDES: Side[] = ["buyer", "investor", "developer"];
const AVAILABLE = new Set(["active", "price_change", "relisted", "under_contract"]);

// ---------------------------------------------------------------------------
// Normalizers
// ---------------------------------------------------------------------------

const CLASS_RULES: [string, RegExp][] = [
  ["land", /\b(land|pad|pads|lot|lots|acre|acres|acreage)\b/i],
  ["retail", /\b(retail|restaurant|qsr|c-?store|convenience|fuel|gas station|shopping|strip|bank|quick lube|drive[- ]?thru|coffee|store)\b/i],
  ["industrial", /\b(industrial|warehouse|distribution|manufacturing|logistics)\b/i],
  ["flex", /\b(flex|storage|showroom)\b/i],
  ["office", /\boffice\b/i],
  ["multifamily", /\b(multi-?family|apartment|apartments|mf)\b/i],
  ["hospitality", /\b(hotel|motel|hospitality)\b/i],
  ["mixed_use", /\bmixed[- ]?use\b/i],
  ["special_purpose", /\b(special purpose|church|school|daycare|car wash)\b/i],
];

/** Asset classes a free-text property type describes ("Industrial/Flex" → industrial, flex). */
export function assetClassesOf(text: string | null | undefined): string[] {
  if (!text) return [];
  const out: string[] = [];
  for (const [cls, re] of CLASS_RULES) if (re.test(text)) out.push(cls);
  return out;
}

const OMAHA_COUNTIES = new Set(["douglas", "sarpy", "cass", "washington", "saunders"]);
const OMAHA_CITIES = new Set([
  "omaha", "bellevue", "papillion", "la vista", "ralston", "gretna", "elkhorn", "bennington",
  "millard", "boys town", "valley", "waterloo", "springfield", "blair", "plattsmouth",
  "louisville", "ashland", "wahoo", "offutt afb",
]);
const LINCOLN_CITIES = new Set(["lincoln", "waverly", "hickman", "bennet", "firth", "malcolm", "raymond"]);

/** Which of Dan's four markets a property is in; null = unknown, "out" = outside all four. */
export function marketOf(p: Pick<MatchProperty, "city" | "state" | "county">): Market | "out" | null {
  const state = (p.state ?? "").trim().toUpperCase();
  const city = (p.city ?? "").trim().toLowerCase();
  const county = (p.county ?? "").trim().toLowerCase().replace(/\s+county$/, "");
  if (state === "IA" || state === "IOWA") return "cb_western_iowa";
  if (state && state !== "NE" && state !== "NEBRASKA") return "out";
  if (county === "lancaster" || LINCOLN_CITIES.has(city)) return "lincoln";
  if (OMAHA_COUNTIES.has(county) || OMAHA_CITIES.has(city)) return "omaha_metro";
  if (city || county) return "greater_nebraska";
  return null;
}

/** The requirement's sides; falls back to reading deal_type when none are set. */
export function sidesOf(r: Pick<MatchRequirement, "sides" | "deal_type">): Side[] {
  if (r.sides && r.sides.length) return r.sides as Side[];
  const d = (r.deal_type ?? "").toLowerCase();
  const out: Side[] = [];
  if (/lease|sublease|rent/.test(d)) out.push("tenant");
  if (/buy|purchase|acqui|1031/.test(d)) out.push("buyer");
  if (/develop|build/.test(d)) out.push("developer");
  return out;
}

const CREDIT_RANK: Record<string, number> = { investment_grade: 4, national: 3, regional: 2, local: 1 };

const fmtNum = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const fmtMoney = (n: number) => "$" + n.toLocaleString("en-US", { maximumFractionDigits: 0 });
function rangeText(min: number | null, max: number | null, f: (n: number) => string): string {
  if (min !== null && max !== null) return min === max ? f(min) : `${f(min)}–${f(max)}`;
  if (min !== null) return `${f(min)}+`;
  if (max !== null) return `up to ${f(max)}`;
  return "";
}
function inRange(v: number, min: number | null, max: number | null) {
  return (min === null || v >= min) && (max === null || v <= max);
}

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T12:00:00Z`) - Date.parse(`${fromIso}T12:00:00Z`)) / 86400000);
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/**
 * Score one requirement against one property (+ its latest listing, if any).
 * Returns null when the two can't be matched at all: the requirement is dead
 * or fulfilled, or the listing is for the other side of the deal (a lease
 * listing vs. a buyer, a sale listing vs. a tenant).
 */
export function scoreMatch(
  req: MatchRequirement,
  prop: MatchProperty,
  listing: MatchListing | null,
  today: string = new Date().toISOString().slice(0, 10)
): MatchResult | null {
  if (req.status !== "active" && req.status !== "on_hold") return null;

  const sides = sidesOf(req);
  const live = listing && AVAILABLE.has(listing.status) ? listing : null;
  const lt = live?.listing_type ?? null;

  let lane: MatchResult["lane"];
  if (lt === "sale" || lt === "land") {
    if (sides.length && !sides.some((s) => BUY_SIDES.includes(s))) return null;
    lane = "buyer";
  } else if (lt === "lease" || lt === "sublease") {
    if (sides.length && !sides.includes("tenant")) return null;
    lane = "tenant";
  } else {
    lane = "off_market";
  }
  const buySide = lane === "buyer" || (lane === "off_market" && sides.some((s) => BUY_SIDES.includes(s)));

  const met: Criterion[] = [];
  const missed: Criterion[] = [];
  const unknown: Criterion[] = [];
  const put = (ok: boolean | null, c: Criterion) => (ok === null ? unknown : ok ? met : missed).push(c);

  // 1. Asset class
  const wantClasses = req.asset_classes?.length ? req.asset_classes : assetClassesOf(req.property_type);
  if (wantClasses.length) {
    const have = assetClassesOf(prop.property_type);
    if (lt === "land" && !have.includes("land")) have.push("land");
    const label = "Property type";
    if (!have.length) put(null, { key: "asset_class", label, detail: `wants ${wantClasses.join("/")}; property type not recorded` });
    else {
      const ok = have.some((c) => wantClasses.includes(c));
      put(ok, { key: "asset_class", label, detail: `wants ${wantClasses.join("/")}; is ${prop.property_type}` });
    }
  }

  // 2. Market
  if (req.target_markets?.length) {
    const m = marketOf(prop);
    const label = "Market";
    if (m === null) put(null, { key: "market", label, detail: `wants ${req.target_markets.join(", ")}; city not recorded` });
    else {
      const where = [prop.city, prop.state].filter(Boolean).join(", ");
      put(m !== "out" && req.target_markets.includes(m), {
        key: "market",
        label,
        detail: `wants ${req.target_markets.join(", ")}; in ${where || m}`,
      });
    }
  }

  // 3. Building size (not judged on a land listing)
  if (req.size_min !== null || req.size_max !== null) {
    const want = rangeText(req.size_min, req.size_max, (n) => `${fmtNum(n)} SF`);
    const label = "Building size";
    const sf = live?.sf ?? prop.building_sf;
    if (lt === "land") put(null, { key: "size", label, detail: `wants ${want}; land listing` });
    else if (sf === null || sf === undefined) put(null, { key: "size", label, detail: `wants ${want}; SF not stated` });
    else put(inRange(sf, req.size_min, req.size_max), { key: "size", label, detail: `wants ${want}; ${fmtNum(sf)} SF` });
  }

  // 4. Land size
  if (req.acres_min !== null || req.acres_max !== null) {
    const want = rangeText(req.acres_min, req.acres_max, (n) => `${fmtNum(n)} ac`);
    const label = "Land size";
    const ac = live?.land_acres ?? prop.land_acres;
    if (ac === null || ac === undefined) put(null, { key: "acres", label, detail: `wants ${want}; acres not stated` });
    else put(inRange(ac, req.acres_min, req.acres_max), { key: "acres", label, detail: `wants ${want}; ${fmtNum(ac)} ac` });
  }

  // 5. Price / rent budget
  if (req.budget_min !== null || req.budget_max !== null) {
    const want = rangeText(req.budget_min, req.budget_max, fmtMoney);
    if (lane === "tenant") {
      const label = "Rent budget";
      const rate = live?.asking_rate ?? null;
      const sf = live?.sf ?? prop.building_sf;
      if (rate === null || !sf) put(null, { key: "budget", label, detail: `wants ${want}/yr; asking rent not stated` });
      else {
        const annual = /mo/i.test(live?.rate_basis ?? "") ? rate * 12 : rate * sf;
        put(inRange(annual, req.budget_min, req.budget_max), {
          key: "budget",
          label,
          detail: `wants ${want}/yr; ~${fmtMoney(annual)}/yr asking`,
        });
      }
    } else {
      const label = "Price";
      const price = live?.asking_price ?? null;
      if (price === null) put(null, { key: "budget", label, detail: `wants ${want}; ${lane === "off_market" ? "not listed" : "price not stated"}` });
      else put(inRange(price, req.budget_min, req.budget_max), { key: "budget", label, detail: `wants ${want}; asking ${fmtMoney(price)}` });
    }
  }

  // 6–9. Investment criteria — only judged on the buy side.
  if (buySide) {
    if (req.cap_rate_min !== null) {
      const label = "Cap rate";
      let cap = live?.cap_rate ?? null;
      if (cap === null && live?.noi && live?.asking_price) cap = Math.round((live.noi / live.asking_price) * 10000) / 100;
      if (cap === null) put(null, { key: "cap_rate", label, detail: `wants ${req.cap_rate_min}%+; cap rate not stated` });
      else put(cap >= req.cap_rate_min, { key: "cap_rate", label, detail: `wants ${req.cap_rate_min}%+; ${cap}%` });
    }
    if (req.tenancy_types?.length) {
      const label = "Tenancy";
      const t = live?.tenancy_type ?? null;
      if (!t) put(null, { key: "tenancy", label, detail: `wants ${req.tenancy_types.join("/")}; not stated` });
      else put(req.tenancy_types.includes(t), { key: "tenancy", label, detail: `wants ${req.tenancy_types.join("/")}; ${t}` });
    }
    if (req.credit_floor) {
      const label = "Tenant credit";
      const c = live?.tenant_credit ?? null;
      if (!c) put(null, { key: "credit", label, detail: `wants ${req.credit_floor} or better; not stated` });
      else put((CREDIT_RANK[c] ?? 0) >= (CREDIT_RANK[req.credit_floor] ?? 0), { key: "credit", label, detail: `wants ${req.credit_floor} or better; ${c}` });
    }
    if (req.min_term_years !== null) {
      const label = "Lease term left";
      const y = live?.term_remaining_years ?? null;
      if (y === null) put(null, { key: "term", label, detail: `wants ${req.min_term_years}+ yrs; not stated` });
      else put(y >= req.min_term_years, { key: "term", label, detail: `wants ${req.min_term_years}+ yrs; ${y} yrs` });
    }
  }

  const known = met.length + missed.length;
  const score = known ? met.length / known : null;
  const paused = req.status === "on_hold";
  const gateMissed = missed.some((c) => c.key === "asset_class" || c.key === "market");
  const strong = !paused && known >= 2 && score !== null && score >= 0.5 && !gateMissed;

  let exchange_note: string | null = null;
  if (req.exchange_1031) {
    const parts: string[] = [];
    if (req.exchange_identify_by) parts.push(`identify by ${req.exchange_identify_by} (${daysBetween(today, req.exchange_identify_by)} days)`);
    if (req.exchange_close_by) parts.push(`close by ${req.exchange_close_by} (${daysBetween(today, req.exchange_close_by)} days)`);
    exchange_note = `1031 buyer${parts.length ? ": " + parts.join(", ") : ""}`;
  }

  return {
    requirement_id: req.id,
    property_id: prop.id,
    lane,
    listing_type: lt,
    score,
    pct: score === null ? null : Math.round(score * 100),
    met,
    missed,
    unknown,
    strong,
    paused,
    exchange_note,
  };
}

/** Strong first, then by score, then most criteria known. */
export function compareMatches(a: MatchResult, b: MatchResult): number {
  if (a.strong !== b.strong) return a.strong ? -1 : 1;
  if (a.paused !== b.paused) return a.paused ? 1 : -1;
  const sa = a.score ?? -1;
  const sb = b.score ?? -1;
  if (sa !== sb) return sb - sa;
  return b.met.length + b.missed.length - (a.met.length + a.missed.length);
}
