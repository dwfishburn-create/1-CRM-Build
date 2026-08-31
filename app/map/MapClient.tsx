"use client";

import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import "leaflet-draw/dist/leaflet.draw.css";
import type { Map as LeafletMap, FeatureGroup, LayerGroup, CircleMarker } from "leaflet";
import { withinPolygon } from "@/lib/geo";
import { saveTerritory, deleteTerritory } from "./actions";
import type { MapProperty, SavedPolygonRow, ProjectOption } from "./page";

const OMAHA_CENTER: [number, number] = [41.2565, -95.9345];

// Matches the marker legend baked into properties.research_status's own
// check constraint comment (001_init_schema.sql): unresearched = gray,
// partial = yellow, confirmed = green.
const STATUS_COLOR: Record<string, string> = {
  unresearched: "#9ca3af",
  partial: "#f59e0b",
  confirmed: "#16a34a",
};

const STATUS_LABEL: Record<string, string> = {
  unresearched: "Unresearched",
  partial: "Partial",
  confirmed: "Confirmed",
};

type StatusKey = "unresearched" | "partial" | "confirmed";

function ring(geojson: SavedPolygonRow["geojson"]): [number, number][] {
  return geojson.coordinates[0];
}

function oneProject(
  p: SavedPolygonRow["project"]
): { project_code: string; client_name: string } | null {
  if (!p) return null;
  return Array.isArray(p) ? p[0] ?? null : p;
}

