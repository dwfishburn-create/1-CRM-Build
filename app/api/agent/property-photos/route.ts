import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { supabase } from "@/lib/supabase";

// POST /api/agent/property-photos — set a property's thumbnail photo
// (migration 035). Either upload an image or point at an existing URL:
//   { property_id, image_base64, content_type?, source? }  → uploaded to the
//       public "property-photos" Storage bucket, properties.photo_url set
//   { property_id, url, source? }                           → photo_url set as-is
//   { property_id, clear: true }                            → photo removed
//       (map falls back to the satellite crop)
// source: flyer | om | assessor | costar | dan | other (free text, recorded).

const BUCKET = "property-photos";
const MAX_BYTES = 2_000_000;

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

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const property_id = String(body.property_id || "").trim();
  if (!property_id) return NextResponse.json({ error: "property_id is required." }, { status: 400 });
  const source = String(body.source || "").trim() || null;

  const { data: prop, error: propErr } = await supabase
    .from("properties")
    .select("id, display_code")
    .eq("id", property_id)
    .maybeSingle();
  if (propErr) return NextResponse.json({ error: propErr.message }, { status: 500 });
  if (!prop) return NextResponse.json({ error: "Property not found." }, { status: 404 });

  let photo_url: string | null = null;

  if (body.clear === true) {
    photo_url = null;
  } else if (body.image_base64) {
    const contentType = String(body.content_type || "image/jpeg");
    if (!["image/jpeg", "image/png", "image/webp"].includes(contentType)) {
      return NextResponse.json({ error: "content_type must be image/jpeg, image/png or image/webp." }, { status: 400 });
    }
    const raw = String(body.image_base64).replace(/^data:[^;]+;base64,/, "");
    const bytes = Buffer.from(raw, "base64");
    if (!bytes.length) return NextResponse.json({ error: "image_base64 decoded to nothing." }, { status: 400 });
    if (bytes.length > MAX_BYTES) {
      return NextResponse.json({ error: `Image is ${bytes.length} bytes; max ${MAX_BYTES}. Resize to ~480px wide first.` }, { status: 400 });
    }
    const bucketErr = await ensureBucket();
    if (bucketErr) return NextResponse.json({ error: `Bucket: ${bucketErr.message}` }, { status: 500 });

    const ext = contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg";
    const path = `${property_id}/${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, bytes, { contentType, upsert: true });
    if (upErr) return NextResponse.json({ error: `Upload: ${upErr.message}` }, { status: 500 });
    photo_url = supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  } else if (body.url) {
    const url = String(body.url).trim();
    if (!/^https:\/\//i.test(url)) return NextResponse.json({ error: "url must be https://" }, { status: 400 });
    photo_url = url;
  } else {
    return NextResponse.json({ error: "Give image_base64, url, or clear: true." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("properties")
    .update({
      photo_url,
      photo_source: photo_url ? source : null,
      photo_updated_at: new Date().toISOString(),
    })
    .eq("id", property_id)
    .select("id, display_code, address, photo_url, photo_source, photo_updated_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ property: data });
}
