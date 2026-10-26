"use server";

import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";
import { nextDisplayCode } from "@/lib/displayCode";
import { webLookalikes } from "@/lib/nearMatch";
import { linkLicense, rollbackSnapshot } from "@/lib/liquorLicenses";
import type { FormResult } from "../_components/ActionForm";

// Liquor license screens (10/26/2026, migration 032). "Promote when touched":
// nothing here creates records in bulk. A licensee becomes a company, or a
// manager a contact, one license at a time when Dan clicks — through the same
// look-alike check every web add form uses.

function failed(e: unknown): FormResult {
  return { ok: false, error: e instanceof Error ? e.message : String(e), at: Date.now() };
}

function done(licenseNumber: string, warning?: string): FormResult {
  revalidatePath(`/liquor-licenses/${licenseNumber}`);
  revalidatePath("/liquor-licenses");
  return { ok: true, warning, at: Date.now() };
}

/** "ENT-0123" / "PROP-0045" / "CON-0007" or a uuid → the record's id. */
async function resolveCode(table: "entities" | "properties" | "contacts", raw: string): Promise<string | null> {
  const v = raw.trim();
  if (!v) return null;
  if (/^[0-9a-f-]{36}$/i.test(v)) return v;
  const { data, error } = await supabase.from(table).select("id").eq("display_code", v.toUpperCase()).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error(`No ${table === "entities" ? "company" : table === "properties" ? "property" : "contact"} ${v}.`);
  return data.id as string;
}

export async function linkLicenseAction(_prev: FormResult, fd: FormData): Promise<FormResult> {
  try {
    const num = String(fd.get("license_number") || "");
    const body: Record<string, unknown> = { license_number: num };
    const brand = await resolveCode("entities", String(fd.get("brand") || ""));
    const licensee = await resolveCode("entities", String(fd.get("licensee") || ""));
    const property = await resolveCode("properties", String(fd.get("property") || ""));
    const contact = await resolveCode("contacts", String(fd.get("contact") || ""));
    if (brand) body.brand_entity_id = brand;
    if (licensee) body.licensee_entity_id = licensee;
    if (property) body.property_id = property;
    if (contact) body.contact_id = contact;
    if (fd.has("notes")) body.notes = String(fd.get("notes") ?? "");
    await linkLicense(body);
    return done(num);
  } catch (e) {
    return failed(e);
  }
}

export async function clearLinkAction(_prev: FormResult, fd: FormData): Promise<FormResult> {
  try {
    const num = String(fd.get("license_number") || "");
    await linkLicense({ license_number: num, clear: [String(fd.get("which") || "")] });
    return done(num, "Link cleared — automatic matching will relink it if an exact match exists.");
  } catch (e) {
    return failed(e);
  }
}

async function getRow(num: string) {
  const { data, error } = await supabase
    .from("liquor_licenses")
    .select("id, license_number, trade_name, licensee, licensee_entity_id, manager_name, phone, email, premises_street, premises_city, last_seen_on, contact_id")
    .eq("license_number", num)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error(`No liquor license ${num}.`);
  return data;
}

