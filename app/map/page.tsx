import { supabase } from "@/lib/supabase";
import MapClient from "./MapClient";
import { layersForProperty, type DealLink, type LayerKey } from "@/lib/mapLayers";

export const dynamic = "force-dynamic";

export type MapProperty = {
  id: string;
  display_code: string | null;
  address: string;
  city: string | null;
  state: string | null;
  property_type: string | null;
  building_sf: number | null;
  land_acres: number | null;
  research_status: string | null;
  market_status: string | null;
  priority: string | null;
  notes: string | null;
  latitude: number | null;
  longitude: number | null;
  parent_property_id?: string | null;
  suite_number?: string | null;
  source_system?: string | null;
  // Derived server-side for the 11/10/2026 map hub (lib/mapLayers.ts).
  layers?: LayerKey[];
  deals?: DealLink[];
  owners?: { name: string; is_current: boolean }[];
  comps?: { kind: "sale" | "lease"; date: string | null; summary: string }[];
  links?: { label: string; url: string | null }[];
};

export type SavedPolygonRow = {
  id: string;
  name: string;
  geojson: { type: "Polygon"; coordinates: [number, number][][] };
  project_id: string | null;
  notes: string | null;
  project: { project_code: string; client_name: string } | { project_code: string; client_name: string }[] | null;
};

export type ProjectOption = {
  id: string;
  project_code: string;
  client_name: string;
};

// Live in-app map screen — roadmap item 7 (research-status markers +
// polygon/territory tool). See CRM_Requirements_and_Decisions_Log.md,
// 8/20/2026 decisions and the 8/26/2026 "Property map feature split"
// (this is a live screen, not a one-off Claude-built file — see the
// Property Survey — HTML Map Standard for that other, client-facing kind
// of map). Server component fetches everything once; MapClient (a client
// component) owns the Leaflet map, the draw tool, and all filtering.
// PostgREST caps a select at 1,000 rows; the map needs every touched
// property (RealNex adds ~3,000), so page through.
async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<{ data: T[]; error: string | null }> {
  const pageSize = 1000;
  const out: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build(from, from + pageSize - 1);
    if (error) return { data: out, error: error.message };
    out.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
  }
  return { data: out, error: null };
}

type DealRow = {
  property_id: string;
  status: string | null;
  project: { id: string; project_code: string; project_type: string | null; client_name: string | null; status: string | null } | null;
};
type OwnerRow = { property_id: string; is_current: boolean; entity: { name: string } | null };
type SaleCompRow = { property_id: string; sale_date: string | null; sale_price: number | null; price_per_sf: number | null; cap_rate: number | null };
type LeaseCompRow = { property_id: string; lease_date: string | null; tenant: string | null; sf: number | null; final_rent: number | null; asking_rent: number | null };
type LinkRow = { property_id: string; label: string; url: string | null };

function money(n: number | null | undefined) {
  return n == null ? null : `$${Math.round(n).toLocaleString()}`;
}

