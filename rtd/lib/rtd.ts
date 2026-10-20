import { db } from "./supabase";
import { EXPANSION, FACILITY, marketLabel, sf } from "./search";

// Shapes and labels for RTD build session 2 (migration 029): claims, intel
// notes, proposals, the review queue and What's new.

export type Claim = { entity_id: string; holder: string; holder_is_me: boolean; since: string; auto: boolean };

export type Note = {
  id: string; author: string; mine: boolean; body: string; tags: string[]; created_at: string;
  status: "pending" | "accepted" | "rejected";
};

export type Change = {
  id?: string;
  at?: string;
  created_at?: string;
  kind: string;
  status?: string;
  author: string;
  reviewed_by?: string | null;
  old_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  payload: Record<string, unknown> | null;
  result_ref?: string | null;
  contact_name?: string | null;
};

export type BrandActivity = {
  me: { is_admin: boolean; display_name: string };
  claim: Claim | null;
  notes: Note[];
  pending: Change[];
  history: Change[];
  verified_by: string | null;
};

export type Match = { id: string; name: string; score: number; reason?: string; display_code?: string; email?: string };

export type QueueItem = {
  type: "note" | "change";
  id: string;
  kind: string;
  entity_id: string | null;
  brand: string;
  brand_code: string | null;
  requirement_code?: string | null;
  author: string;
  created_at: string;
  body?: string;
  tags?: string[];
  old_value?: Record<string, unknown> | null;
  new_value?: Record<string, unknown> | null;
  payload?: Record<string, unknown> | null;
  current?: Record<string, unknown> | null;
  conflicts?: string[];
  contact_name?: string | null;
  matches?: Match[];
};

export const NOTE_TAGS = [
  "Expanding", "Not expanding", "Closing stores", "Looking here", "Signed a deal", "New contact", "Talked to them",
];

export const KIND_LABEL: Record<string, string> = {
  note: "Intel note",
  brand_edit: "Profile edit",
  verify: "Confirmed current",
  new_contact: "New contact",
  contact_update: "Contact update",
  contact_left: "Contact gone",
  new_brand: "New brand",
  claim: "Claimed",
  release: "Released claim",
  verified: "Confirmed current",
  edit: "Profile edit",
  expanding: "Now expanding",
  requirement: "Requirement",
  requirement_edit: "Requirement update",
  new_requirement: "New requirement",
  requirement_update: "Requirement update",
};

export const FIELD_LABEL: Record<string, string> = {
  category: "Category",
  category_detail: "Category detail",
  size_min_sf: "Size min (SF)",
  size_max_sf: "Size max (SF)",
  frontage_min_ft: "Frontage min (ft)",
  drive_thru: "Drive-thru",
  facility_types: "Facility types",
  site_criteria: "Site criteria",
  operating_model: "Operating model",
  expansion_status: "Expansion",
  target_markets: "Target markets",
  website: "Website",
  first_name: "First name",
  last_name: "Last name",
  title: "Title",
  email: "Email",
  phone: "Phone",
  mobile_phone: "Mobile",
  role: "Role",
  name: "Name",
  note: "Note",
  party_name: "For",
  property_type: "Property type",
  deal_type: "Deal type",
  size_min: "Size min (SF)",
  size_max: "Size max (SF)",
  budget_min: "Budget min",
  budget_max: "Budget max",
  target_location: "Location",
  timeline: "Timeline",
  status: "Status",
  confidence: "Confidence",
  source_date: "Heard on",
  rtd_note: "Note",
  rtd_contact: "Who to call",
};

// Requirements (10/20/2026). Property and deal types are free text in the CRM;
// these are the suggestions the RTD forms offer.
export const PROPERTY_TYPES = ["Retail", "Office", "Industrial", "Flex", "Land", "Investment", "Multifamily", "Hospitality", "Medical", "Mixed use"];
export const DEAL_TYPES = ["Lease", "Buy", "Sell", "Sublease", "Build-to-suit", "Ground lease", "1031 Exchange"];
export const REQ_STATUS: Record<string, string> = { active: "Active", on_hold: "On hold", fulfilled: "Fulfilled", dead: "Dead" };
export const CONFIDENCE: Record<string, string> = { high: "High", medium: "Medium", low: "Low" };

export type Requirement = {
  id: string; display_code: string; party: string; entity_id: string | null; is_brand: boolean;
  deal_type: string | null; property_type: string | null; size_min: number | null; size_max: number | null;
  budget_min: number | null; budget_max: number | null; target_location: string | null; target_markets: string[];
  timeline: string | null; status: string; confidence: string | null; source_date: string | null;
  reconfirm_date: string | null; rtd_note: string | null; rtd_contact: string | null; added_by: string | null;
  shared_at: string | null; updated_at: string; pending_updates: number; total_count: number;
};

export function money(n: number | null | undefined): string {
  if (n == null) return "";
  const v = Number(n);
  if (v >= 1_000_000) return `$${(v / 1_000_000).toLocaleString("en-US", { maximumFractionDigits: 2 })}M`;
  return `$${v.toLocaleString("en-US")}`;
}

export function budgetRange(min: number | null, max: number | null): string {
  if (min == null && max == null) return "";
  if (min == null) return `up to ${money(max)}`;
  if (max == null) return `${money(min)}+`;
  return min === max ? money(min) : `${money(min)}–${money(max)}`;
}

/** Today in Omaha, YYYY-MM-DD. */
export function todayCentral(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
}

export const OPERATING: Record<string, string> = { corporate: "Corporate", franchise: "Franchise", both: "Corporate + franchise" };
export const DRIVE_THRU: Record<string, string> = { required: "Required", preferred: "Preferred", no: "No" };

