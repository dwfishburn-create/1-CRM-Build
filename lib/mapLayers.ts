// Property Survey Map — layer classification for the in-app /map hub.
//
// 11/10/2026 (Retail Listing Intake & Matching design, section 6a): Dan's
// standing rule — anything we touch and work out goes on the map, reachable
// by a toggle — with current vs. historical shown by color. This file is the
// single place that decides which layer(s) a property belongs to, so the map,
// its legend and any future export agree.
//
// "Current" vs. "historical" is derived, never hand-set: a deal is current
// while its project is active or on hold, historical once it's closed (won or
// lost). Families come from lib/projectTypes.ts.

import { splitProjectType, PROJECT_TYPE_FAMILY, type ProjectTypeCode } from "./projectTypes";

export type LayerKey =
  | "listing_current"
  | "listing_historical"
  | "rep_current"
  | "rep_historical"
  | "investigated_current"
  | "investigated_historical"
  | "renewal_current"
  | "renewal_historical"
  | "advisory"
  | "market"
  | "comps"
  | "realnex"
  | "other";

export type LayerGroupKey =
  | "listing"
  | "rep"
  | "investigated"
  | "renewal"
  | "advisory"
  | "market"
  | "comps"
  | "realnex"
  | "other";

export type LayerDef = {
  key: LayerKey;
  group: LayerGroupKey;
  label: string;
  color: string;
  historical: boolean;
  defaultOn: boolean;
};

// Colors follow Dan's timeline palette where it maps naturally (coral =
// closing/target, teal = executed, purple = sent/in play, blue = calls, amber
// = deadlines/attention, gray = past). Historical = the same hue, lighter,
// with a dashed outline.
export const LAYERS: LayerDef[] = [
  { key: "listing_current", group: "listing", label: "My listings — current", color: "#ea580c", historical: false, defaultOn: true },
  { key: "listing_historical", group: "listing", label: "My listings — historical", color: "#fdba74", historical: true, defaultOn: false },
  { key: "rep_current", group: "rep", label: "Tenant/Buyer Rep deals — current", color: "#0d9488", historical: false, defaultOn: true },
  { key: "rep_historical", group: "rep", label: "Tenant/Buyer Rep deals — historical", color: "#5eead4", historical: true, defaultOn: false },
  { key: "investigated_current", group: "investigated", label: "Investigated for clients — current searches", color: "#7c3aed", historical: false, defaultOn: false },
  { key: "investigated_historical", group: "investigated", label: "Investigated for clients — past searches", color: "#c4b5fd", historical: true, defaultOn: false },
  { key: "renewal_current", group: "renewal", label: "Renewals — current", color: "#2563eb", historical: false, defaultOn: false },
  { key: "renewal_historical", group: "renewal", label: "Renewals — historical", color: "#93c5fd", historical: true, defaultOn: false },
  { key: "advisory", group: "advisory", label: "BOVs / advisory", color: "#be185d", historical: false, defaultOn: false },
  { key: "market", group: "market", label: "Market listings (on market)", color: "#d97706", historical: false, defaultOn: true },
  { key: "comps", group: "comps", label: "Comps (sale / lease)", color: "#334155", historical: false, defaultOn: false },
  { key: "realnex", group: "realnex", label: "RealNex properties (imported 11/10)", color: "#64748b", historical: false, defaultOn: false },
  { key: "other", group: "other", label: "Other researched properties", color: "#16a34a", historical: false, defaultOn: false },
];

export const LAYER_BY_KEY: Record<LayerKey, LayerDef> = Object.fromEntries(
  LAYERS.map((l) => [l.key, l])
) as Record<LayerKey, LayerDef>;

export type DealLink = {
  project_id: string;
  project_code: string;
  project_type: string | null;
  client_name: string | null;
  project_status: string | null; // active / on_hold / closed_won / closed_lost
  link_status: string | null; // project_properties.status: candidate / toured / selected / rejected
};

export function isCurrentProject(status: string | null | undefined): boolean {
  return status === "active" || status === "on_hold" || status == null;
}

/** Which family a project falls in; a compound type takes its first known code. */
export function projectFamily(projectType: string | null | undefined) {
  for (const c of splitProjectType(projectType)) {
    const f = PROJECT_TYPE_FAMILY[c as ProjectTypeCode];
    if (f) return f;
  }
  return null;
}

/** The layer one deal link puts its property on. */
export function layerForDeal(d: DealLink): LayerKey | null {
  const family = projectFamily(d.project_type);
  const current = isCurrentProject(d.project_status);
  switch (family) {
    case "listing":
      return current ? "listing_current" : "listing_historical";
    case "renewal":
      return current ? "renewal_current" : "renewal_historical";
    case "advisory":
      return "advisory";
    case "search":
      // The site a rep deal is about = the selected property; every other
      // candidate on that search is "investigated for clients".
      if (d.link_status === "selected") return current ? "rep_current" : "rep_historical";
      return current ? "investigated_current" : "investigated_historical";
    default:
      return null;
  }
}

/**
 * All layers a property belongs to, in display-priority order (first one
 * decides the marker color). Properties with no deal, no market status and no
 * comp land on "other" so nothing touched is ever unreachable.
 */
export function layersForProperty(input: {
  deals: DealLink[];
  market_status: string | null;
  hasComp: boolean;
  source_system?: string | null;
}): LayerKey[] {
  const set = new Set<LayerKey>();
  for (const d of input.deals) {
    const l = layerForDeal(d);
    if (l) set.add(l);
  }
  if (input.market_status === "on_market") set.add("market");
  if (input.hasComp) set.add("comps");
  // Imported RealNex rows Dan hasn't worked yet get their own toggle (off by
  // default) so ~3,800 pins don't bury his own deals.
  if (set.size === 0) set.add(input.source_system === "realnex" ? "realnex" : "other");
  return LAYERS.map((l) => l.key).filter((k) => set.has(k));
}
