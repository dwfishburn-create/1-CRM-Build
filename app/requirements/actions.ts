"use server";

import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";
import { nextDisplayCode } from "@/lib/displayCode";

// A Requirement is a standing, informal capture of what someone told Dan
// they need — distinct from a formal Project/Assignment. See
// CRM_Requirements_and_Decisions_Log.md, 8/22/2026 entry.
export async function createRequirement(formData: FormData) {
  const deal_type = String(formData.get("deal_type") || "").trim() || null;
  const property_type =
    String(formData.get("property_type") || "").trim() || null;

  const size_min_raw = String(formData.get("size_min") || "").trim();
  const size_min = size_min_raw ? Number(size_min_raw) : null;
  const size_max_raw = String(formData.get("size_max") || "").trim();
  const size_max = size_max_raw ? Number(size_max_raw) : null;
  const budget_min_raw = String(formData.get("budget_min") || "").trim();
  const budget_min = budget_min_raw ? Number(budget_min_raw) : null;
  const budget_max_raw = String(formData.get("budget_max") || "").trim();
  const budget_max = budget_max_raw ? Number(budget_max_raw) : null;

  const target_location =
    String(formData.get("target_location") || "").trim() || null;
  const timeline = String(formData.get("timeline") || "").trim() || null;
  const status = String(formData.get("status") || "").trim() || "active";
  const priority = String(formData.get("priority") || "").trim() || "medium";
  const details = String(formData.get("details") || "").trim() || null;
  const source = String(formData.get("source") || "").trim() || null;

  const display_code = await nextDisplayCode("requirements", "REQ");

  const { error } = await supabase.from("requirements").insert({
    display_code,
    deal_type,
    property_type,
    size_min,
    size_max,
    budget_min,
    budget_max,
    target_location,
    timeline,
    status,
    priority,
    details,
    source,
  });

  if (error) throw new Error(error.message);

  revalidatePath("/requirements");
  revalidatePath("/");
}
