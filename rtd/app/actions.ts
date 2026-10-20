"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/supabase";
import { dbMessage, type Match } from "@/lib/rtd";
import type { FormResult } from "./_components/ActionForm";

// Every RTD write (migration 029). Each one calls a single rtd_* function as
// the signed-in person; the database decides whether it goes straight into the
// CRM (Dan) or waits in Dan's review queue (Jami, Trey), and stamps who/when.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function str(fd: FormData, k: string): string {
  return String(fd.get(k) ?? "").trim();
}
function entityId(fd: FormData): string {
  const id = str(fd, "entity_id");
  if (!UUID.test(id)) throw new Error("Missing brand id.");
  return id;
}
function fail(error: string): FormResult {
  return { ok: false, error, at: Date.now() };
}
function done(message: string): FormResult {
  return { ok: true, message, at: Date.now() };
}
function saved(status: unknown, direct: string, queued: string): FormResult {
  if (status === "no_change") return { ok: false, error: "Nothing changed.", at: Date.now() };
  return done(status === "pending" ? queued : direct);
}
function refresh(id?: string) {
  if (id) revalidatePath(`/brands/${id}`);
  revalidatePath("/new");
  revalidatePath("/review");
}

type Rpc = { status?: string; message?: string; matches?: Match[]; entity_id?: string; result_ref?: string };

async function call(fn: string, args: Record<string, unknown>): Promise<{ data?: Rpc; error?: string }> {
  const supabase = await db();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return { error: dbMessage(error.message) };
  return { data: (data ?? {}) as Rpc };
}

// ---- Claim ----------------------------------------------------------------
export async function claimBrand(_p: FormResult, fd: FormData): Promise<FormResult> {
  const id = entityId(fd);
  const r = await call("rtd_claim", { p_entity_id: id });
  if (r.error) return fail(r.error);
  refresh(id);
  return done("Claimed — Jami, Trey and Dan now see it as your client.");
}

export async function releaseBrand(_p: FormResult, fd: FormData): Promise<FormResult> {
  const id = entityId(fd);
  const r = await call("rtd_release", { p_entity_id: id });
  if (r.error) return fail(r.error);
  refresh(id);
  return done("Released.");
}

// ---- Intel notes ----------------------------------------------------------
export async function addNote(_p: FormResult, fd: FormData): Promise<FormResult> {
  const id = entityId(fd);
  const body = str(fd, "body");
  if (!body) return fail("Write the note first.");
  const tags = fd.getAll("tags").map(String);
  const r = await call("rtd_add_note", { p_entity_id: id, p_body: body, p_tags: tags });
  if (r.error) return fail(r.error);
  refresh(id);
  return saved(r.data?.status, "Saved — it's on the brand and in the CRM.", "Saved — Jami, Trey and Dan can see it now.");
}

// ---- Profile edits --------------------------------------------------------
const EDIT_TEXT = ["category", "category_detail", "size_min_sf", "size_max_sf", "frontage_min_ft", "drive_thru",
  "site_criteria", "operating_model", "expansion_status", "website"];
const EDIT_LIST = ["facility_types", "target_markets"];

/** The edit form posts every field; only the ones that differ from the CRM are proposed. */
function brandFields(fd: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of EDIT_TEXT) if (fd.has(k)) out[k] = str(fd, k);
  for (const k of EDIT_LIST) if (fd.has(`${k}__present`)) out[k] = fd.getAll(k).map(String);
  return out;
}

export async function proposeEdit(_p: FormResult, fd: FormData): Promise<FormResult> {
  const id = entityId(fd);
  const r = await call("rtd_propose_edit", { p_entity_id: id, p_fields: brandFields(fd) });
  if (r.error) return fail(r.error);
  refresh(id);
  return saved(r.data?.status, "Saved to the CRM.", "Sent to Dan for review — it shows on this page as proposed until then.");
}

export async function markVerified(_p: FormResult, fd: FormData): Promise<FormResult> {
  const id = entityId(fd);
  const r = await call("rtd_mark_verified", { p_entity_id: id, p_note: str(fd, "note") || null });
  if (r.error) return fail(r.error);
  refresh(id);
  return saved(r.data?.status, "Marked current.", "Thanks — sent to Dan to mark it current.");
}

// ---- Contacts -------------------------------------------------------------
const CONTACT_FIELDS = ["first_name", "last_name", "title", "email", "phone", "mobile_phone", "role"];

function contactFields(fd: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of CONTACT_FIELDS) if (fd.has(k)) out[k] = str(fd, k);
  return out;
}

export async function addContact(_p: FormResult, fd: FormData): Promise<FormResult> {
  const id = entityId(fd);
  const r = await call("rtd_add_contact", {
    p_entity_id: id, p_contact: contactFields(fd), p_force: fd.get("force") === "1",
  });
  if (r.error) return fail(r.error);
  if (r.data?.status === "duplicate") {
    return {
      ok: false,
      error: r.data.message ?? "This looks like someone already in the CRM.",
      matches: (r.data.matches ?? []).map((m) => ({ label: `${m.name}${m.email ? ` · ${m.email}` : ""}${m.display_code ? ` (${m.display_code})` : ""}` })),
      forceLabel: "It's a different person — add them anyway",
      at: Date.now(),
    };
  }
  refresh(id);
  return saved(r.data?.status, `Added${r.data?.result_ref ? ` as ${r.data.result_ref}` : ""}.`, "Sent to Dan for review — shown here as proposed until then.");
}

