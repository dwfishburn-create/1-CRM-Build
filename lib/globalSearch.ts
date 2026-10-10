// Global search (10/10/2026) — the box in the top menu and the /search page.
//
// One query, five record types: contacts, companies (entities), properties,
// deals (projects) and requirements. Every match runs through the 017 SQL
// matcher (search_*_ids, which wrap search_ids_generic) — the same functions
// find_contact / find_entity / find_property and the duplicate check use.
// Nothing here re-implements matching; that drift is the bug 017 fixed.
//
// Two things are done here rather than in SQL, both joins, not matching:
//   - a deal or requirement also matches through the company attached to it
//     (projects.client_entity_id, requirement_parties.entity_id), so a
//     company name finds that company's deals and requirements;
//   - results are re-ranked so a name that starts with the query beats one
//     that merely contains it. The SQL returns newest-first, which is right
//     for a list page and wrong for a lookup.
//
// v1 scope (Dan, 10/10/2026): records only. Activity-log text is v2. Tasks
// are deliberately not searched — they live on the Dashboard and Tasks page.
// The computed "archived" contact rank arrives with the RealNex import.
//
// Server-only: imports the secret-key client.

import { supabase } from "@/lib/supabase";
import { runSearch } from "@/lib/listQuery";
import {
  contactHref,
  entityHref,
  personName,
  projectHref,
  propertyHref,
  requirementHref,
  sf,
} from "@/lib/records";

export type SearchKind = "contact" | "entity" | "property" | "project" | "requirement";

export type SearchHit = {
  id: string;
  kind: SearchKind;
  code: string | null;
  title: string;
  context: string;
  href: string;
};

export type SearchGroup = {
  kind: SearchKind;
  label: string;
  hits: SearchHit[];
  /** Total matches in this group, which can exceed hits.length. */
  total: number;
};

export type SearchResults = {
  query: string;
  groups: SearchGroup[];
  /** Set when one group failed; the other groups still come back. */
  errors: string[];
};

const GROUP_LABELS: Record<SearchKind, string> = {
  contact: "Contacts",
  entity: "Companies",
  property: "Properties",
  project: "Deals",
  requirement: "Requirements",
};

const ORDER: SearchKind[] = ["contact", "entity", "property", "project", "requirement"];

const PROJECT_STATUS: Record<string, string> = {
  active: "Active",
  on_hold: "On hold",
  closed_won: "Closed — won",
  closed_lost: "Closed — lost",
};

export const MIN_QUERY = 2;
export const MAX_QUERY = 100;

export function cleanQuery(raw: string | null | undefined): string {
  return (raw ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_QUERY);
}

type Ids = { ids: string[]; count: number };

async function ids(
  fn:
    | "search_contact_ids"
    | "search_entity_ids"
    | "search_property_ids"
    | "search_project_ids"
    | "search_requirement_ids",
  q: string,
  limit: number
): Promise<Ids> {
  // runSearch is typed for the three 017 functions; the two added in 024
  // have the identical signature and payload.
  const r = await runSearch(
    (name, args) => supabase.rpc(name, args),
    fn as "search_entity_ids",
    { p_q: q, p_limit: limit, p_offset: 0 }
  );
  if ("error" in r) throw new Error(`${fn}: ${r.error}`);
  return r;
}

// Rank: the title starts with the whole query (0), a word in the title starts
// with it (1), the title contains it (2), anything else the matcher found (3).
// Ties keep the matcher's newest-first order.
function rank(hits: SearchHit[], q: string): SearchHit[] {
  const needle = q.toLowerCase();
  const score = (h: SearchHit) => {
    const t = `${h.title} ${h.code ?? ""}`.toLowerCase();
    if (t.startsWith(needle)) return 0;
    if (t.split(/[\s,·&/-]+/).some((w) => w.startsWith(needle))) return 1;
    if (t.includes(needle)) return 2;
    return 3;
  };
  return hits
    .map((h, i) => ({ h, i, s: score(h) }))
    .sort((a, b) => a.s - b.s || a.i - b.i)
    .map((x) => x.h);
}

