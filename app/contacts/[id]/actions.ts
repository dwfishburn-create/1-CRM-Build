"use server";

import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";
import type { FormResult } from "@/app/_components/ActionForm";

// Edit a contact's name, title, email and phones from its page (10/19/2026).
// Before this, contacts could only be changed through the MCP update tools.
// The form posts every field, so a blank field clears it — except that a
// contact must keep a first or last name. Company and notes are not edited
// here. Errors show in place via ActionForm.
export async function updateContactAction(_prev: FormResult, fd: FormData): Promise<FormResult> {
  const fail = (m: string): FormResult => ({ ok: false, error: m, at: Date.now() });
  try {
    const id = String(fd.get("id") || "").trim();
    if (!id) return fail("id is required.");

    const text = (k: string) => String(fd.get(k) || "").trim() || null;
    const first_name = text("first_name");
    const last_name = text("last_name");
    const email = text("email");
    if (!first_name && !last_name) return fail("First or last name is required.");
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return fail(`"${email}" doesn't look like an email address.`);
    }

    const { error } = await supabase
      .from("contacts")
      .update({
        first_name,
        last_name,
        title: text("title"),
        email,
        phone: text("phone"),
        mobile_phone: text("mobile_phone"),
      })
      .eq("id", id);
    if (error) return fail(error.message);

    revalidatePath(`/contacts/${id}`);
    revalidatePath("/contacts");
    return { ok: true, at: Date.now() };
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
}