export default async function MapPage() {
  const [props, deals, owners, saleComps, leaseComps, links, { data: savedPolygons }, { data: projects }] =
    await Promise.all([
      fetchAll<MapProperty>((a, b) =>
        supabase
          .from("properties")
          .select(
            "id, display_code, address, city, state, property_type, building_sf, land_acres, research_status, market_status, priority, notes, latitude, longitude, parent_property_id, suite_number, source_system"
          )
          .order("address", { ascending: true })
          .range(a, b)
          .returns<MapProperty[]>()
      ),
      fetchAll<DealRow>((a, b) =>
        supabase
          .from("project_properties")
          .select("property_id, status, project:projects(id, project_code, project_type, client_name, status)")
          .range(a, b)
          .returns<DealRow[]>()
      ),
      fetchAll<OwnerRow>((a, b) =>
        supabase
          .from("property_owner")
          .select("property_id, is_current, entity:entities(name)")
          .range(a, b)
          .returns<OwnerRow[]>()
      ),
      fetchAll<SaleCompRow>((a, b) =>
        supabase
          .from("sale_comps")
          .select("property_id, sale_date, sale_price, price_per_sf, cap_rate")
          .not("property_id", "is", null)
          .range(a, b)
          .returns<SaleCompRow[]>()
      ),
      fetchAll<LeaseCompRow>((a, b) =>
        supabase
          .from("lease_comps")
          .select("property_id, lease_date, tenant, sf, final_rent, asking_rent")
          .not("property_id", "is", null)
          .range(a, b)
          .returns<LeaseCompRow[]>()
      ),
      fetchAll<LinkRow>((a, b) =>
        supabase
          .from("reference_links")
          .select("property_id, label, url")
          .not("property_id", "is", null)
          .range(a, b)
          .returns<LinkRow[]>()
      ),
      supabase
        .from("saved_polygons")
        .select("id, name, geojson, project_id, notes, project:projects(project_code, client_name)")
        .order("name", { ascending: true })
        .returns<SavedPolygonRow[]>(),
      supabase
        .from("projects")
        .select("id, project_code, client_name")
        .order("project_code", { ascending: true })
        .returns<ProjectOption[]>(),
    ]);

  const group = <T extends { property_id: string }>(rows: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) {
      const list = m.get(r.property_id) ?? [];
      list.push(r);
      m.set(r.property_id, list);
    }
    return m;
  };
  const dealsBy = group(deals.data);
  const ownersBy = group(owners.data);
  const saleBy = group(saleComps.data);
  const leaseBy = group(leaseComps.data);
  const linksBy = group(links.data);

  // A space (suite) inherits its parent building's pin when it has none of
  // its own, and its deals also show on the parent so nothing hides behind a
  // missing geocode.
  const byId = new Map(props.data.map((p) => [p.id, p]));

  const properties: MapProperty[] = props.data.map((p) => {
    const parent = p.parent_property_id ? byId.get(p.parent_property_id) : undefined;
    const d: DealLink[] = (dealsBy.get(p.id) ?? [])
      .filter((r) => r.project)
      .map((r) => ({
        project_id: r.project!.id,
        project_code: r.project!.project_code,
        project_type: r.project!.project_type,
        client_name: r.project!.client_name,
        project_status: r.project!.status,
        link_status: r.status,
      }));
    const comps = [
      ...(saleBy.get(p.id) ?? []).map((c) => ({
        kind: "sale" as const,
        date: c.sale_date,
        summary: [money(c.sale_price), c.price_per_sf ? `$${c.price_per_sf}/SF` : null, c.cap_rate ? `${c.cap_rate}% cap` : null]
          .filter(Boolean)
          .join(" · ") || "Sale (price unknown)",
      })),
      ...(leaseBy.get(p.id) ?? []).map((c) => ({
        kind: "lease" as const,
        date: c.lease_date,
        summary: [c.tenant, c.sf ? `${c.sf.toLocaleString()} SF` : null, c.final_rent ?? c.asking_rent ? `$${c.final_rent ?? c.asking_rent}/SF` : null]
          .filter(Boolean)
          .join(" · ") || "Lease",
      })),
    ];
    return {
      ...p,
      // Cards show ~160 chars; don't ship RealNex's long notes for ~4,000 pins.
      notes: p.notes ? p.notes.slice(0, 240) : null,
      latitude: p.latitude ?? parent?.latitude ?? null,
      longitude: p.longitude ?? parent?.longitude ?? null,
      deals: d,
      owners: (ownersBy.get(p.id) ?? [])
        .filter((o) => o.entity)
        .map((o) => ({ name: o.entity!.name, is_current: o.is_current })),
      comps,
      links: (linksBy.get(p.id) ?? []).map((l) => ({ label: l.label, url: l.url })),
      layers: layersForProperty({ deals: d, market_status: p.market_status, hasComp: comps.length > 0, source_system: p.source_system }),
    };
  });

  const ownerLinkedPropertyIds = Array.from(new Set(owners.data.map((r) => r.property_id)));
  const loadError =
    [props, deals, owners, saleComps, leaseComps, links].map((r) => r.error).find(Boolean) ?? null;

  return (
    <MapClient
      properties={properties}
      loadError={loadError}
      savedPolygons={savedPolygons ?? []}
      projects={projects ?? []}
      ownerLinkedPropertyIds={ownerLinkedPropertyIds}
    />
  );
}
