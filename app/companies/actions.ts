"use server";

import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";
import { nextDisplayCode } from "@/lib/displayCode";

export async function createCompany(formData: FormData) {
  const name = String(formData.get("name") || "").trim();
  if (!name) throw new Error("Company name is required.");

  const industry = String(formData.get("industry") || "").trim() || null;
  const website = String(formData.get("website") || "").trim() || null;
  const notes = String(formData.get("notes") || "").trim() || null;

  const display_code = await nextDisplayCode("companies", "CO");

  const { error } = await supabase.from("companies").insert({
    display_code,
    name,
    industry,
    website,
    notes,
  });

  if (error) throw new Error(error.message);

  revalidatePath("/companies");
  revalidatePath("/");
}
