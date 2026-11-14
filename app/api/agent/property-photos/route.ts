import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { supabase } from "@/lib/supabase";
import { resolveRecordId } from "@/lib/resolveRecordId";

// POST /api/agent/property-photos — set a property's thumbnail photo
// (migration 035). Either upload an image or point at an existing URL:
//   { property_id, image_base64, content_type?, source? }  → uploaded to the
//       public "property-photos" Storage bucket, properties.photo_url set
//   { property_id, url, source? }                           → photo_url set as-is
//   { property_id, copy_from_url, source? }                 → the server fetches
//       the image (https URL, or a path on this app such as /property-photos/x.jpg)
//       and uploads it to the bucket — no base64 through the connector
//   { property_id, copy_current: true }                     → same, using the
//       property's current photo_url (moves a static/external photo into Storage)
//   { property_id, clear: true }                            → photo removed
//       (map falls back to the satellite crop)
// property_id accepts the uuid or the display code (PROP-3515).
// source: flyer | om | assessor | costar | dan | other (free text, recorded).

const BUCKET = "property-photos";
const MAX_BYTES = 2_000_000;
const TYPES = ["image/jpeg", "image/png", "image/webp"];

async function ensureBucket() {
  const { data } = await supabase.storage.getBucket(BUCKET);
  if (data) return null;
  const { error } = await supabase.storage.createBucket(BUCKET, {
    public: true,
    fileSizeLimit: MAX_BYTES,
    allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
  });
  return error && !/already exists/i.test(error.message) ? error : null;
}

async function uploadBytes(propertyId: string, bytes: Buffer, contentType: string) {
  if (!TYPES.includes(contentType)) throw new Error("content_type must be image/jpeg, image/png or image/webp.");
  if (!bytes.length) throw new Error("Image is empty.");
  if (bytes.length > MAX_BYTES) {
    throw new Error(`Image is ${bytes.length} bytes; max ${MAX_BYTES}. Resize to ~480px wide first.`);
  }
  const bucketErr = await ensureBucket();
  if (bucketErr) throw new Error(`Bucket: ${bucketErr.message}`);
  const ext = contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg";
  const path = `${propertyId}/${Date.now()}.${ext}`;
  const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, bytes, { contentType, upsert: true });
  if (upErr) throw new Error(`Upload: ${upErr.message}`);
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

// Fetch an image server-side. Relative paths ("/property-photos/x.jpg") resolve
// against this app's own origin, so a photo shipped in public/ can be moved.
async function fetchImage(rawUrl: string, origin: string) {
  const url = rawUrl.startsWith("/") ? new URL(rawUrl, origin).toString() : rawUrl;
  if (!/^https:\/\//i.test(url)) throw new Error("copy_from_url must be https:// or a path on this app.");
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`Fetching the image returned HTTP ${res.status}.`);
  const contentType = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  const bytes = Buffer.from(await res.arrayBuffer());
  return { bytes, contentType: contentType === "image/jpg" ? "image/jpeg" : contentType };
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const rawId = String(body.property_id || "").trim();
  if (!rawId) return NextResponse.json({ error: "property_id is required." }, { status: 400 });
  let property_id: string;
  try {
    property_id = await resolveRecordId("properties", rawId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: /not found/i.test(msg) ? 404 : 500 });
  }
  const source = String(body.source || "").trim() || null;

  const { data: prop, error: propErr } = await supabase
    .from("properties")
    .select("id, display_code, photo_url, photo_source")
    .eq("id", property_id)
    .maybeSingle();
  if (propErr) return NextResponse.json({ error: propErr.message }, { status: 500 });
  if (!prop) return NextResponse.json({ error: "Property not found." }, { status: 404 });

  let photo_url: string | null = null;

  if (body.clear === true) {
    photo_url = null;
  } else if (body.image_base64) {
    const contentType = String(body.content_type || "image/jpeg");
    const raw = String(body.image_base64).replace(/^data:[^;]+;base64,/, "");
    try {
      photo_url = await uploadBytes(property_id, Buffer.from(raw, "base64"), contentType);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return NextResponse.json({ error: msg }, { status: /^(Bucket|Upload):/.test(msg) ? 500 : 400 });
    }
  } else if (body.copy_from_url || body.copy_current === true) {
    const from = body.copy_from_url ? String(body.copy_from_url).trim() : (prop.photo_url as string | null);
    if (!from) return NextResponse.json({ error: "copy_current: the property has no photo_url to copy." }, { status: 400 });
    if (from.includes(`/storage/v1/object/public/${BUCKET}/`)) {
      return NextResponse.json({ error: "That photo is already in the Storage bucket.", photo_url: from }, { status: 400 });
    }
    try {
      const img = await fetchImage(from, request.nextUrl.origin);
      photo_url = await uploadBytes(property_id, img.bytes, img.contentType);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return NextResponse.json({ error: msg }, { status: /^(Bucket|Upload):/.test(msg) ? 500 : 400 });
    }
  } else if (body.url) {
    const url = String(body.url).trim();
    if (!/^https:\/\//i.test(url)) return NextResponse.json({ error: "url must be https://" }, { status: 400 });
    photo_url = url;
  } else {
    return NextResponse.json({ error: "Give image_base64, copy_from_url, copy_current: true, url, or clear: true." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("properties")
    .update({
      photo_url,
      photo_source: photo_url ? (source ?? (body.copy_current === true ? (prop.photo_source as string | null) : null)) : null,
      photo_updated_at: new Date().toISOString(),
    })
    .eq("id", property_id)
    .select("id, display_code, address, photo_url, photo_source, photo_updated_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ property: data });
}