function joinParts(parts: (string | null | undefined)[]): string {
  return parts.filter((p) => p && String(p).trim()).join(" · ");
}

async function entityNames(idList: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (idList.length === 0) return out;
  const { data, error } = await supabase
    .from("entities")
    .select("id, name")
    .in("id", idList);
  if (error) throw new Error(error.message);
  for (const e of data ?? []) out.set(e.id as string, e.name as string);
  return out;
}

async function searchContacts(q: string, limit: number): Promise<SearchGroup> {
  const r = await ids("search_contact_ids", q, limit);
  if (r.ids.length === 0) return { kind: "contact", label: GROUP_LABELS.contact, hits: [], total: r.count };
  const { data, error } = await supabase
    .from("contacts")
    .select("id, display_code, first_name, last_name, title, email, phone, mobile_phone, entity_id")
    .in("id", r.ids);
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  const names = await entityNames(
    rows.map((c) => c.entity_id as string | null).filter((x): x is string => !!x)
  );
  const byId = new Map(rows.map((c) => [c.id as string, c]));
  const hits: SearchHit[] = r.ids
    .map((id) => byId.get(id))
    .filter((c): c is NonNullable<typeof c> => !!c)
    .map((c) => ({
      id: c.id,
      kind: "contact" as const,
      code: c.display_code,
      title: personName(c),
      context: joinParts([
        c.entity_id ? names.get(c.entity_id) : null,
        c.title,
        c.phone || c.mobile_phone,
        c.email,
      ]),
      href: contactHref(c.id),
    }));
  return { kind: "contact", label: GROUP_LABELS.contact, hits: rank(hits, q), total: r.count };
}

async function searchEntities(
  q: string,
  limit: number
): Promise<{ group: SearchGroup; matchedIds: string[] }> {
  // Fetch a few extra ids so deals and requirements can match through more
  // companies than the dropdown shows.
  const r = await ids("search_entity_ids", q, Math.max(limit, 25));
  const shown = r.ids.slice(0, limit);
  if (shown.length === 0) {
    return {
      group: { kind: "entity", label: GROUP_LABELS.entity, hits: [], total: r.count },
      matchedIds: r.ids,
    };
  }
  const [{ data, error }, { data: deals, error: dealErr }, { data: aliases, error: aliasErr }] = await Promise.all([
    supabase
      .from("entities")
      .select("id, display_code, name, trade_name, entity_type, industry")
      .in("id", shown),
    supabase
      .from("projects")
      .select("client_entity_id")
      .in("client_entity_id", shown)
      .eq("status", "active"),
    supabase.from("entity_aliases").select("entity_id, alias").in("entity_id", shown),
  ]);
  if (error) throw new Error(error.message);
  if (dealErr) throw new Error(dealErr.message);
  if (aliasErr) throw new Error(aliasErr.message);
  const active = new Map<string, number>();
  for (const d of deals ?? []) {
    const k = d.client_entity_id as string;
    active.set(k, (active.get(k) ?? 0) + 1);
  }
  const needle = q.toLowerCase();
  const byId = new Map((data ?? []).map((e) => [e.id as string, e]));
  const hits: SearchHit[] = shown
    .map((id) => byId.get(id))
    .filter((e): e is NonNullable<typeof e> => !!e)
    .map((e) => {
      const n = active.get(e.id) ?? 0;
      // When the hit came through an alias (a d/b/a name filed as an alias),
      // say so — otherwise the result looks unrelated to what was typed.
      const nameHit =
        String(e.name).toLowerCase().includes(needle) ||
        String(e.trade_name ?? "").toLowerCase().includes(needle);
      const firstWord = needle.split(" ")[0];
      const alias = nameHit
        ? null
        : (aliases ?? []).find(
            (a) => a.entity_id === e.id && String(a.alias).toLowerCase().includes(firstWord)
          )?.alias ?? null;
      return {
        id: e.id,
        kind: "entity" as const,
        code: e.display_code,
        title: e.trade_name && e.trade_name !== e.name ? `${e.name} (${e.trade_name})` : e.name,
        context: joinParts([
          alias ? `aka ${alias}` : null,
          n > 0 ? `${n} active deal${n === 1 ? "" : "s"}` : null,
          e.industry,
          e.entity_type,
        ]),
        href: entityHref(e.id),
      };
    });
  return {
    group: { kind: "entity", label: GROUP_LABELS.entity, hits: rank(hits, q), total: r.count },
    matchedIds: r.ids,
  };
}

