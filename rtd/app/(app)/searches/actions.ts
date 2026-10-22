"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/supabase";
import { dbMessage } from "@/lib/rtd";
import type { FormResult } from "@/app/_components/ActionForm";

// Saved searches (migration 031). Everyone sees every saved search; the person
// who saved one, or Dan, can update or delete it. Anyone can save a copy.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function str(fd: FormData, k: string): string {
  return String(fd.get(k) ?? "").trim();
}
function fail(error: string): FormResult {
  return { ok: false, error, at: Date.now() };
}
function params(fd: FormData): Record<string, unknown> | null {
  try {
    const v = JSON.parse(str(fd, "params"));
    return v && typeof v === "object" ? v : null;
  } catch {
    return null;
  }
}

export async function saveSearch(_p: FormResult, fd: FormData): Promise<FormResult> {
  const name = str(fd, "name");
  if (!name) return fail("Give the search a name — e.g. \"Bay A – 1,500 SF\".");
  const p = params(fd);
  if (!p) return fail("Run the search first, then save it.");
  const supabase = await db();
  const { data, error } = await supabase.rpc("rtd_save_search", {
    p_name: name, p_params: p, p_listing: str(fd, "listing") || null,
  });
  if (error) return fail(dbMessage(error.message));
  revalidatePath("/searches");
  redirect(`/?saved=${(data as { id: string }).id}`);
}

export async function updateSearch(_p: FormResult, fd: FormData): Promise<FormResult> {
  const id = str(fd, "id");
  if (!UUID.test(id)) return fail("Missing saved search.");
  const p = fd.has("params") ? params(fd) : null;
  if (fd.has("params") && !p) return fail("Run the search first, then save it.");
  const supabase = await db();
  const { error } = await supabase.rpc("rtd_update_saved_search", {
    p_id: id,
    p_name: fd.has("name") ? str(fd, "name") || null : null,
    p_params: p,
    p_listing: fd.has("listing") ? str(fd, "listing") : null,
  });
  if (error) return fail(dbMessage(error.message));
  revalidatePath("/searches");
  redirect(`/?saved=${id}`);
}

export async function deleteSearch(_p: FormResult, fd: FormData): Promise<FormResult> {
  const id = str(fd, "id");
  if (!UUID.test(id)) return fail("Missing saved search.");
  const supabase = await db();
  const { error } = await supabase.rpc("rtd_delete_saved_search", { p_id: id });
  if (error) return fail(dbMessage(error.message));
  revalidatePath("/searches");
  redirect("/searches");
}
