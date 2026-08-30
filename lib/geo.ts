// Small geo-distance helper, shared by anything that needs "properties near
// this point" — the Opportunity Engine's radius-based v1 targeting (see the
// 8/30/2026 decision in CRM_Requirements_and_Decisions_Log.md: radius now,
// full polygon-drawing UI later as roadmap item 7) and, eventually, that
// polygon tool itself.

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