async function searchProperties(q: string, limit: number): Promise<SearchGroup> {
  const r = await ids("search_property_ids", q, limit);
  if (r.ids.length === 0) return { kind: "property", label: GROUP_LABELS.property, hits: [], total: r.count };
  const { data, error } = await supabase
    .from("properties")
    .select("id, display_code, address, suite_number, city, state, property_type, building_sf, parcel_number")
    .in("id", r.ids);
  if (error) throw new Error(error.message);
  const byId = new Map((data ?? []).map((p) => [p.id as string, p]));
  const hits: SearchHit[] = r.ids
    .map((id) => byId.get(id))
    .filter((p): p is NonNullable<typeof p> => !!p)
    .map((p) => ({
      id: p.id,
      kind: "property" as const,
      code: p.display_code,
      title: p.suite_number ? `${p.address} #${p.suite_number}` : p.address,
      context: joinParts([
        [p.city, p.state].filter(Boolean).join(", "),
        p.property_type,
        p.building_sf ? sf(p.building_sf) : null,
        p.parcel_number ? `APN ${p.parcel_number}` : null,
      ]),
      href: propertyHref(p.id),
    }));
  return { kind: "property", label: GROUP_LABELS.property, hits: rank(hits, q), total: r.count };
}

async function searchProjects(
  q: string,
  limit: number,
  entityIds: string[]
): Promise<SearchGroup> {
  const r = await ids("search_project_ids", q, limit);
  let viaEntity: string[] = [];
  if (entityIds.length > 0) {
    const { data, error } = await supabase
      .from("projects")
      .select("id")
      .in("client_entity_id", entityIds)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw new Error(error.message);
    viaEntity = (data ?? []).map((p) => p.id as string);
  }
  const all = [...new Set([...r.ids, ...viaEntity])];
  if (all.length === 0) return { kind: "project", label: GROUP_LABELS.project, hits: [], total: 0 };
  const { data, error } = await supabase
    .from("projects")
    .select("id, project_code, project_type, client_name, status, client_entity_id")
    .in("id", all);
  if (error) throw new Error(error.message);
  const byId = new Map((data ?? []).map((p) => [p.id as string, p]));
  const hits: SearchHit[] = all
    .map((id) => byId.get(id))
    .filter((p): p is NonNullable<typeof p> => !!p)
    .map((p) => ({
      id: p.id,
      kind: "project" as const,
      code: null,
      title: p.project_code,
      context: joinParts([p.client_name, PROJECT_STATUS[p.status as string] ?? p.status]),
      href: projectHref(p.id),
    }));
  // Active deals first, then the rank, so a closed 2021 deal doesn't bury
  // the live one.
  const ranked = rank(hits, q);
  const isActive = (h: SearchHit) => byId.get(h.id)?.status === "active";
  const ordered = [...ranked.filter(isActive), ...ranked.filter((h) => !isActive(h))];
  // The text matcher's count understates when matches also came through a
  // company; report the larger of the two honest numbers.
  return {
    kind: "project",
    label: GROUP_LABELS.project,
    hits: ordered.slice(0, limit),
    total: Math.max(r.count, all.length),
  };
}

