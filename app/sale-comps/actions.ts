"use server";

import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";

const CONFIDENCE_LEVELS = [
  "confirmed",
  "broker_reported",
  "market_estimate",
  "rumor",
];

export async function createSaleComp(formData: FormData) {
  const property_address = String(
    formData.get("property_address") || ""
  ).trim();
  if (!property_address) throw new Error("Property address is required.");

  const property_id_raw = String(formData.get("property_id") || "").trim();
  const property_id = property_id_raw || null;

  const sale_date = String(formData.get("sale_date") || "").trim() || null;
  const sale_price_raw = String(formData.get("sale_price") || "").trim();
  const buyer = String(formData.get("buyer") || "").trim() || null;
  const seller = String(formData.get("seller") || "").trim() || null;
  const building_sf_raw = String(formData.get("building_sf") || "").trim();
  const land_acres_raw = String(formData.get("land_acres") || "").trim();
  const cap_rate_raw = String(formData.get("cap_rate") || "").trim();
  const property_type =
    String(formData.get("property_type") || "").trim() || null;
  const confidence_level_raw = String(
    formData.get("confidence_level") || ""
  ).trim();
  const confidence_level = CONFIDENCE_LEVELS.includes(confidence_level_raw)
    ? confidence_level_raw
    : "broker_reported";
  const source = String(formData.get("source") || "").trim() || null;
  const why_it_matters =
    String(formData.get("why_it_matters") || "").trim() || null;
  const notes = String(formData.get("notes") || "").trim() || null;

  const { error } = await supabase.from("sale_comps").insert({
    property_address,
    property_id,
    sale_date,
    sale_price: sale_price_raw ? Number(sale_price_raw) : null,
    buyer,
    seller,
    building_sf: building_sf_raw ? Number(building_sf_raw) : null,
    land_acres: land_acres_raw ? Number(land_acres_raw) : null,
    cap_rate: cap_rate_raw ? Number(cap_rate_raw) : null,
    property_type,
    confidence_level,
    source,
    why_it_matters,
    notes,
  });

  if (error) throw new Error(error.message);

  revalidatePath("/sale-comps");
  revalidatePath("/");
}
