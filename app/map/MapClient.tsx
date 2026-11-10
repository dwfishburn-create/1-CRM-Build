"use client";

import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import "leaflet-draw/dist/leaflet.draw.css";
import type { Map as LeafletMap, FeatureGroup, LayerGroup, CircleMarker } from "leaflet";
import { withinPolygon } from "@/lib/geo";
import { saveTerritory, deleteTerritory } from "./actions";
import type { MapProperty, SavedPolygonRow, ProjectOption } from "./page";
import { LAYERS, LAYER_BY_KEY, layerForDeal, isCurrentProject, type LayerKey } from "@/lib/mapLayers";

// Mapbox Satellite Streets — the Property Survey Map Standard's default
// basemap (big-box POI labels at street zoom). The public pk token lives in
// the NEXT_PUBLIC_MAPBOX_TOKEN env var (Vercel), not in the repo; without it
// the map falls back to Esri imagery, per the standard's fallback rule.
const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";
const MAPBOX_URL = `https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/tiles/256/{z}/{x}/{y}@2x?access_token=${MAPBOX_TOKEN}`;

function esc(v: string | number | null | undefined): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const LINK_STATUS_LABEL: Record<string, string> = {
  candidate: "candidate",
  toured: "toured",
  selected: "selected",
  rejected: "rejected",
};

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
  const [layerFilter, setLayerFilter] = useState<Record<LayerKey, boolean>>(
    () => Object.fromEntries(LAYERS.map((l) => [l.key, l.defaultOn])) as Record<LayerKey, boolean>
  );
  const [legendOpen, setLegendOpen] = useState(true);
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

      const map = L.map(mapDivRef.current, { zoomControl: true, preferCanvas: true }).setView(
        OMAHA_CENTER,
        11
      );

      // Mapbox Satellite Streets by default (Survey Map Standard), with Esri
      // imagery + labels as a switchable fallback.
      const mapbox = L.tileLayer(MAPBOX_URL, {
        maxZoom: 20,
        tileSize: 256,
        attribution: "© Mapbox © OpenStreetMap",
      });
      const esri = L.layerGroup([
        L.tileLayer(
          "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
          { maxZoom: 19, attribution: "Esri" }
        ),
        L.tileLayer(
          "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
          { maxZoom: 19, opacity: 0.85 }
        ),
      ]);
      if (MAPBOX_TOKEN) {
        mapbox.addTo(map);
        L.control
          .layers({ "Satellite Streets (Mapbox)": mapbox, "Esri imagery": esri }, undefined, {
            position: "bottomleft",
          })
          .addTo(map);
      } else {
        esri.addTo(map);
      }

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

        // Show the property if any of its layers is on; color by the
        // highest-priority layer that's on.
        const visible = (p.layers ?? ["other"]).filter((k) => layerFilter[k]);
        if (!visible.length) continue;
        const layer = LAYER_BY_KEY[visible[0]];
        const fill = layer.key === "other" ? STATUS_COLOR[status] ?? layer.color : layer.color;

        const marker = L.circleMarker([p.latitude, p.longitude], {
          radius: layer.historical ? 6 : 7,
          color: "#111827",
          weight: 1,
          dashArray: layer.historical ? "2 2" : undefined,
          fillColor: fill,
          fillOpacity: layer.historical ? 0.7 : 0.9,
        });

        const dealLines = (p.deals ?? [])
          .map((d) => {
            const lk = layerForDeal(d);
            const tag = isCurrentProject(d.project_status) ? "current" : "historical";
            const sw = lk ? LAYER_BY_KEY[lk].color : "#9ca3af";
            return `<div><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${sw};margin-right:4px"></span><a href="/projects/${esc(d.project_id)}" style="text-decoration:underline">${esc(d.project_code)}</a> · ${esc(tag)}${
              d.link_status && d.link_status !== "selected" ? ` · ${esc(LINK_STATUS_LABEL[d.link_status] ?? d.link_status)}` : ""
            }</div>`;
          })
          .join("");
        const ownerLine = (p.owners ?? []).length
          ? `<div><b>Owner:</b> ${(p.owners ?? [])
              .map((o) => esc(o.name) + (o.is_current ? "" : " (former)"))
              .join("; ")}</div>`
          : `<div><b>Owner:</b> <i>not linked</i></div>`;
        const compLines = (p.comps ?? [])
          .map((c) => `<div>${c.kind === "sale" ? "Sold" : "Leased"} ${esc(c.date ?? "")} · ${esc(c.summary)}</div>`)
          .join("");
        const linkLines = (p.links ?? [])
          .map((l) =>
            l.url
              ? `<div><a href="${esc(l.url)}" target="_blank" rel="noopener" style="text-decoration:underline">${esc(l.label)} →</a></div>`
              : ""
          )
          .join("");
        const priorityLine = p.priority ? `<div>Priority: ${esc(p.priority)}</div>` : "";
        const notesLine = p.notes
          ? `<div style="margin-top:4px;color:#4b5563">${esc(p.notes.slice(0, 160))}${p.notes.length > 160 ? "…" : ""}</div>`
          : "";
        marker.bindPopup(
          `<div style="min-width:240px;max-width:320px;color:#111827">
            <div style="font-weight:600"><a href="/properties/${esc(p.id)}" style="text-decoration:underline">${esc(p.display_code ?? "—")}</a> · ${esc(p.address)}${
              p.suite_number ? ` Ste ${esc(p.suite_number)}` : ""
            }</div>
            <div>${esc([p.city, p.state].filter(Boolean).join(", "))}</div>
            <div>${esc(p.property_type ?? "—")}${p.building_sf ? ` · ${p.building_sf.toLocaleString()} SF` : ""}${
              p.land_acres ? ` · ${p.land_acres} ac` : ""
            }</div>
            <div>Research: ${esc(STATUS_LABEL[status] ?? status)} · Market: ${esc(p.market_status ?? "—")}</div>
            ${ownerLine}
            ${dealLines ? `<div style="margin-top:4px"><b>Deals</b>${dealLines}</div>` : ""}
            ${compLines ? `<div style="margin-top:4px"><b>Comps</b>${compLines}</div>` : ""}
            ${linkLines ? `<div style="margin-top:4px">${linkLines}</div>` : ""}
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
  }, [mapReady, properties, statusFilter, layerFilter]);

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

        {/* Layer toggles + research-status filter, overlaid top-left so the
            map itself stays maximized (11/10/2026: every touched property is
            reachable by a toggle; current vs. historical by color). */}
        <div className="absolute top-3 left-14 z-[1000] bg-white/95 text-gray-900 rounded-lg shadow p-3 text-xs space-y-1 max-h-[calc(100%-24px)] overflow-y-auto w-64"
          style={{ color: "#111827", colorScheme: "light" }}>
          <div className="flex items-center justify-between">
            <div className="font-semibold text-sm">Layers</div>
            <button onClick={() => setLegendOpen((o) => !o)} className="text-gray-400 hover:text-black">
              {legendOpen ? "Hide" : "Show"}
            </button>
          </div>
          {legendOpen && (
            <>
              {LAYERS.map((l) => {
                const count = properties.filter(
                  (p) => p.latitude != null && (p.layers ?? ["other"]).includes(l.key)
                ).length;
                return (
                  <label key={l.key} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={layerFilter[l.key]}
                      onChange={(e) => setLayerFilter((f) => ({ ...f, [l.key]: e.target.checked }))}
                    />
                    <span
                      className="inline-block w-3 h-3 rounded-full border border-gray-800 shrink-0"
                      style={{
                        backgroundColor: l.color,
                        borderStyle: l.historical ? "dashed" : "solid",
                      }}
                    />
                    <span className="flex-1">{l.label}</span>
                    <span className="text-gray-400">{count}</span>
                  </label>
                );
              })}
              <div className="flex gap-2 pt-1">
                <button
                  className="underline text-gray-500"
                  onClick={() =>
                    setLayerFilter(Object.fromEntries(LAYERS.map((l) => [l.key, true])) as Record<LayerKey, boolean>)
                  }
                >
                  All
                </button>
                <button
                  className="underline text-gray-500"
                  onClick={() =>
                    setLayerFilter(Object.fromEntries(LAYERS.map((l) => [l.key, l.defaultOn])) as Record<LayerKey, boolean>)
                  }
                >
                  Defaults
                </button>
              </div>
              <div className="font-semibold text-sm pt-2">Owner research</div>
              {(["confirmed", "partial", "unresearched"] as StatusKey[]).map((key) => (
                <label key={key} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={statusFilter[key]}
                    onChange={(e) => setStatusFilter((f) => ({ ...f, [key]: e.target.checked }))}
                  />
                  <span
                    className="inline-block w-3 h-3 rounded-full border border-gray-800"
                    style={{ backgroundColor: STATUS_COLOR[key] }}
                  />
                  {STATUS_LABEL[key]}
                </label>
              ))}
              <div className="text-gray-400 pt-1">
                {properties.filter((p) => p.latitude == null).length} properties have no map pin yet (not geocoded).
              </div>
            </>
          )}
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