async function searchRequirements(
  q: string,
  limit: number,
  entityIds: string[]
): Promise<SearchGroup> {
  const r = await ids("search_requirement_ids", q, limit);
  let viaEntity: string[] = [];
  if (entityIds.length > 0) {
    const { data, error } = await supabase
      .from("requirement_parties")
      .select("requirement_id")
      .in("entity_id", entityIds)
      .limit(limit * 2);
    if (error) throw new Error(error.message);
    viaEntity = (data ?? []).map((x) => x.requirement_id as string);
  }
  const all = [...new Set([...r.ids, ...viaEntity])];
  if (all.length === 0) return { kind: "requirement", label: GROUP_LABELS.requirement, hits: [], total: 0 };
  const [{ data, error }, { data: parties, error: partyErr }] = await Promise.all([
    supabase
      .from("requirements")
      .select("id, display_code, deal_type, property_type, size_min, size_max, target_location, status")
      .in("id", all),
    supabase
      .from("requirement_parties")
      .select("requirement_id, entity_id")
      .in("requirement_id", all)
      .not("entity_id", "is", null),
  ]);
  if (error) throw new Error(error.message);
  if (partyErr) throw new Error(partyErr.message);
  const names = await entityNames([...new Set((parties ?? []).map((p) => p.entity_id as string))]);
  const partyOf = new Map<string, string>();
  for (const p of parties ?? []) {
    const n = names.get(p.entity_id as string);
    if (n && !partyOf.has(p.requirement_id as string)) partyOf.set(p.requirement_id as string, n);
  }
  const byId = new Map((data ?? []).map((x) => [x.id as string, x]));
  const size = (min: number | null, max: number | null) =>
    min && max ? `${sf(min)}–${sf(max)}` : min ? `${sf(min)}+` : max ? `up to ${sf(max)}` : null;
  const hits: SearchHit[] = all
    .map((id) => byId.get(id))
    .filter((x): x is NonNullable<typeof x> => !!x)
    .map((x) => ({
      id: x.id,
      kind: "requirement" as const,
      code: x.display_code,
      title: partyOf.get(x.id) || joinParts([x.deal_type, x.property_type]) || "Requirement",
      context: joinParts([
        partyOf.has(x.id) ? joinParts([x.deal_type, x.property_type]) : null,
        size(x.size_min, x.size_max),
        x.target_location,
        x.status !== "active" ? x.status : null,
      ]),
      href: requirementHref(x.id),
    }));
  return {
    kind: "requirement",
    label: GROUP_LABELS.requirement,
    hits: rank(hits, q).slice(0, limit),
    total: Math.max(r.count, all.length),
  };
}

/**
 * Search everything. `perGroup` is 5 for the dropdown, 25 for /search.
 * A failure in one group is reported in `errors` and the other groups still
 * come back — a broken requirements query must not hide the contacts.
 */
export async function globalSearch(rawQuery: string, perGroup: number): Promise<SearchResults> {
  const query = cleanQuery(rawQuery);
  if (query.length < MIN_QUERY) return { query, groups: [], errors: [] };

  const limit = Math.min(Math.max(perGroup, 1), 25);
  const errors: string[] = [];
  const empty = (kind: SearchKind): SearchGroup => ({ kind, label: GROUP_LABELS[kind], hits: [], total: 0 });
  const safe = async <T,>(kind: SearchKind, p: Promise<T>, fallback: T): Promise<T> => {
    try {
      return await p;
    } catch (e) {
      errors.push(`${GROUP_LABELS[kind]}: ${e instanceof Error ? e.message : String(e)}`);
      return fallback;
    }
  };

  const [contacts, ent, properties] = await Promise.all([
    safe("contact", searchContacts(query, limit), empty("contact")),
    safe("entity", searchEntities(query, limit), { group: empty("entity"), matchedIds: [] as string[] }),
    safe("property", searchProperties(query, limit), empty("property")),
  ]);
  const [projects, requirements] = await Promise.all([
    safe("project", searchProjects(query, limit, ent.matchedIds), empty("project")),
    safe("requirement", searchRequirements(query, limit, ent.matchedIds), empty("requirement")),
  ]);

  const byKind: Record<SearchKind, SearchGroup> = {
    contact: contacts,
    entity: ent.group,
    property: properties,
    project: projects,
    requirement: requirements,
  };
  return {
    query,
    groups: ORDER.map((k) => byKind[k]).filter((g) => g.hits.length > 0),
    errors,
  };
}
