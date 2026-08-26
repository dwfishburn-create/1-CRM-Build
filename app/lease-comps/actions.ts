"use server";

import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";

const CONFIDENCE_LEVELS = [
  "confirmed",
  "broker_reported",
  "market_estimate",
  "rumor",
];

export async function createLeaseComp(formData: FormData) {
  const property_address = String(
    formData.get("property_address") || ""
  ).trim();
  if (!property_address) throw new Error("Property address is required.");

  const property_id_raw = String(formData.get("property_id") || "").trim();
  const property_id = property_id_raw || null;

  const tenant = String(formData.get("tenant") || "").trim() || null;
  const landlord = String(formData.get("landlord") || "").trim() || null;
  const lease_date = String(formData.get("lease_date") || "").trim() || null;
  const sf_raw = String(formData.get("sf") || "").trim();
  const asking_rent_raw = String(formData.get("asking_rent") || "").trim();
  const final_rent_raw = String(formData.get("final_rent") || "").trim();
  const lease_term_months_raw = String(
    formData.get("lease_term_months") || ""
  ).trim();
  const ti_allowance_raw = String(formData.get("ti_allowance") || "").trim();
  const free_rent_months_raw = String(
    formData.get("free_rent_months") || ""
  ).trim();
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

  const { error } = await supabase.from("lease_comps").insert({
    property_address,
    property_id,
    tenant,
    landlord,
    lease_date,
    sf: sf_raw ? Number(sf_raw) : null,
    asking_rent: asking_rent_raw ? Number(asking_rent_raw) : null,
    final_rent: final_rent_raw ? Number(final_rent_raw) : null,
    lease_term_months: lease_term_months_raw
      ? Number(lease_term_months_raw)
      : null,
    ti_allowance: ti_allowance_raw ? Number(ti_allowance_raw) : null,
    free_rent_months: free_rent_months_raw
      ? Number(free_rent_months_raw)
      : null,
    property_type,
    confidence_level,
    source,
    why_it_matters,
    notes,
  });

  if (error) throw new Error(error.message);

  revalidatePath("/lease-comps");
  revalidatePath("/");
}