/** Add the licensee as a company (entity) and link it. */
export async function promoteLicenseeAction(_prev: FormResult, fd: FormData): Promise<FormResult> {
  try {
    const l = await getRow(String(fd.get("license_number") || ""));
    if (l.licensee_entity_id) throw new Error("This license already has a licensee company linked.");
    const name = String(fd.get("name") || l.licensee || "").trim();
    if (!name) throw new Error("The license has no licensee name.");

    if (fd.get("allow_duplicate") !== "true") {
      const matches = await webLookalikes("entity", { p_name: name, p_limit: 5 });
      if (matches.length) {
        return {
          ok: false,
          error: "This licensee looks like a company already in the CRM. Nothing was created — if it's the same company, put its ENT code in \"Licensee company\" above; tick the box to add it anyway.",
          matches,
          at: Date.now(),
        };
      }
    }
    const display_code = await nextDisplayCode("entities", "ENT");
    const { data, error } = await supabase
      .from("entities")
      .insert({
        display_code,
        name,
        trade_name: l.trade_name && l.trade_name.toLowerCase() !== name.toLowerCase() ? l.trade_name : null,
        entity_type: /\bL\.?L\.?C\.?$/i.test(name) ? "LLC"
          : /\b(INC|CORP|CORPORATION|COMPANY|CO)\.?$/i.test(name) ? "Corporation"
          : /\b(LP|LLP|PARTNERSHIP)\.?$/i.test(name) ? "Partnership" : "Other",
        notes: `Liquor licensee — NLCC license ${l.license_number} (${l.trade_name ?? ""}, ${l.premises_street ?? ""}, ${l.premises_city ?? ""}), roster of ${l.last_seen_on ?? "?"}.`,
        source_system: "nlcc",
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    await linkLicense({ license_number: l.license_number, licensee_entity_id: data.id });
    revalidatePath("/entities");
    return done(l.license_number, `Added ${display_code}. Other licenses held by the same licensee link to it automatically on the next roster import.`);
  } catch (e) {
    return failed(e);
  }
}

/** Add the manager as a contact (flagged for verification) and link it. */
export async function promoteManagerAction(_prev: FormResult, fd: FormData): Promise<FormResult> {
  try {
    const l = await getRow(String(fd.get("license_number") || ""));
    if (l.contact_id) throw new Error("This license already has a contact linked.");
    const full = String(fd.get("manager") || l.manager_name || "").trim();
    if (!full) throw new Error("The license has no manager name.");
    const parts = full.split(/\s+/);
    const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
    const first_name = cap(parts[0]);
    const last_name = parts.length > 1 ? parts.slice(1).filter((p) => p.length > 1 || parts.length === 2).map(cap).join(" ") || cap(parts[parts.length - 1]) : null;

    if (fd.get("allow_duplicate") !== "true") {
      const matches = await webLookalikes("contact", { p_first: first_name, p_last: last_name, p_email: l.email, p_limit: 5 });
      if (matches.length) {
        return {
          ok: false,
          error: "This manager looks like a contact already in the CRM. Nothing was created — put the CON code in \"Contact\" above if it's the same person; tick the box to add anyway.",
          matches,
          at: Date.now(),
        };
      }
    }
    const display_code = await nextDisplayCode("contacts", "CON");
    const { data, error } = await supabase
      .from("contacts")
      .insert({
        display_code,
        first_name,
        last_name,
        title: "Manager (liquor license)",
        email: l.email,
        phone: l.phone,
        entity_id: l.licensee_entity_id,
        needs_verification: true,
        verification_note: `From the NLCC liquor license roster of ${l.last_seen_on ?? "?"} (license ${l.license_number}, ${l.trade_name ?? ""}). Email/phone are the license's, not necessarily this person's.`,
        source_system: "nlcc",
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    await linkLicense({ license_number: l.license_number, contact_id: data.id });
    revalidatePath("/contacts");
    return done(l.license_number, `Added ${display_code}, flagged for verification.`);
  } catch (e) {
    return failed(e);
  }
}

export async function rollbackSnapshotAction(_prev: FormResult, fd: FormData): Promise<FormResult> {
  try {
    const batch = String(fd.get("batch_id") || "");
    if (fd.get("confirm") !== "yes") throw new Error("Tick the box to confirm the undo.");
    const r = await rollbackSnapshot(batch);
    revalidatePath("/liquor-licenses");
    revalidatePath("/liquor-licenses/import");
    return { ok: true, warning: `Removed ${batch}: ${Number(r.deleted ?? 0)} licenses deleted, ${Number(r.restored ?? 0)} restored.`, at: Date.now() };
  } catch (e) {
    return failed(e);
  }
}
