-- Dan Fishburn CRM — migration 035
-- Property thumbnail photos on the map cards (Dan, 11/14/2026: "yes").
--
-- Source order, best first:
--   1. listing flyer / OM cover image (extracted at listing intake)
--   2. assessor property photo
--   3. fallback: no stored photo — the map draws a Mapbox satellite crop from
--      lat/lng on the fly, so every pin still gets an image without storing one.
--
-- Stored photos live in the public Supabase Storage bucket "property-photos"
-- under <property uuid>/<timestamp>.jpg (created on first upload by
-- /api/agent/property-photos). Paths are unguessable UUIDs; the map is Dan's
-- internal tool and the images are exterior shots from public marketing.

alter table properties
  add column if not exists photo_url text,
  add column if not exists photo_source text,       -- flyer | om | assessor | costar | dan | other
  add column if not exists photo_updated_at timestamptz;

comment on column properties.photo_url is
  'Thumbnail for map cards / property page. Null = map falls back to a Mapbox satellite crop.';
