import { supabase } from "./supabase";
import { todayCentral } from "./centralDate";
import { isBuyerProspect, isPhoneTouch, type Campaign } from "./prospectChecklistShared";

export * from "./prospectChecklistShared";

// Listing Prospect Checklist (11/18/2026, migration 039).
//
// One row per buyer prospect on a listing: a project_contacts row with
// party_side = 'counterparty' and a role containing "prospect" or "buyer"
// (the same test as the DB function is_buyer_prospect). The client/seller is
// never a prospect. Built for CS-3167 Joliet Ave, replacing the
// ABVI_Repricing_Send_Checklist.xlsx workaround; used by the page, the .xlsx
// export (which doubles as the Listing Agreement's Existing Prospects list) and
// the agent API, so all three read the same rows the same way.


export type ProspectRow = {
  project_contact_id: string;
  prospect_no: number | null;
  first_contact_date: string | null;
  contact_id: string | null;
  contact_code: string | null;
  name: string;
  company: string | null;
  entity_id: string | null;
  email: string | null;
  phone: string | null;
  source: string | null;
  stage: string | null;
  /** Date the signed confidentiality agreement came back (migration 040). */
  ca_signed_on: string | null;
  ca_note: string | null;
  /** Buyer package sent (migration 041); date when known. */
  package_sent: boolean;
  package_sent_on: string | null;
  package_note: string | null;
  /** Offer made (migration 041); date of the latest offer, terms in the note. */
  offer_made: boolean;
  offer_made_on: string | null;
  offer_note: string | null;
  role: string | null;
  notes: string | null;
  last_action_date: string | null;
  last_action_type: string | null;
  last_action_summary: string | null;
  /** Latest phone touch on/after the latest campaign (or ever, with no campaign). */
  called_on: string | null;
  open_task: { id: string; display_code: string | null; description: string; due_date: string | null } | null;
  open_task_overdue: boolean;
  campaigns: Record<string, { status: string; note: string | null } | undefined>;
  needs_verification: boolean;
};

export type Checklist = {
  project: { id: string; project_code: string; project_type: string; client_name: string };
  campaigns: Campaign[];
  /** sent_on of the newest campaign — the "since" for not-yet-called. */
  called_since: string | null;
  rows: ProspectRow[];
};

type Named = { id: string; name: string; display_code: string | null };
type ContactRec = {
  id: string;
  display_code: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  mobile_phone: string | null;
  entity_id: string | null;
  needs_verification: boolean | null;
  entity: Named | Named[] | null;
};
type PCRec = {
  id: string;
  contact_id: string | null;
  entity_id: string | null;
  role: string | null;
  notes: string | null;
  party_side: string | null;
  prospect_no: number | null;
  first_contact_date: string | null;
  prospect_source: string | null;
  prospect_stage: string | null;
  company_note: string | null;
  ca_signed_on: string | null;
  ca_note: string | null;
  package_sent: boolean | null;
  package_sent_on: string | null;
  package_note: string | null;
  offer_made: boolean | null;
  offer_made_on: string | null;
  offer_note: string | null;
  created_at: string;
  contact: ContactRec | ContactRec[] | null;
  entity: Named | Named[] | null;
};

const one = <T,>(v: T | T[] | null | undefined): T | null =>
  !v ? null : Array.isArray(v) ? v[0] ?? null : v;

const day = (ts: string | null) =>
  ts ? new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date(ts)) : null;

/** An email that is really a note ("—", "(bounced)", "NOT ON FILE") is no email. */
function usableEmail(e: string | null): string | null {
  const s = (e ?? "").trim();
  return s && s.includes("@") ? s : null;
}