function csvEscape(value: string | number | null | undefined): string {
  const s = value === null || value === undefined ? "" : String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function exportCsv(rows: MapProperty[], ownerLinked: Set<string>) {
  const header = [
    "Code",
    "Address",
    "City",
    "State",
    "Type",
    "Building SF",
    "Land Acres",
    "Research Status",
    "Market Status",
    "Priority",
    "Owner Linked",
    "Notes",
  ];
  const lines = [header.join(",")];
  for (const p of rows) {
    lines.push(
      [
        csvEscape(p.display_code),
        csvEscape(p.address),
        csvEscape(p.city),
        csvEscape(p.state),
        csvEscape(p.property_type),
        csvEscape(p.building_sf),
        csvEscape(p.land_acres),
        csvEscape(p.research_status ?? "unresearched"),
        csvEscape(p.market_status),
        csvEscape(p.priority),
        csvEscape(ownerLinked.has(p.id) ? "Yes" : "No"),
        csvEscape(p.notes),
      ].join(",")
    );
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `territory-export-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function MapClient({
  properties,
  loadError,
  savedPolygons,
  projects,
  ownerLinkedPropertyIds,
}: {
  properties: MapProperty[];
  loadError: string | null;
  savedPolygons: SavedPolygonRow[];
  projects: ProjectOption[];
  ownerLinkedPropertyIds: string[];
}) {
  const mapDivRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const drawnItemsRef = useRef<FeatureGroup | null>(null);
  const markerLayerRef = useRef<LayerGroup | null>(null);
  const markersByStatusRef = useRef<Record<string, CircleMarker[]>>({});

  const [mapReady, setMapReady] = useState(false);
  const [statusFilter, setStatusFilter] = useState<Record<StatusKey, boolean>>({
    unresearched: true,
    partial: true,
    confirmed: true,
  });
  const [activeRing, setActiveRing] = useState<[number, number][] | null>(null);
  const [zoneName, setZoneName] = useState("");
  const [zoneProjectId, setZoneProjectId] = useState("");
  const [zoneNotes, setZoneNotes] = useState("");
  const [editingZoneId, setEditingZoneId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);

  const ownerLinked = new Set(ownerLinkedPropertyIds);

  // ---- Map init (once) ------------------------------------------------
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const L = (await import("leaflet")).default;
      // leaflet-draw expects a global `L` to attach itself to.
      (window as unknown as { L: typeof L }).L = L;
      await import("leaflet-draw");

      if (cancelled || !mapDivRef.current || mapRef.current) return;

      const map = L.map(mapDivRef.current, { zoomControl: true }).setView(
        OMAHA_CENTER,
        11
      );

      // Esri World_Imagery satellite basemap + a light reference/label
      // overlay on top, per Dan's established Property Survey — HTML Map
      // Standard (same base map style, reused here for an in-app screen).
      L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        { maxZoom: 19, attribution: "Esri" }
      ).addTo(map);
      L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
        { maxZoom: 19, opacity: 0.85 }
      ).addTo(map);

      const drawnItems = new L.FeatureGroup();
      map.addLayer(drawnItems);
      drawnItemsRef.current = drawnItems;

      const drawControl = new (L.Control as unknown as {
        Draw: new (opts: unknown) => L.Control;
      }).Draw({
        draw: {
          polygon: {
            allowIntersection: false,
            showArea: true,
            shapeOptions: { color: "#2563eb", weight: 2 },
          },
          marker: false,
          circle: false,
          circlemarker: false,
          rectangle: false,
          polyline: false,
        },
        edit: { featureGroup: drawnItems, remove: true },
      });
      map.addControl(drawControl);

      map.on(
        (L as unknown as { Draw: { Event: { CREATED: string } } }).Draw.Event
          .CREATED,
        (e: unknown) => {
          const evt = e as { layer: L.Polygon };
          drawnItems.clearLayers();
          drawnItems.addLayer(evt.layer);
          const latlngs = (evt.layer.getLatLngs()[0] as L.LatLng[]).map(
            (ll): [number, number] => [ll.lng, ll.lat]
          );
          const closed: [number, number][] =
            latlngs.length && latlngs[0] !== latlngs[latlngs.length - 1]
              ? [...latlngs, latlngs[0]]
              : latlngs;
          setActiveRing(closed);
          setEditingZoneId(null);
          setZoneName("");
          setZoneNotes("");
          setZoneProjectId("");
        }
      );

      map.on(
        (L as unknown as { Draw: { Event: { DELETED: string } } }).Draw.Event
          .DELETED,
        () => {
          setActiveRing(null);
        }
      );

      mapRef.current = map;
      markerLayerRef.current = L.layerGroup().addTo(map);

      if (!cancelled) setMapReady(true);
    })();

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  // ---- Recompute markers when properties / status filter change -------
  useEffect(() => {
    if (!mapReady) return;
    let cancelled = false;

    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !markerLayerRef.current) return;

      markerLayerRef.current.clearLayers();
      markersByStatusRef.current = { unresearched: [], partial: [], confirmed: [] };

      for (const p of properties) {
        if (p.latitude == null || p.longitude == null) continue;
        const status = (p.research_status ?? "unresearched") as StatusKey;
        if (!statusFilter[status]) continue;

        const marker = L.circleMarker([p.latitude, p.longitude], {
          radius: 7,
          color: "#111827",
          weight: 1,
          fillColor: STATUS_COLOR[status] ?? "#9ca3af",
          fillOpacity: 0.9,
        });

        const priorityLine = p.priority ? `<div>Priority: ${p.priority}</div>` : "";
        const notesLine = p.notes
          ? `<div class="mt-1 text-gray-600">${p.notes.slice(0, 140)}${p.notes.length > 140 ? "…" : ""}</div>`
          : "";
        marker.bindPopup(
          `<div style="min-width:200px">
            <div style="font-weight:600">${p.display_code ?? "—"} · ${p.address}</div>
            <div>${[p.city, p.state].filter(Boolean).join(", ")}</div>
            <div>${p.property_type ?? "—"} ${
            p.building_sf ? `· ${p.building_sf.toLocaleString()} SF` : ""
          }${p.land_acres ? `· ${p.land_acres} ac` : ""}</div>
            <div>Research: ${STATUS_LABEL[status] ?? status} · Market: ${
            p.market_status ?? "—"
          }</div>
            <div>Owner linked: ${ownerLinked.has(p.id) ? "Yes" : "No"}</div>
            ${priorityLine}
            ${notesLine}
          </div>`
        );

        markerLayerRef.current.addLayer(marker);
        markersByStatusRef.current[status]?.push(marker);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, properties, statusFilter]);

  // ---- Matched properties are a pure derivation of the active ring ----
  const matched = activeRing ? withinPolygon(properties, activeRing) : null;

  async function loadSavedPolygon(sp: SavedPolygonRow) {
    if (!mapRef.current || !drawnItemsRef.current) return;
    const L = (await import("leaflet")).default;

    drawnItemsRef.current.clearLayers();
    const r = ring(sp.geojson);
    const latlngs = r.map(([lng, lat]) => L.latLng(lat, lng));
    const layer = L.polygon(latlngs, { color: "#2563eb", weight: 2 });
    drawnItemsRef.current.addLayer(layer);
    mapRef.current.fitBounds(layer.getBounds(), { padding: [24, 24] });

    setActiveRing(r);
    setEditingZoneId(sp.id);
    setZoneName(sp.name);
    setZoneProjectId(sp.project_id ?? "");
    setZoneNotes(sp.notes ?? "");
  }

  async function handleSave() {
    if (!activeRing) return;
    setSaving(true);
    setSaveError(null);
    try {
      await saveTerritory({
        id: editingZoneId ?? undefined,
        name: zoneName,
        geojson: { type: "Polygon", coordinates: [activeRing] },
        project_id: zoneProjectId || null,
        notes: zoneNotes || null,
      });
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    await deleteTerritory(id);
    if (editingZoneId === id) {
      setEditingZoneId(null);
      setActiveRing(null);
      drawnItemsRef.current?.clearLayers();
    }
  }

  return (
    <div className="flex h-[calc(100vh-65px)]">
      <div className="relative flex-1">
        <div ref={mapDivRef} className="absolute inset-0" />

        {/* Status legend / toggle, overlaid top-left so the map itself
            stays maximized. */}
        <div className="absolute top-3 left-3 z-[1000] bg-white/95 rounded-lg shadow p-3 text-sm space-y-1">
          <div className="font-semibold mb-1">Research status</div>
          {(["confirmed", "partial", "unresearched"] as StatusKey[]).map((key) => (
            <label key={key} className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={statusFilter[key]}
                onChange={(e) =>
                  setStatusFilter((f) => ({ ...f, [key]: e.target.checked }))
                }
              />
              <span
                className="inline-block w-3 h-3 rounded-full border border-gray-800"
                style={{ backgroundColor: STATUS_COLOR[key] }}
              />
              {STATUS_LABEL[key]}
            </label>
          ))}
        </div>

        {loadError && (
          <div className="absolute top-3 right-3 z-[1000] bg-red-50 text-red-700 text-sm rounded px-3 py-2 shadow">
            Error loading properties: {loadError}
          </div>
        )}

        {!panelOpen && (
          <button
            onClick={() => setPanelOpen(true)}
            className="absolute top-3 right-3 z-[1000] bg-white shadow rounded px-3 py-2 text-sm"
          >
            Show panel
          </button>
        )}
      </div>

      {panelOpen && (
        <div className="w-96 border-l border-gray-200 overflow-y-auto p-4 space-y-6">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-semibold">Map / Territories</h1>
            <button
              onClick={() => setPanelOpen(false)}
              className="text-gray-400 hover:text-black text-sm"
            >
              Hide
            </button>
          </div>

          <p className="text-xs text-gray-500">
            Draw a polygon on the map (use the polygon tool in the map&apos;s
            top-left controls) to pull every mapped property inside it, live
            against current research status and ownership.
          </p>

          {matched ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="font-medium">
                  {matched.length} propert{matched.length === 1 ? "y" : "ies"} in
                  polygon
                </div>
                <button
                  onClick={() => exportCsv(matched, ownerLinked)}
                  disabled={matched.length === 0}
                  className="text-xs bg-black text-white rounded px-2 py-1 disabled:opacity-40"
                >
                  Export CSV
                </button>
              </div>

              <div className="max-h-64 overflow-y-auto border border-gray-200 rounded divide-y">
                {matched.map((p) => (
                  <div key={p.id} className="p-2 text-xs">
                    <div className="font-medium">
                      {p.display_code ?? "—"} · {p.address}
                    </div>
                    <div className="text-gray-500">
                      {p.property_type ?? "—"} ·{" "}
                      {STATUS_LABEL[p.research_status ?? "unresearched"]}
                      {p.priority ? ` · Priority: ${p.priority}` : ""}
                      {ownerLinked.has(p.id) ? " · Owner linked" : ""}
                    </div>
                  </div>
                ))}
                {matched.length === 0 && (
                  <div className="p-2 text-xs text-gray-400">
                    No mapped properties fall inside this polygon.
                  </div>
                )}
              </div>

              <div className="border border-gray-200 rounded p-3 space-y-2">
                <div className="text-sm font-medium">
                  {editingZoneId ? "Update saved zone" : "Save as research zone"}
                </div>
                <input
                  value={zoneName}
                  onChange={(e) => setZoneName(e.target.value)}
                  placeholder="Zone name"
                  className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
                />
                <select
                  value={zoneProjectId}
                  onChange={(e) => setZoneProjectId(e.target.value)}
                  className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
                >
                  <option value="">No project (general research zone)</option>
                  {projects.map((pr) => (
                    <option key={pr.id} value={pr.id}>
                      {pr.project_code} · {pr.client_name}
                    </option>
                  ))}
                </select>
                <textarea
                  value={zoneNotes}
                  onChange={(e) => setZoneNotes(e.target.value)}
                  placeholder="Notes"
                  rows={2}
                  className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
                />
                {saveError && <p className="text-red-600 text-xs">{saveError}</p>}
                <button
                  onClick={handleSave}
                  disabled={saving || !zoneName.trim()}
                  className="bg-black text-white rounded px-3 py-1.5 text-sm disabled:opacity-40"
                >
                  {saving ? "Saving…" : editingZoneId ? "Update zone" : "Save zone"}
                </button>
              </div>
            </div>
          ) : (
            <div className="text-xs text-gray-400">
              No polygon drawn yet — draw one to see matching properties here.
            </div>
          )}

          <div>
            <div className="font-medium text-sm mb-2">Saved zones</div>
            <div className="space-y-1">
              {savedPolygons.map((sp) => {
                const proj = oneProject(sp.project);
                return (
                  <div
                    key={sp.id}
                    className="flex items-center justify-between border border-gray-200 rounded px-2 py-1.5 text-xs"
                  >
                    <button
                      onClick={() => loadSavedPolygon(sp)}
                      className="text-left flex-1 hover:underline"
                    >
                      <div className="font-medium">{sp.name}</div>
                      {proj && (
                        <div className="text-gray-500">
                          {proj.project_code} · {proj.client_name}
                        </div>
                      )}
                    </button>
                    <button
                      onClick={() => handleDelete(sp.id)}
                      className="text-red-500 hover:text-red-700 ml-2"
                    >
                      Remove
                    </button>
                  </div>
                );
              })}
              {savedPolygons.length === 0 && (
                <div className="text-xs text-gray-400">No saved zones yet.</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
