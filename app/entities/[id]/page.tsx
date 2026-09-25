import Link from "next/link";
import { notFound } from "next/navigation";
import { supabase } from "@/lib/supabase";
import {
  contactHref,
  money,
  one,
  personName,
  projectHref,
  propertyHref,
  propertyLabel,
  requirementHref,
} from "@/lib/records";
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
  type ActivityLite,
  type LeaseLite,
  type TaskLite,
} from "@/app/_components/RecordParts";
import { LogActivityForm } from "@/app/_components/LogActivityForm";
import { contactOptions } from "@/lib/contactOptions";

export const dynamic = "force-dynamic";

// Entity (company / owner LLC) detail page (9/24/2026). Roles are shown as
// they are recorded on the relationships — owner here, tenant there, landlord
// on a sublease — rather than as a declared type, per the 9/22/2026 principle
// that roles belong on relationships, not on the record. This is the first
// cut of the "company roll-up page" from the Palm Beach Tan multi-role work.

type Entity = {
  id: string;
  display_code: string | null;
  name: string;
  trade_name: string | null;
  entity_type: string | null;
  industry: string | null;
  website: string | null;
  notes: string | null;
  primary_contact: { id: string; first_name: string | null; last_name: string | null } | { id: string; first_name: string | null; last_name: string | null }[] | null;
};

type ConBrief = { id: string; display_code: string | null; first_name: string | null; last_name: string | null; title: string | null; email: string | null; phone: string | null };
type Alias = { id: string; alias: string; source: string | null };
type Affil = { id: string; role: string | null; contact: ConBrief | ConBrief[] | null };
type PropLite = { id: string; display_code: string | null; address: string; suite_number: string | null; city: string | null };
type OwnerRow = { id: string; is_current: boolean; is_headquarters: boolean; ownership_start_date: string | null; property: PropLite | PropLite[] | null };
type TenantRow = { id: string; is_current: boolean; lease_end_date: string | null; property: PropLite | PropLite[] | null };
type ProjectLink = { id: string; role: string | null; split_pct: number | null; project: { id: string; project_code: string; project_type: string; client_name: string; status: string } | { id: string; project_code: string; project_type: string; client_name: string; status: string }[] | null };
type ReqLink = { id: string; requirement: { id: string; display_code: string | null; deal_type: string | null; property_type: string | null; status: string | null; target_location: string | null } | { id: string; display_code: string | null; deal_type: string | null; property_type: string | null; status: string | null; target_location: string | null }[] | null };
type SignalRow = { id: string; signal_date: string; signal_type: string; indicated_price: number | null; indicated_rent: number | null; indicated_rent_basis: string | null; property: PropLite | PropLite[] | null };

