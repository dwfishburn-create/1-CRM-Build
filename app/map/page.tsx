import { supabase } from "@/lib/supabase";
import MapClient from "./MapClient";

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
export default async function MapPage() {
  const [{ data: properties, error: propError }, { data: savedPolygons }, { data: projects }, { data: ownerLinks }] =
    await Promise.all([
      supabase
        .from("properties")
        .select(
          "id, display_code, address, city, state, property_type, building_sf, land_acres, research_status, market_status, priority, notes, latitude, longitude"
        )
        .order("address", { ascending: true })
        .returns<MapProperty[]>(),
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
      supabase.from("property_owner").select("property_id"),
    ]);

  const ownerLinkedPropertyIds = Array.from(
    new Set((ownerLinks ?? []).map((r) => r.property_id as string))
  );

  return (
    <MapClient
      properties={properties ?? []}
      loadError={propError?.message ?? null}
      savedPolygons={savedPolygons ?? []}
      projects={projects ?? []}
      ownerLinkedPropertyIds={ownerLinkedPropertyIds}
    />
  );
}
