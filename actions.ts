"use server";

import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";
import { nextDisplayCode } from "@/lib/displayCode";

export async function createContact(formData: FormData) {
  const first_name = String(formData.get("first_name") || "").trim();
  const last_name = String(formData.get("last_name") || "").trim();
  const email = String(formData.get("email") || "").trim() || null;
  const phone = String(formData.get("phone") || "").trim() || null;
  const mobile_phone =
    String(formData.get("mobile_phone") || "").trim() || null;
  const title = String(formData.get("title") || "").trim() || null;
  const company_name = String(formData.get("company_name") || "").trim();
  const notes = String(formData.get("notes") || "").trim() || null;

  if (!first_name && !last_name) {
    throw new Error("First or last name is required.");
  }

  let company_id: string | null = null;
  if (company_name) {
    const { data: existing, error: lookupError } = await supabase
      .from("companies")
      .select("id")
      .ilike("name", company_name)
      .maybeSingle();
    if (lookupError) throw new Error(lookupError.message);

    if (existing) {
      company_id = existing.id;
    } else {
      const companyCode = await nextDisplayCode("companies", "CO");
      const { data: newCompany, error: companyError } = await supabase
        .from("companies")
        .insert({ name: company_name, display_code: companyCode })
        .select("id")
        .single();
      if (companyError) throw new Error(companyError.message);
      company_id = newCompany.id;
    }
  }

  const display_code = await nextDisplayCode("contacts", "CON");

  const { error } = await supabase.from("contacts").insert({
    display_code,
    first_name: first_name || null,
    last_name: last_name || null,
    email,
    phone,
    mobile_phone,
    title,
    company_id,
    notes,
  });

  if (error) throw new Error(error.message);

  revalidatePath("/contacts");
  revalidatePath("/");
}