export async function updateContact(_p: FormResult, fd: FormData): Promise<FormResult> {
  const id = entityId(fd);
  const contactId = str(fd, "contact_id");
  if (!UUID.test(contactId)) return fail("Missing contact.");
  const fields = contactFields(fd);
  delete fields.role;
  const r = await call("rtd_update_contact", { p_entity_id: id, p_contact_id: contactId, p_fields: fields });
  if (r.error) return fail(r.error);
  refresh(id);
  return saved(r.data?.status, "Saved to the CRM.", "Sent to Dan for review.");
}

export async function contactLeft(_p: FormResult, fd: FormData): Promise<FormResult> {
  const id = entityId(fd);
  const contactId = str(fd, "contact_id");
  if (!UUID.test(contactId)) return fail("Missing contact.");
  const r = await call("rtd_contact_left", { p_entity_id: id, p_contact_id: contactId, p_note: str(fd, "note") || null });
  if (r.error) return fail(r.error);
  refresh(id);
  return saved(r.data?.status, "Marked as no longer there.", "Sent to Dan for review.");
}

// ---- New brand ------------------------------------------------------------
export async function addBrand(_p: FormResult, fd: FormData): Promise<FormResult> {
  const name = str(fd, "name");
  if (!name) return fail("A brand needs a name.");
  const force = fd.get("force") === "1";
  const supabase = await db();

  // Directory brands with a similar name, before anything is saved.
  if (!force) {
    const { data: looks } = await supabase.rpc("rtd_brand_lookalikes", { p_name: name });
    const list = (looks ?? []) as { entity_id: string; name: string }[];
    if (list.length > 0) {
      return {
        ok: false,
        error: "These brands are already in the directory. Open one to add to it, or tick the box to add a new brand.",
        matches: list.map((m) => ({ label: m.name, href: `/brands/${m.entity_id}` })),
        forceLabel: "It's a different brand — add it anyway",
        at: Date.now(),
      };
    }
  }

  const brand: Record<string, unknown> = { name, ...brandFields(fd) };
  const r = await call("rtd_add_brand", { p_brand: brand, p_force: force });
  if (r.error) return fail(r.error);
  if (r.data?.status === "duplicate") {
    return {
      ok: false,
      error: r.data.message ?? "This looks like a company already in the CRM.",
      matches: (r.data.matches ?? []).map((m) => ({ label: `${m.name}${m.display_code ? ` (${m.display_code})` : ""}` })),
      forceLabel: "It's a different company — add it anyway",
      at: Date.now(),
    };
  }
  refresh();
  if (r.data?.status === "applied" && r.data.entity_id) redirect(`/brands/${r.data.entity_id}`);
  return done(`Sent to Dan for review. ${name} joins the directory once he accepts it — you'll see it under What's new.`);
}

// ---- Requirements (10/20/2026) ------------------------------------------
const REQ_TEXT = ["property_type", "deal_type", "size_min", "size_max", "budget_min", "budget_max",
  "target_location", "timeline", "status", "confidence", "source_date", "rtd_note", "rtd_contact"];

function reqFields(fd: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of REQ_TEXT) if (fd.has(k)) out[k] = str(fd, k);
  if (fd.has("target_markets__present")) out.target_markets = fd.getAll("target_markets").map(String);
  return out;
}

export async function addRequirement(_p: FormResult, fd: FormData): Promise<FormResult> {
  const brandId = str(fd, "entity_id");
  const party = str(fd, "party_name");
  const req: Record<string, unknown> = { ...reqFields(fd) };
  if (UUID.test(brandId)) req.entity_id = brandId;
  else req.party_name = party;

  const r = await call("rtd_add_requirement", { p_req: req, p_force: fd.get("force") === "1" });
  if (r.error) return fail(r.error);
  if (r.data?.status === "duplicate") {
    return {
      ok: false,
      error: r.data.message ?? "This looks like a company already in the CRM.",
      matches: (r.data.matches ?? []).map((m) => ({ label: `${m.name}${m.display_code ? ` (${m.display_code})` : ""}` })),
      forceLabel: "It's a different company — add it anyway",
      at: Date.now(),
    };
  }
  refresh(UUID.test(brandId) ? brandId : undefined);
  revalidatePath("/requirements");
  const reqId = (r.data as { requirement_id?: string } | undefined)?.requirement_id;
  if (r.data?.status === "applied" && reqId) redirect(`/requirements/${reqId}`);
  return done("Sent to Dan for review — it shows on Requirements as waiting until he accepts it.");
}

export async function updateRequirement(_p: FormResult, fd: FormData): Promise<FormResult> {
  const id = str(fd, "requirement_id");
  if (!UUID.test(id)) return fail("Missing requirement.");
  const r = await call("rtd_update_requirement", { p_id: id, p_fields: reqFields(fd) });
  if (r.error) return fail(r.error);
  revalidatePath(`/requirements/${id}`);
  revalidatePath("/requirements");
  refresh();
  return saved(r.data?.status, "Saved to the CRM.", "Sent to Dan for review — shown on this page as proposed until then.");
}
