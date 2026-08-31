// Small geo-distance helper, shared by anything that needs "properties near
// this point" — the Opportunity Engine's radius-based v1 targeting (see the
// 8/30/2026 decision in CRM_Requirements_and_Decisions_Log.md: radius now,
// full polygon-drawing UI later as roadmap item 7) and, eventually, that
// polygon tool itself.
//
// pointInPolygon (below) is that polygon tool's membership check — added
// 8/30/2026 alongside the roadmap item 7 build.

const EARTH_RADIUS_MILES = 3958.8;

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Great-circle distance between two lat/long points, in miles. */
export function haversineMiles(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number }
): number {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Filter a list of geocoded rows down to those within `radiusMiles` of a
 * center point. Rows missing latitude/longitude are silently excluded (not
 * an error) — a caller doing an Opportunity Engine send should separately
 * check for un-geocoded rows near the trigger property, since those are the
 * ones that will be missed here.
 */
export function withinRadius<T extends { latitude: number | null; longitude: number | null }>(
  rows: T[],
  center: { latitude: number; longitude: number },
  radiusMiles: number
): T[] {
  return rows.filter((row) => {
    if (row.latitude == null || row.longitude == null) return false;
    return (
      haversineMiles(center, { latitude: row.latitude, longitude: row.longitude }) <=
      radiusMiles
    );
  });
}

/**
 * Point-in-polygon test (ray casting), for the roadmap item 7 polygon/
 * territory tool. Polygons are drawn client-side in Leaflet and membership
 * is checked here against whatever properties are already loaded — no
 * PostGIS or server-side geo engine needed at Omaha-market scale, per the
 * 8/26/2026 "Property map feature split" decision.
 *
 * `ring` is a GeoJSON-style array of [lng, lat] pairs (first ring only —
 * v1 doesn't support polygons with holes, which the draw tool never
 * produces anyway).
 */
export function pointInPolygon(
  point: { latitude: number; longitude: number },
  ring: [number, number][]
): boolean {
  const x = point.longitude;
  const y = point.latitude;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/**
 * Filter a list of geocoded rows down to those inside a drawn polygon.
 * Rows missing latitude/longitude are silently excluded, same convention
 * as withinRadius above.
 */
export function withinPolygon<T extends { latitude: number | null; longitude: number | null }>(
  rows: T[],
  ring: [number, number][]
): T[] {
  return rows.filter((row) => {
    if (row.latitude == null || row.longitude == null) return false;
    return pointInPolygon({ latitude: row.latitude, longitude: row.longitude }, ring);
  });
}
