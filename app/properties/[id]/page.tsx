import Link from "next/link";
import { notFound } from "next/navigation";
import { supabase } from "@/lib/supabase";
import {
  contactHref,
  entityHref,
  money,
  one,
  personName,
  projectHref,
  propertyHref,
  propertyLabel,
  psf,
  sf,
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

// Property detail page (9/24/2026). Everything hangs off a property, so this
// is the widest of the three pages: ownership, tenancy, the Space/Lease model
// with open lease events, deals it is a candidate on, owner signals, comps,
// expenses, reference links, tasks and activity.

type PropLite = { id: string; display_code: string | null; address: string; suite_number: string | null };

type Property = {
  id: string;
  display_code: string | null;
  address: string;
  suite_number: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  county: string | null;
  parcel_number: string | null;
  property_type: string | null;
  submarket: string | null;
  building_sf: number | null;
  land_acres: number | null;
  year_built: number | null;
  market_status: string | null;
  research_status: string | null;
  priority: string | null;
  notes: string | null;
  parent_property_id: string | null;
  parent: PropLite | PropLite[] | null;
};

type EntBrief = { id: string; name: string };
type ConBrief = { id: string; first_name: string | null; last_name: string | null };

type OwnerRow = {
  id: string;
  is_current: boolean;
  is_headquarters: boolean;
  ownership_start_date: string | null;
  ownership_end_date: string | null;
  entity: EntBrief | EntBrief[] | null;
};

type TenantRow = {
  id: string;
  is_current: boolean;
  lease_start_date: string | null;
  lease_end_date: string | null;
  notes: string | null;
  entity: EntBrief | EntBrief[] | null;
  contact: ConBrief | ConBrief[] | null;
};

type SpaceRow = {
  id: string;
  display_code: string | null;
  suite_number: string | null;
  building_sf: number | null;
  space_status: string;
};

type CandidateRow = {
  id: string;
  status: string;
  project: { id: string; project_code: string; client_name: string; status: string } | { id: string; project_code: string; client_name: string; status: string }[] | null;
};

type SignalRow = {
  id: string;
  display_code: string | null;
  signal_date: string;
  signal_type: string;
  source: string | null;
  indicated_price: number | null;
  indicated_rent: number | null;
  indicated_rent_basis: string | null;
  conditions: string | null;
  contact: ConBrief | ConBrief[] | null;
};

type SaleComp = { id: string; sale_date: string | null; sale_price: number | null; price_per_sf: number | null; cap_rate: number | null; buyer: string | null; seller: string | null };
type LeaseComp = { id: string; lease_date: string | null; tenant: string | null; sf: number | null; final_rent: number | null; lease_term_months: number | null };
type Expense = { id: string; year: number; category: string; amount: number };
type RefLink = { id: string; label: string; url: string | null; link_type: string | null; notes: string | null };

export default async function PropertyDetailPage(props: PageProps<"/properties/[id]">) {
  const { id } = await props.params;

  const { data: property } = await supabase
    .from("properties")
    .select(
      "id, display_code, address, suite_number, city, state, zip, county, parcel_number, property_type, submarket, building_sf, land_acres, year_built, market_status, research_status, priority, notes, parent_property_id, parent:properties!parent_property_id(id, display_code, address, suite_number)"
    )
    .eq("id", id)
    .maybeSingle()
    .returns<Property | null>();

  if (!property) notFound();

  const results = await Promise.all([
    supabase
      .from("properties")
      .select("id, display_code, address, suite_number")
      .eq("parent_property_id", id)
      .returns<PropLite[]>(),
    supabase
      .from("property_owner")
      .select("id, is_current, is_headquarters, ownership_start_date, ownership_end_date, entity:entities!entity_id(id, name)")
      .eq("property_id", id)
      .returns<OwnerRow[]>(),
    supabase
      .from("property_tenant")
      .select("id, is_current, lease_start_date, lease_end_date, notes, entity:entities!entity_id(id, name), contact:contacts!contact_id(id, first_name, last_name)")
      .eq("property_id", id)
      .returns<TenantRow[]>(),
    supabase
      .from("spaces")
      .select("id, display_code, suite_number, building_sf, space_status")
      .eq("property_id", id)
      .order("suite_number", { ascending: true })
      .returns<SpaceRow[]>(),
    supabase
      .from("project_properties")
      .select("id, status, project:projects!project_id(id, project_code, client_name, status)")
      .eq("property_id", id)
      .returns<CandidateRow[]>(),
    supabase
      .from("owner_signals")
      .select("id, display_code, signal_date, signal_type, source, indicated_price, indicated_rent, indicated_rent_basis, conditions, contact:contacts!contact_id(id, first_name, last_name)")
      .eq("property_id", id)
      .order("signal_date", { ascending: false })
      .returns<SignalRow[]>(),
    supabase
      .from("sale_comps")
      .select("id, sale_date, sale_price, price_per_sf, cap_rate, buyer, seller")
      .eq("property_id", id)
      .order("sale_date", { ascending: false })
      .returns<SaleComp[]>(),
    supabase
      .from("lease_comps")
      .select("id, lease_date, tenant, sf, final_rent, lease_term_months")
      .eq("property_id", id)
      .order("lease_date", { ascending: false })
      .returns<LeaseComp[]>(),
    supabase
      .from("property_expenses")
      .select("id, year, category, amount")
      .eq("property_id", id)
      .order("year", { ascending: false })
      .returns<Expense[]>(),
    supabase
      .from("reference_links")
      .select("id, label, url, link_type, notes")
      .eq("property_id", id)
      .returns<RefLink[]>(),
    supabase
      .from("tasks")
      .select(TASK_SELECT)
      .eq("status", "open")
      .eq("property_id", id)
      .order("due_date", { ascending: true, nullsFirst: false })
      .returns<TaskLite[]>(),
    supabase
      .from("activity_log")
      .select(ACTIVITY_SELECT)
      .eq("property_id", id)
      .order("activity_date", { ascending: false })
      .limit(100)
      .returns<ActivityLite[]>(),
  ]);
  const [
    { data: children },
    { data: owners },
    { data: tenants },
    { data: spaces },
    { data: candidates },
    { data: signals },
    { data: saleComps },
    { data: leaseComps },
    { data: expenses },
    { data: refLinks },
    { data: tasks },
    { data: activity },
  ] = results;
  // Surface any failed query rather than rendering an empty section —
  // an empty list and a broken query otherwise look identical.
  const loadErrors = results
    .map((r) => r.error?.message)
    .filter((m): m is string => !!m);

  // Leases hang off spaces, so they need the space ids first.
  const spaceIds = (spaces ?? []).map((s) => s.id);
  const { data: leases, error: leaseError } = spaceIds.length
    ? await supabase.from("leases").select(LEASE_SELECT).in("space_id", spaceIds).returns<LeaseLite[]>()
    : { data: [] as LeaseLite[], error: null };
  if (leaseError) loadErrors.push(`leases: ${leaseError.message}`);

  const parent = one(property.parent);

  const allContacts = await contactOptions();
  const here = `/properties/${id}`;
  const cityLine = [property.city, property.state, property.zip].filter(Boolean).join(", ");

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <Link href="/properties" className="text-sm text-blue-600 underline">
        ← All properties
      </Link>

      {loadErrors.length > 0 && (
        <div className="mt-3 border border-red-300 bg-red-50 rounded-lg p-3 text-sm text-red-700">
          Some sections failed to load: {loadErrors.join(" | ")}
        </div>
      )}

      <h1 className="text-2xl font-semibold mt-2 mb-1">
        {property.address}
        {property.suite_number && ` #${property.suite_number}`}
        {property.display_code && (
          <span className="text-gray-400 font-normal"> — {property.display_code}</span>
        )}
      </h1>
      <p className="text-gray-500 mb-6">
        {cityLine}
        {parent && (
          <>
            {" · space inside "}
            <Link href={propertyHref(parent.id)} className="text-blue-600 underline">
              {propertyLabel(parent)}
            </Link>
          </>
        )}
      </p>

      <div className="grid grid-cols-4 gap-4 mb-6 border border-gray-200 rounded-lg p-4">
        <Field label="Type">{property.property_type ?? "—"}</Field>
        <Field label="Building">{sf(property.building_sf)}</Field>
        <Field label="Land">{property.land_acres != null ? `${property.land_acres} ac` : "—"}</Field>
        <Field label="Year built">{property.year_built ?? "—"}</Field>
        <Field label="Submarket">{property.submarket ?? "—"}</Field>
        <Field label="Parcel">{property.parcel_number ?? "—"}</Field>
        <Field label="Market status">{property.market_status ?? "—"}</Field>
        <Field label="Research">{property.research_status ?? "—"}</Field>
      </div>

      <NotesBox text={property.notes} />

      <LogActivityForm
        returnPath={here}
        propertyId={property.id}
        projects={(candidates ?? [])
          .map((c) => one(c.project))
          .filter((p): p is NonNullable<typeof p> => !!p)
          .map((p) => ({ id: p.id, label: `${p.project_code} — ${p.client_name}` }))}
        allContacts={allContacts}
      />

      <Section title="Open tasks" count={tasks?.length ?? 0}>
        <TaskList tasks={tasks ?? []} returnPath={here} contacts={allContacts} />
      </Section>

      <Section title="Ownership" count={owners?.length ?? 0}>
        {(owners ?? []).length === 0 ? (
          <Empty>Owner not researched yet.</Empty>
        ) : (
          <ul className="text-sm space-y-1">
            {(owners ?? []).map((o) => {
              const e = one(o.entity);
              return (
                <li key={o.id}>
                  {e ? (
                    <Link href={entityHref(e.id)} className="text-blue-600 underline">
                      {e.name}
                    </Link>
                  ) : (
                    "Unknown entity"
                  )}
                  <span className="text-gray-500">
                    {o.is_current ? " · current" : " · former"}
                    {o.is_headquarters && " · owner-occupied HQ"}
                    {o.ownership_start_date && <> · since {o.ownership_start_date}</>}
                    {o.ownership_end_date && <> · until {o.ownership_end_date}</>}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section title="Spaces & leases" count={spaces?.length ?? 0}>
        {(spaces ?? []).length > 0 && (
          <p className="text-sm text-gray-500 mb-2">
            {(spaces ?? [])
              .map((s) => `${s.suite_number ?? s.display_code ?? "Space"} (${s.space_status}${s.building_sf != null ? `, ${Math.round(s.building_sf).toLocaleString()} SF` : ""})`)
              .join(" · ")}
          </p>
        )}
        <LeaseList leases={leases ?? []} hide="property" />
      </Section>

      {(tenants ?? []).length > 0 && (
        <Section title="Tenancy links (legacy)" count={tenants!.length}>
          <ul className="text-sm space-y-1">
            {tenants!.map((t) => {
              const e = one(t.entity);
              const c = one(t.contact);
              return (
                <li key={t.id}>
                  {e && (
                    <Link href={entityHref(e.id)} className="text-blue-600 underline">
                      {e.name}
                    </Link>
                  )}
                  {!e && c && (
                    <Link href={contactHref(c.id)} className="text-blue-600 underline">
                      {personName(c)}
                    </Link>
                  )}
                  <span className="text-gray-500">
                    {t.is_current ? " · current" : " · former"}
                    {(t.lease_start_date || t.lease_end_date) && (
                      <> · {t.lease_start_date ?? "?"} → {t.lease_end_date ?? "?"}</>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      {(children ?? []).length > 0 && (
        <Section title="Suites recorded as child properties" count={children!.length}>
          <ul className="text-sm space-y-1">
            {children!.map((c) => (
              <li key={c.id}>
                <Link href={propertyHref(c.id)} className="text-blue-600 underline">
                  {propertyLabel(c)}
                </Link>
                {c.display_code && <span className="text-gray-400"> {c.display_code}</span>}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Deals" count={candidates?.length ?? 0}>
        {(candidates ?? []).length === 0 ? (
          <Empty>Not on any project.</Empty>
        ) : (
          <ul className="text-sm space-y-1">
            {(candidates ?? []).map((c) => {
              const p = one(c.project);
              if (!p) return null;
              return (
                <li key={c.id}>
                  <Link href={projectHref(p.id)} className="text-blue-600 underline">
                    {p.project_code}
                  </Link>
                  <span className="text-gray-500"> · {p.client_name} · {c.status}</span>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      {(signals ?? []).length > 0 && (
        <Section title="Owner signals" count={signals!.length}>
          <p className="text-xs text-amber-700 mb-2">Confidential — not client-facing. Newest first.</p>
          <ul className="text-sm space-y-1">
            {signals!.map((s) => {
              const c = one(s.contact);
              return (
                <li key={s.id}>
                  {s.signal_date} · {s.signal_type}
                  {s.indicated_price != null && <> · {money(s.indicated_price)}</>}
                  {s.indicated_rent != null && <> · {money(s.indicated_rent)} {s.indicated_rent_basis ?? ""}</>}
                  {s.source && <span className="text-gray-500"> · {s.source}</span>}
                  {c && (
                    <>
                      {" · "}
                      <Link href={contactHref(c.id)} className="text-blue-600 underline">
                        {personName(c)}
                      </Link>
                    </>
                  )}
                  {s.conditions && <span className="text-gray-500"> · {s.conditions}</span>}
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      {((saleComps ?? []).length > 0 || (leaseComps ?? []).length > 0) && (
        <Section title="Comps" count={(saleComps?.length ?? 0) + (leaseComps?.length ?? 0)}>
          <ul className="text-sm space-y-1">
            {(saleComps ?? []).map((c) => (
              <li key={c.id}>
                Sale {c.sale_date ?? "—"} · {money(c.sale_price)}
                {c.price_per_sf != null && <> · {psf(c.price_per_sf)}</>}
                {c.cap_rate != null && <> · {c.cap_rate}% cap</>}
                {(c.buyer || c.seller) && <span className="text-gray-500"> · {c.seller ?? "?"} → {c.buyer ?? "?"}</span>}
              </li>
            ))}
            {(leaseComps ?? []).map((c) => (
              <li key={c.id}>
                Lease {c.lease_date ?? "—"} · {c.tenant ?? "—"} · {sf(c.sf)}
                {c.final_rent != null && <> · {psf(c.final_rent)}</>}
                {c.lease_term_months != null && <> · {c.lease_term_months} mo</>}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {(expenses ?? []).length > 0 && (
        <Section title="Expenses" count={expenses!.length}>
          <ul className="text-sm space-y-1">
            {expenses!.map((x) => (
              <li key={x.id}>
                {x.year} · {x.category} · {money(x.amount)}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {(refLinks ?? []).length > 0 && (
        <Section title="Reference links" count={refLinks!.length}>
          <ul className="text-sm space-y-1">
            {refLinks!.map((r) => (
              <li key={r.id}>
                {r.url ? (
                  <a href={r.url} target="_blank" rel="noreferrer" className="text-blue-600 underline">
                    {r.label}
                  </a>
                ) : (
                  r.label
                )}
                {r.notes && <span className="text-gray-500"> · {r.notes}</span>}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Activity" count={activity?.length ?? 0}>
        <ActivityFeed rows={activity ?? []} hide="property" />
      </Section>
    </div>
  );
}
