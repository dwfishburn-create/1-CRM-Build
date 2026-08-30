// Geocoding utility — turns a property's address into latitude/longitude.
//
// Uses the US Census Bureau's Geocoding Services API (geocoding.geo.census.gov):
// free, no API key, no rate-limit account to manage, covers all of NE/IA. This
// is a deliberate choice to sidestep the still-open "Broader tech stack" /
// Google Maps Platform question in CRM_Requirements_and_Decisions_Log.md — a
// paid mapping vendor doesn't need to be picked just to populate two columns.
// Swappable later (matches the vendor-independence principle) if a session
// ever wants Google's better hit rate on rural/rooftop-level addresses.
//
// Added 8/30/2026 for the lat/long backfill — see the "Opportunity Engine"
// decision entry in the log. properties.latitude/longitude have existed
// since 001_init_schema.sql but were never populated by any code path until
// now.

export type GeocodeResult = { latitude: number; longitude: number };

type CensusGeocodeResponse = {
  result?: {
    addressMatches?: Array<{
      coordinates?: { x?: number; y?: number };
    }>;
  };
};

const CENSUS_GEOCODE_URL =
  "https://geocoding.geo.census.gov/geocoder/locations/address";
const TIMEOUT_MS = 8000;

/**
 * Best-effort geocode of a US street address. Returns null (never throws)
 * on no match, network failure, or timeout — geocoding is an enrichment,
 * not something that should ever block a property create/update.
 */
export async function geocodeAddress(input: {
  address: string;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
}): Promise<GeocodeResult | null> {
  const street = (input.address || "").trim();
  if (!street) return null;

  const params = new URLSearchParams({
    street,
    city: (input.city || "").trim(),
    state: (input.state || "NE").trim(),
    zip: (input.zip || "").trim(),
    benchmark: "Public_AR_Current",
    format: "json",
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${CENSUS_GEOCODE_URL}?${params.toString()}`, {
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) return null;

    const data = (await res.json()) as CensusGeocodeResponse;
    const match = data.result?.addressMatches?.[0];
    const x = match?.coordinates?.x; // longitude
    const y = match?.coordinates?.y; // latitude
    if (typeof x !== "number" || typeof y !== "number") return null;

    return { latitude: y, longitude: x };
  } catch {
    // Timeout, network error, or unexpected response shape — treat as a
    // miss, same as "no match found." Caller decides whether that's worth
    // surfacing to Dan.
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