/** A stored value, as a person reads it. */
export function showValue(field: string, v: unknown, categories?: Map<string, string>): string {
  if (v === null || v === undefined || v === "") return "—";
  if (Array.isArray(v)) {
    if (v.length === 0) return "None";
    if (field === "target_markets") return v.map((x) => marketLabel(String(x))).join(", ");
    if (field === "facility_types") return v.map((x) => FACILITY[String(x)] ?? String(x)).join(", ");
    return v.join(", ");
  }
  if (field === "size_min_sf" || field === "size_max_sf" || field === "frontage_min_ft" || field === "size_min" || field === "size_max") return sf(Number(v));
  if (field === "budget_min" || field === "budget_max") return money(Number(v));
  if (field === "status") return REQ_STATUS[String(v)] ?? String(v);
  if (field === "confidence") return CONFIDENCE[String(v)] ?? String(v);
  if (field === "source_date") return day(String(v));
  if (field === "expansion_status") return EXPANSION[String(v)] ?? String(v);
  if (field === "operating_model") return OPERATING[String(v)] ?? String(v);
  if (field === "drive_thru") return DRIVE_THRU[String(v)] ?? String(v);
  if (field === "category") return categories?.get(String(v)) ?? String(v);
  return String(v);
}

/** One line per changed field: "Size min (SF): 8,000 → 12,000". */
type Diffable = { kind: string; old_value?: Record<string, unknown> | null; new_value?: Record<string, unknown> | null; payload?: Record<string, unknown> | null };

export function changeLines(c: Diffable, categories?: Map<string, string>): string[] {
  if (c.kind === "brand_edit" || c.kind === "contact_update" || c.kind === "requirement_update") {
    return Object.keys(c.new_value ?? {}).map(
      (k) => `${FIELD_LABEL[k] ?? k}: ${showValue(k, c.old_value?.[k], categories)} → ${showValue(k, c.new_value?.[k], categories)}`
    );
  }
  if (c.kind === "new_contact" || c.kind === "new_brand" || c.kind === "new_requirement") {
    // Name is already in the headline; the rest in the usual field order.
    const order = Object.keys(FIELD_LABEL);
    return Object.entries(c.payload ?? {})
      .filter(([k]) => !["first_name", "last_name", "name", "party_name", "entity_id", "requirement_id"].includes(k))
      .filter(([, v]) => v !== null && v !== "" && v !== "unknown" && !(Array.isArray(v) && v.length === 0))
      .sort(([a], [b]) => order.indexOf(a) - order.indexOf(b))
      .map(([k, v]) => `${FIELD_LABEL[k] ?? k}: ${showValue(k, v, categories)}`);
  }
  const note = c.payload?.note;
  return note ? [String(note)] : [];
}

export function personName(p: Record<string, unknown> | null | undefined): string {
  return [p?.first_name, p?.last_name].filter(Boolean).join(" ") || "(no name)";
}

/** Headline for a proposal in a list. */
export function changeTitle(c: Change | QueueItem): string {
  switch (c.kind) {
    case "brand_edit": return "Edit the profile";
    case "verify": return "Confirm the profile is current";
    case "new_contact": return `Add ${personName(c.payload)}${c.payload?.title ? `, ${c.payload.title}` : ""}`;
    case "contact_update": return `Update ${c.contact_name || "a contact"}`;
    case "contact_left": return `${c.contact_name || "A contact"} is no longer there`;
    case "new_brand": return `Add brand ${String(c.payload?.name ?? "")}`;
    case "new_requirement": return `New requirement${c.payload?.party_name ? ` for ${String(c.payload.party_name)}` : ""}`;
    case "requirement_update": return "Update the requirement";
    case "claim": return "Claimed as a client";
    case "release": return "Released the claim";
    default: return KIND_LABEL[c.kind] ?? c.kind;
  }
}

export function when(ts: string | null | undefined): string {
  if (!ts) return "";
  return new Date(ts).toLocaleString("en-US", {
    timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

export function day(d: string | null | undefined): string {
  if (!d) return "";
  const dt = d.length === 10 ? new Date(d + "T12:00:00") : new Date(d);
  return dt.toLocaleDateString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", year: "numeric" });
}

/** "RTD: the minimum size is larger…" → "The minimum size is larger…". */
export function dbMessage(message: string): string {
  const m = message.replace(/^RTD:\s*/, "");
  return m.charAt(0).toUpperCase() + m.slice(1);
}

export async function claimsFor(ids: string[]): Promise<Map<string, Claim>> {
  const map = new Map<string, Claim>();
  if (ids.length === 0) return map;
  const supabase = await db();
  const { data } = await supabase.rpc("rtd_claims_for", { p_entity_ids: ids });
  for (const c of (data ?? []) as Claim[]) map.set(c.entity_id, c);
  return map;
}

export async function categoryMap(): Promise<Map<string, string>> {
  const supabase = await db();
  const { data } = await supabase.rpc("rtd_categories");
  return new Map(((data ?? []) as { code: string; label: string }[]).map((c) => [c.code, c.label]));
}

export async function reviewCount(): Promise<number> {
  const supabase = await db();
  const { data } = await supabase.rpc("rtd_review_count");
  return typeof data === "number" ? data : 0;
}

export async function reviewQueue(): Promise<{ items: QueueItem[]; error?: string }> {
  const supabase = await db();
  const { data, error } = await supabase.rpc("rtd_review_queue");
  if (error) return { items: [], error: dbMessage(error.message) };
  return { items: (data ?? []) as QueueItem[] };
}
