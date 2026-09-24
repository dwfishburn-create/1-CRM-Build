import Link from "next/link";
import { notFound } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { entityHref, money, one, projectHref, propertyHref, propertyLabel, requirementHref } from "@/lib/records";
import {
  ACTIVITY_SELECT,
  ActivityFeed,
  Empty,
  Field,
  LEASE_SELECT,
  LeaseList,
  NotesBox,
  Section,
  TASK_SELECT,
  TaskList,
  VerificationBanner,
  type ActivityLite,
  type LeaseLite,
  type TaskLite,
} from "@/app/_components/RecordParts";

export const dynamic = "force-dynamic";

// Contact detail page (9/24/2026). The record, then everything it connects to:
// the company, other affiliations, deals, requirements, leases, open tasks,
// owner signals and activity. Read-only for now — edits still go through the
// MCP update tools; the point of this pass is that every record can be opened
// and linked to.

type Contact = {
  id: string;
  display_code: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  mobile_phone: string | null;
  title: string | null;
  notes: string | null;
  needs_verification: boolean | null;
  verification_note: string | null;
  entity: { id: string; name: string; trade_name: string | null } | { id: string; name: string; trade_name: string | null }[] | null;
};

type Affiliation = {
  id: string;
  role: string | null;
  notes: string | null;
  entity: { id: string; name: string } | { id: string; name: string }[] | null;
};

type ProjectLink = {
  id: string;
  role: string | null;
  split_pct: number | null;
  project: {
    id: string;
    project_code: string;
    project_type: string;
    client_name: string;
    status: string;
    expected_value: number | null;
  } | {
    id: string;
    project_code: string;
    project_type: string;
    client_name: string;
    status: string;
    expected_value: number | null;
  }[] | null;
};

type ReqLink = {
  id: string;
  requirement: { id: string; display_code: string | null; deal_type: string | null; property_type: string | null; status: string | null; target_location: string | null } | { id: string; display_code: string | null; deal_type: string | null; property_type: string | null; status: string | null; target_location: string | null }[] | null;
};

type SignalRow = {
  id: string;
  display_code: string | null;
  signal_date: string;
  signal_type: string;
  indicated_price: number | null;
  indicated_rent: number | null;
  indicated_rent_basis: string | null;
  property: { id: string; display_code: string | null; address: string; suite_number: string | null } | { id: string; display_code: string | null; address: string; suite_number: string | null }[] | null;
};