export default async function EntityDetailPage(props: PageProps<"/entities/[id]">) {
  const { id } = await props.params;

  const results = await Promise.all([
    supabase
      .from("entities")
      .select("id, display_code, name, trade_name, entity_type, industry, website, notes, primary_contact:contacts!primary_contact_id(id, first_name, last_name)")
      .eq("id", id)
      .maybeSingle()
      .returns<Entity | null>(),
    supabase.from("entity_aliases").select("id, alias, source").eq("entity_id", id).returns<Alias[]>(),
    supabase
      .from("contacts")
      .select("id, display_code, first_name, last_name, title, email, phone")
      .eq("entity_id", id)
      .order("last_name", { ascending: true })
      .returns<ConBrief[]>(),
    supabase
      .from("contact_entities")
      .select("id, role, contact:contacts!contact_id(id, display_code, first_name, last_name, title, email, phone)")
      .eq("entity_id", id)
      .returns<Affil[]>(),
    supabase
      .from("property_owner")
      .select("id, is_current, is_headquarters, ownership_start_date, property:properties!property_id(id, display_code, address, suite_number, city)")
      .eq("entity_id", id)
      .returns<OwnerRow[]>(),
    supabase
      .from("property_tenant")
      .select("id, is_current, lease_end_date, property:properties!property_id(id, display_code, address, suite_number, city)")
      .eq("entity_id", id)
      .returns<TenantRow[]>(),
    supabase.from("leases").select(LEASE_SELECT).eq("tenant_entity_id", id).returns<LeaseLite[]>(),
    supabase.from("leases").select(LEASE_SELECT).eq("landlord_entity_id", id).returns<LeaseLite[]>(),
    supabase
      .from("project_contacts")
      .select("id, role, split_pct, project:projects!project_id(id, project_code, project_type, client_name, status)")
      .eq("entity_id", id)
      .returns<ProjectLink[]>(),
    supabase
      .from("requirement_parties")
      .select("id, requirement:requirements!requirement_id(id, display_code, deal_type, property_type, status, target_location)")
      .eq("entity_id", id)
      .returns<ReqLink[]>(),
    supabase
      .from("owner_signals")
      .select("id, signal_date, signal_type, indicated_price, indicated_rent, indicated_rent_basis, property:properties!property_id(id, display_code, address, suite_number, city)")
      .eq("entity_id", id)
      .order("signal_date", { ascending: false })
      .returns<SignalRow[]>(),
    supabase
      .from("tasks")
      .select(TASK_SELECT)
      .eq("status", "open")
      .eq("entity_id", id)
      .order("due_date", { ascending: true, nullsFirst: false })
      .returns<TaskLite[]>(),
    supabase
      .from("activity_log")
      .select(ACTIVITY_SELECT)
      .eq("entity_id", id)
      .order("activity_date", { ascending: false })
      .limit(100)
      .returns<ActivityLite[]>(),
  ]);
  const [
    { data: entity },
    { data: aliases },
    { data: employees },
    { data: affiliations },
    { data: owned },
    { data: tenancies },
    { data: leasesAsTenant },
    { data: leasesAsLandlord },
    { data: projectLinks },
    { data: reqLinks },
    { data: signals },
    { data: tasks },
    { data: activity },
  ] = results;
  // Surface any failed query rather than rendering an empty section —
  // an empty list and a broken query otherwise look identical.
  const loadErrors = results
    .map((r) => r.error?.message)
    .filter((m): m is string => !!m);

  if (!entity) notFound();

  // People: primary employer rows plus contact_entities affiliations, deduped.
  const people = new Map<string, { contact: ConBrief; role: string | null }>();
  for (const c of employees ?? []) people.set(c.id, { contact: c, role: null });
  for (const a of affiliations ?? []) {
    const c = one(a.contact);
    if (!c) continue;
    const existing = people.get(c.id);
    people.set(c.id, { contact: c, role: a.role ?? existing?.role ?? null });
  }
  const primary = one(entity.primary_contact);

  const allContacts = await contactOptions();
  const here = `/entities/${id}`;

  // Roles derived from the relationships actually on file.
  const roles: string[] = [];
  if ((owned ?? []).some((o) => o.is_current)) roles.push("Owner");
  if ((leasesAsTenant ?? []).some((l) => l.is_current) || (tenancies ?? []).some((t) => t.is_current)) roles.push("Tenant");
  if ((leasesAsLandlord ?? []).some((l) => l.is_current)) roles.push("Landlord");
  if ((projectLinks ?? []).length > 0) roles.push("Deal party");
  if ((reqLinks ?? []).length > 0) roles.push("Requirement");

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <Link href="/entities" className="text-sm text-blue-600 underline">
        ← All entities
      </Link>

      {loadErrors.length > 0 && (
        <div className="mt-3 border border-red-300 bg-red-50 rounded-lg p-3 text-sm text-red-700">
          Some sections failed to load: {loadErrors.join(" | ")}
        </div>
      )}

      <h1 className="text-2xl font-semibold mt-2 mb-1">
        {entity.name}
        {entity.display_code && <span className="text-gray-400 font-normal"> — {entity.display_code}</span>}
      </h1>
      <p className="text-gray-500 mb-2">
        {entity.trade_name && <>d/b/a {entity.trade_name} · </>}
        {[entity.entity_type, entity.industry].filter(Boolean).join(" · ")}
      </p>
      {roles.length > 0 && (
        <p className="mb-6 flex gap-2 flex-wrap">
          {roles.map((r) => (
            <span key={r} className="text-xs border border-gray-300 rounded px-2 py-0.5 text-gray-700">
              {r}
            </span>
          ))}
        </p>
      )}

      <div className="grid grid-cols-3 gap-4 mb-6 border border-gray-200 rounded-lg p-4">
        <Field label="Primary contact">
          {primary ? (
            <Link href={contactHref(primary.id)} className="text-blue-600 underline">
              {personName(primary)}
            </Link>
          ) : (
            "—"
          )}
        </Field>
        <Field label="Website">
          {entity.website ? (
            <a href={entity.website.startsWith("http") ? entity.website : `https://${entity.website}`} target="_blank" rel="noreferrer" className="text-blue-600 underline">
              {entity.website}
            </a>
          ) : (
            "—"
          )}
        </Field>
        <Field label="Also known as">
          {(aliases ?? []).length ? (aliases ?? []).map((a) => a.alias).join("; ") : "—"}
        </Field>
      </div>

      <NotesBox text={entity.notes} />

      <LogActivityForm
        returnPath={here}
        entityId={entity.id}
        projects={(projectLinks ?? [])
          .map((pl) => one(pl.project))
          .filter((p): p is NonNullable<typeof p> => !!p)
          .map((p) => ({ id: p.id, label: `${p.project_code} — ${p.client_name}` }))}
        preferredContacts={allContacts.filter((c) => people.has(c.id))}
        allContacts={allContacts}
      />

      <Section title="Open tasks" count={tasks?.length ?? 0}>
        <TaskList tasks={tasks ?? []} returnPath={here} contacts={allContacts} />
      </Section>

      <Section title="People" count={people.size}>
        {people.size === 0 ? (
          <Empty>No contacts on file for this company.</Empty>
        ) : (
          <ul className="text-sm space-y-1">
            {Array.from(people.values()).map(({ contact: c, role }) => (
              <li key={c.id}>
                <Link href={contactHref(c.id)} className="text-blue-600 underline">
                  {personName(c)}
                </Link>
                <span className="text-gray-500">
                  {c.title && <> · {c.title}</>}
                  {role && <> · {role}</>}
                  {c.phone && <> · {c.phone}</>}
                  {c.email && <> · {c.email}</>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Properties owned" count={owned?.length ?? 0}>
        {(owned ?? []).length === 0 ? (
          <Empty>No ownership on file.</Empty>
        ) : (
          <ul className="text-sm space-y-1">
            {(owned ?? []).map((o) => {
              const p = one(o.property);
              if (!p) return null;
              return (
                <li key={o.id}>
                  <Link href={propertyHref(p.id)} className="text-blue-600 underline">
                    {propertyLabel(p)}
                  </Link>
                  <span className="text-gray-500">
                    {o.is_current ? " · current" : " · former"}
                    {o.is_headquarters && " · HQ"}
                    {o.ownership_start_date && <> · since {o.ownership_start_date}</>}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section title="Leases as tenant" count={leasesAsTenant?.length ?? 0}>
        <LeaseList leases={leasesAsTenant ?? []} hide="tenant" />
      </Section>

      {(leasesAsLandlord ?? []).length > 0 && (
        <Section title="Leases as landlord" count={leasesAsLandlord!.length}>
          <LeaseList leases={leasesAsLandlord!} hide="landlord" />
        </Section>
      )}

      {(tenancies ?? []).length > 0 && (
        <Section title="Tenancy links (legacy)" count={tenancies!.length}>
          <ul className="text-sm space-y-1">
            {tenancies!.map((t) => {
              const p = one(t.property);
              if (!p) return null;
              return (
                <li key={t.id}>
                  <Link href={propertyHref(p.id)} className="text-blue-600 underline">
                    {propertyLabel(p)}
                  </Link>
                  <span className="text-gray-500">
                    {t.is_current ? " · current" : " · former"}
                    {t.lease_end_date && <> · ends {t.lease_end_date}</>}
                  </span>
                </li>
              );
            })}
          </ul>
        </Section>
      )}

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
                  </Link>
                  <span className="text-gray-500">
                    {" "}
                    {p.project_type} · {p.client_name} · {p.status}
                    {pl.role && <> · {pl.role}</>}
                    {pl.split_pct != null && <> · split {pl.split_pct}%</>}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      {(reqLinks ?? []).length > 0 && (
        <Section title="Requirements" count={reqLinks!.length}>
          <ul className="text-sm space-y-1">
            {reqLinks!.map((rl) => {
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
        </Section>
      )}

      {(signals ?? []).length > 0 && (
        <Section title="Owner signals" count={signals!.length}>
          <p className="text-xs text-amber-700 mb-2">Confidential — not client-facing.</p>
          <ul className="text-sm space-y-1">
            {signals!.map((s) => {
              const p = one(s.property);
              return (
                <li key={s.id}>
                  {s.signal_date} · {s.signal_type}
                  {s.indicated_price != null && <> · {money(s.indicated_price)}</>}
                  {s.indicated_rent != null && <> · {money(s.indicated_rent)} {s.indicated_rent_basis ?? ""}</>}
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
        <ActivityFeed rows={activity ?? []} hide="entity" />
      </Section>
    </div>
  );
}
