"use server";

import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";

export async function createProject(formData: FormData) {
  const project_code = String(formData.get("project_code") || "").trim();
  const project_type = String(formData.get("project_type") || "").trim();
  const client_name = String(formData.get("client_name") || "").trim();

  if (!project_code) throw new Error("Project code is required.");
  if (!project_type) throw new Error("Project type is required.");
  if (!client_name) throw new Error("Client name is required.");

  const status = String(formData.get("status") || "").trim() || "active";
  const start_date_raw = String(formData.get("start_date") || "").trim();
  const start_date = start_date_raw || null;
  const target_close_date_raw = String(
    formData.get("target_close_date") || ""
  ).trim();
  const target_close_date = target_close_date_raw || null;
  const notes = String(formData.get("notes") || "").trim() || null;

  const { error } = await supabase.from("projects").insert({
    project_code,
    project_type,
    client_name,
    status,
    start_date,
    target_close_date,
    notes,
  });

  if (error) throw new Error(error.message);

  revalidatePath("/projects");
  revalidatePath("/");
}