export async function loadProspectChecklist(projectId: string): Promise<Checklist | null> {
  const { data: project, error: pErr } = await supabase
    .from("projects")
    .select("id, project_code, project_type, client_name")
    .eq("id", projectId)
    .maybeSingle();
  if (pErr) throw new Error(pErr.message);
  if (!project) return null;

  const [{ data: links, error: lErr }, { data: campaigns, error: cErr }] = await Promise.all([
    supabase
      .from("project_contacts")
      .select(
        "id, contact_id, entity_id, role, notes, party_side, prospect_no, first_contact_date, prospect_source, prospect_stage, company_note, ca_signed_on, ca_note, package_sent, package_sent_on, package_note, offer_made, offer_made_on, offer_note, created_at, " +
          "contact:contacts!contact_id(id, display_code, first_name, last_name, email, phone, mobile_phone, entity_id, needs_verification, entity:entities!entity_id(id, name, display_code)), " +
          "entity:entities!entity_id(id, name, display_code)"
      )
      .eq("project_id", projectId)
      .eq("party_side", "counterparty")
      .returns<PCRec[]>(),
    supabase
      .from("project_campaigns")
      .select("id, name, sent_on, notes")
      .eq("project_id", projectId)
      .order("sent_on", { ascending: true, nullsFirst: false })
      .returns<Campaign[]>(),
  ]);
  if (lErr) throw new Error(lErr.message);
  if (cErr) throw new Error(cErr.message);

  const prospects = (links ?? []).filter((l) => isBuyerProspect(l.party_side, l.role));
  const contactIds = prospects.map((p) => p.contact_id).filter((x): x is string => !!x);
  const pcIds = prospects.map((p) => p.id);
  const camps = campaigns ?? [];
  const calledSince = camps.reduce<string | null>(
    (acc, c) => (c.sent_on && (!acc || c.sent_on > acc) ? c.sent_on : acc),
    null
  );

  const [activity, tasks, recipients, companyLinks] = await Promise.all([
    contactIds.length
      ? supabase
          .from("activity_log")
          .select("contact_id, activity_type, activity_date, summary")
          .eq("project_id", projectId)
          .in("contact_id", contactIds)
          .order("activity_date", { ascending: false })
          .limit(5000)
          .returns<{ contact_id: string; activity_type: string; activity_date: string; summary: string | null }[]>()
      : Promise.resolve({ data: [], error: null }),
    contactIds.length
      ? supabase
          .from("tasks")
          .select("id, display_code, description, due_date, contact_id, waiting_on_contact_id")
          .eq("project_id", projectId)
          .eq("status", "open")
          .or(`contact_id.in.(${contactIds.join(",")}),waiting_on_contact_id.in.(${contactIds.join(",")})`)
          .order("due_date", { ascending: true, nullsFirst: false })
          .returns<{ id: string; display_code: string | null; description: string; due_date: string | null; contact_id: string | null; waiting_on_contact_id: string | null }[]>()
      : Promise.resolve({ data: [], error: null }),
    pcIds.length && camps.length
      ? supabase
          .from("project_campaign_recipients")
          .select("campaign_id, project_contact_id, status, note")
          .in("project_contact_id", pcIds)
          .returns<{ campaign_id: string; project_contact_id: string; status: string; note: string | null }[]>()
      : Promise.resolve({ data: [], error: null }),
    contactIds.length
      ? supabase
          .from("contact_entities")
          .select("contact_id, entity:entities!entity_id(id, name, display_code)")
          .in("contact_id", contactIds)
          .returns<{ contact_id: string; entity: Named | Named[] | null }[]>()
      : Promise.resolve({ data: [], error: null }),
  ]);
  for (const r of [activity, tasks, recipients, companyLinks]) if (r.error) throw new Error(r.error.message);

  const lastBy = new Map<string, { activity_type: string; activity_date: string; summary: string | null }>();
  const calledBy = new Map<string, string>();
  for (const a of activity.data ?? []) {
    if (!lastBy.has(a.contact_id)) lastBy.set(a.contact_id, a);
    const d = day(a.activity_date);
    if (d && isPhoneTouch(a.activity_type) && (!calledSince || d >= calledSince) && !calledBy.has(a.contact_id)) {
      calledBy.set(a.contact_id, d);
    }
  }
  const taskBy = new Map<string, NonNullable<ProspectRow["open_task"]>>();
  for (const t of tasks.data ?? []) {
    for (const cid of [t.contact_id, t.waiting_on_contact_id]) {
      if (cid && !taskBy.has(cid)) taskBy.set(cid, { id: t.id, display_code: t.display_code, description: t.description, due_date: t.due_date });
    }
  }
  const recBy = new Map<string, ProspectRow["campaigns"]>();
  for (const r of recipients.data ?? []) {
    const m = recBy.get(r.project_contact_id) ?? {};
    m[r.campaign_id] = { status: r.status, note: r.note };
    recBy.set(r.project_contact_id, m);
  }
  const companyBy = new Map<string, Named>();
  for (const l of companyLinks.data ?? []) {
    const e = one(l.entity);
    if (e && !companyBy.has(l.contact_id)) companyBy.set(l.contact_id, e);
  }

  const today = todayCentral();
  const rows: ProspectRow[] = prospects.map((p) => {
    const c = one(p.contact);
    const linkEntity = one(p.entity);
    const company =
      linkEntity ?? (c ? one(c.entity) ?? companyBy.get(c.id) ?? null : null);
    const name = c
      ? [c.first_name, c.last_name].filter(Boolean).join(" ") || "Unnamed contact"
      : linkEntity?.name ?? "Unknown";
    const last = c ? lastBy.get(c.id) : undefined;
    const task = c ? taskBy.get(c.id) ?? null : null;
    return {
      project_contact_id: p.id,
      prospect_no: p.prospect_no,
      first_contact_date: p.first_contact_date ?? day(p.created_at),
      contact_id: c?.id ?? null,
      contact_code: c?.display_code ?? null,
      name,
      company: company?.name ?? p.company_note ?? null,
      entity_id: company?.id ?? null,
      email: usableEmail(c?.email ?? null),
      phone: (c?.mobile_phone || c?.phone || "").trim() || null,
      source: p.prospect_source,
      stage: p.prospect_stage,
      ca_signed_on: p.ca_signed_on,
      ca_note: p.ca_note,
      package_sent: !!p.package_sent || !!p.package_sent_on,
      package_sent_on: p.package_sent_on,
      package_note: p.package_note,
      offer_made: !!p.offer_made || !!p.offer_made_on,
      offer_made_on: p.offer_made_on,
      offer_note: p.offer_note,
      role: p.role,
      notes: p.notes,
      last_action_date: last ? day(last.activity_date) : null,
      last_action_type: last?.activity_type ?? null,
      last_action_summary: last?.summary ?? null,
      called_on: c ? calledBy.get(c.id) ?? null : null,
      open_task: task,
      open_task_overdue: !!task?.due_date && task.due_date < today,
      campaigns: recBy.get(p.id) ?? {},
      needs_verification: !!c?.needs_verification,
    };
  });

  rows.sort(
    (a, b) =>
      (a.first_contact_date ?? "9999").localeCompare(b.first_contact_date ?? "9999") ||
      (a.prospect_no ?? 1e9) - (b.prospect_no ?? 1e9)
  );

  return { project, campaigns: camps, called_since: calledSince, rows };
}
