// Provenance passthrough (9/24/2026).
//
// Migration 018 added source_system / source_record_id / source_batch_id to
// fourteen tables, but no Agent API route or MCP tool could write them — a
// hand-loaded RealNex row still had to park its space key in `notes`, which is
// the exact anti-pattern 018 was written to end. This reads the three fields
// off a request body and returns only the ones supplied, so a route can spread
// it into its insert payload without changing behaviour for callers that
// don't send them.
//
// The partial unique index 018 put on (source_system, source_record_id) means
// loading the same foreign record twice now collides instead of duplicating;
// that error comes back to the caller as the insert's own error.

export type Provenance = {
  source_system?: string;
  source_record_id?: string;
  source_batch_id?: string;
};

export function provenance(body: Record<string, unknown>): Provenance {
  const out: Provenance = {};
  for (const key of ["source_system", "source_record_id", "source_batch_id"] as const) {
    const v = body[key];
    if (typeof v === "string" && v.trim()) out[key] = v.trim();
  }
  return out;
}