export default async function ContactDetailPage(props: PageProps<"/contacts/[id]">) {
  const { id } = await props.params;

  const results = await Promise.all([
    supabase
      .from("contacts")
      .select(
        "id, display_code, first_name, last_name, email, phone, mobile_phone, title, notes, needs_verification, verification_note, entity:entities!entity_id(id, name, trade_name)"
      )
      .eq("id", id)
      .maybeSingle()
      .returns<Contact | null>(),
    supabase
      .from("contact_entities")
      .select("id, role, notes, entity:entities!entity_id(id, name)")
      .eq("contact_id", id)
      .returns<Affiliation[]>(),
    supabase
      .from("project_contacts")
      .select(
        "id, role, split_pct, project:projects!project_id(id, project_code, project_type, client_name, status, expected_value)"
      )
      .eq("contact_id", id)
      .returns<ProjectLink[]>(),
    supabase
      .from("requirement_parties")
      .select(
        "id, requirement:requirements!requirement_id(id, display_code, deal_type, property_type, status, target_location)"
      )
      .eq("contact_id", id)
      .returns<ReqLink[]>(),
    supabase.from("leases").select(LEASE_SELECT).eq("tenant_contact_id", id).returns<LeaseLite[]>(),
    supabase.from("leases").select(LEASE_SELECT).eq("landlord_contact_id", id).returns<LeaseLite[]>(),
    // Open tasks either about this person or waiting on them.
    supabase
      .from("tasks")
      .select(TASK_SELECT)
      .eq("status", "open")
      .or(`contact_id.eq.${id},waiting_on_contact_id.eq.${id}`)
      .order("due_date", { ascending: true, nullsFirst: false })
      .returns<TaskLite[]>(),
    supabase
      .from("owner_signals")
      .select(
        "id, display_code, signal_date, signal_type, indicated_price, indicated_rent, indicated_rent_basis, property:properties!property_id(id, display_code, address, suite_number)"
      )
      .eq("contact_id", id)
      .order("signal_date", { ascending: false })
      .returns<SignalRow[]>(),
    supabase
      .from("activity_log")
      .select(ACTIVITY_SELECT)
      .eq("contact_id", id)
      .order("activity_date", { ascending: false })
      .limit(100)
      .returns<ActivityLite[]>(),
  ]);
  const [
    { data: contact },
    { data: affiliations },
    { data: projectLinks },
    { data: reqLinks },
    { data: leasesAsTenant },
    { data: leasesAsLandlord },
    { data: tasks },
    { data: signals },
    { data: activity },
  ] = results;
  // Surface any failed query rather than rendering an empty section —
  // an empty list and a broken query otherwise look identical.
  const loadErrors = results
    .map((r) => r.error?.message)
    .filter((m): m is string => !!m);

  if (!contact) notFound();

  const name = [contact.first_name, contact.last_name].filter(Boolean).join(" ") || "Unnamed contact";
  const company = one(contact.entity);
  const otherAffiliations = (affiliations ?? []).filter((a) => one(a.entity)?.id !== company?.id);
  const leases = [...(leasesAsTenant ?? []), ...(leasesAsLandlord ?? [])];

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <Link href="/contacts" className="text-sm text-blue-600 underline">
        ← All contacts
      </Link>

      {loadErrors.length > 0 && (
        <div className="mt-3 border border-red-300 bg-red-50 rounded-lg p-3 text-sm text-red-700">
          Some sections failed to load: {loadErrors.join(" | ")}
        </div>
      )}

      <h1 className="text-2xl font-semibold mt-2 mb-1">
        {name}
        {contact.display_code && (
          <span className="text-gray-400 font-normal"> — {contact.display_code}</span>
        )}
      </h1>
      <p className="text-gray-500 mb-6">
        {contact.title}
        {contact.title && company && " · "}
        {company && (
          <Link href={entityHref(company.id)} className="text-blue-600 underline">
            {company.name}
          </Link>
        )}
      </p>

      <VerificationBanner needs={contact.needs_verification} note={contact.verification_note} />

      <div className="grid grid-cols-3 gap-4 mb-6 border border-gray-200 rounded-lg p-4">
        <Field label="Email">
          {contact.email ? (
            <a href={`mailto:${contact.email}`} className="text-blue-600 underline">
              {contact.email}
            </a>
          ) : (
            "—"
          )}
        </Field>
        <Field label="Phone">
          {contact.phone ? <a href={`tel:${contact.phone}`}>{contact.phone}</a> : "—"}
        </Field>
        <Field label="Mobile">
          {contact.mobile_phone ? <a href={`tel:${contact.mobile_phone}`}>{contact.mobile_phone}</a> : "—"}
        </Field>
      </div>

      <NotesBox text={contact.notes} />

      <Section title="Open tasks" count={tasks?.length ?? 0}>
        <TaskList tasks={tasks ?? []} />
      </Section>

      <Section title="Other companies" count={otherAffiliations.length}>
        {otherAffiliations.length === 0 ? (
          <Empty>No affiliations beyond the primary company.</Empty>
        ) : (
          <ul className="text-sm space-y-1">
            {otherAffiliations.map((a) => {
              const e = one(a.entity);
              if (!e) return null;
              return (
                <li key={a.id}>
                  <Link href={entityHref(e.id)} className="text-blue-600 underline">
                    {e.name}
                  </Link>
                  {a.role && <span className="text-gray-500"> — {a.role}</span>}
                  {a.notes && <span className="text-gray-400"> · {a.notes}</span>}
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section title="Deals" count={projectLinks?.length ?? 0}>
        {(projectLinks ?? []).length === 0 ? (
          <Empty>Not linked to any project.</Empty>
        ) : (
          <ul className="text-sm space-y-1">
            {(projectLinks ?? []).map((pl) => {
              const p = one(pl.project);
              if (!p) return null;
              return (
                <li key={pl.id}>
                  <Link href={projectHref(p.id)} className="text-blue-600 underline">
                    {p.project_code}
                  </Link>{" "}
                  <span className="text-gray-500">
                    {p.project_type} · {p.client_name} · {p.status}
                    {pl.role && <> · role: {pl.role}</>}
                    {pl.split_pct != null && <> · split {pl.split_pct}%</>}
                    {p.expected_value != null && <> · EV {money(p.expected_value)}</>}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section title="Requirements" count={reqLinks?.length ?? 0}>
        {(reqLinks ?? []).length === 0 ? (
          <Empty>No requirements.</Empty>
        ) : (
          <ul className="text-sm space-y-1">
            {(reqLinks ?? []).map((rl) => {
              const r = one(rl.requirement);
              if (!r) return null;
              return (
                <li key={rl.id}>
                  <Link href={requirementHref(r.id)} className="text-blue-600 underline">
                    {r.display_code ?? "Requirement"}
                  </Link>{" "}
                  <span className="text-gray-500">
                    {[r.deal_type, r.property_type, r.target_location, r.status].filter(Boolean).join(" · ")}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section title="Leases (as named tenant or landlord contact)" count={leases.length}>
        <LeaseList leases={leases} />
      </Section>

      {(signals ?? []).length > 0 && (
        <Section title="Owner signals given" count={signals!.length}>
          <p className="text-xs text-amber-700 mb-2">Confidential — not client-facing.</p>
          <ul className="text-sm space-y-1">
            {signals!.map((s) => {
              const p = one(s.property);
              return (
                <li key={s.id}>
                  {s.signal_date} · {s.signal_type}
                  {s.indicated_price != null && <> · {money(s.indicated_price)}</>}
                  {s.indicated_rent != null && (
                    <> · {money(s.indicated_rent)} {s.indicated_rent_basis ?? ""}</>
                  )}
                  {p && (
                    <>
                      {" · "}
                      <Link href={propertyHref(p.id)} className="text-blue-600 underline">
                        {propertyLabel(p)}
                      </Link>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      <Section title="Activity" count={activity?.length ?? 0}>
        <ActivityFeed rows={activity ?? []} hide="contact" />
      </Section>
    </div>
  );
}
