"use server";

import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";
import { nextDisplayCode } from "@/lib/displayCode";

export async function createProperty(formData: FormData) {
  const address = String(formData.get("address") || "").trim();
  if (!address) throw new Error("Address is required.");

  const city = String(formData.get("city") || "").trim() || null;
  const state = String(formData.get("state") || "").trim() || "NE";
  const zip = String(formData.get("zip") || "").trim() || null;
  const property_type =
    String(formData.get("property_type") || "").trim() || null;
  const submarket = String(formData.get("submarket") || "").trim() || null;
  const building_sf_raw = String(formData.get("building_sf") || "").trim();
  const land_acres_raw = String(formData.get("land_acres") || "").trim();
  const notes = String(formData.get("notes") || "").trim() || null;

  const display_code = await nextDisplayCode("properties", "PROP");

  const { error } = await supabase.from("properties").insert({
    display_code,
    address,
    city,
    state,
    zip,
    property_type,
    submarket,
    building_sf: building_sf_raw ? Number(building_sf_raw) : null,
    land_acres: land_acres_raw ? Number(land_acres_raw) : null,
    notes,
  });

  if (error) throw new Error(error.message);

  revalidatePath("/properties");
  revalidatePath("/");
}
