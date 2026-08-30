"use server";

import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";
import { nextDisplayCode } from "@/lib/displayCode";
import { geocodeAddress } from "@/lib/geocode";

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

  // Property/Space model: no parent = the assessor-level building/parcel.
  // A parent set = this row is a leasable space/suite inside that building,
  // with its own address and suite number (which are often different from
  // the parent building's own address).
  const parent_property_id_raw = String(
    formData.get("parent_property_id") || ""
  ).trim();
  const parent_property_id = parent_property_id_raw || null;
  const suite_number = String(formData.get("suite_number") || "").trim() || null;

  const display_code = await nextDisplayCode("properties", "PROP");

  // Best-effort geocode, same as the Agent API's POST /api/agent/properties
  // — a miss (bad address, API hiccup) just leaves both columns null, it
  // never blocks the property from being created.
  const geocoded = await geocodeAddress({ address, city, state, zip });

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
    parent_property_id,
    suite_number,
    latitude: geocoded?.latitude ?? null,
    longitude: geocoded?.longitude ?? null,
    notes,
  });

  if (error) throw new Error(error.message);

  revalidatePath("/properties");
  revalidatePath("/");
}
