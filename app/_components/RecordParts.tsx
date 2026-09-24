import Link from "next/link";
import {
  contactHref,
  day,
  dueClass,
  entityHref,
  one,
  personName,
  projectHref,
  propertyHref,
  propertyLabel,
  psf,
  sf,
} from "@/lib/records";

// Presentational building blocks shared by the Contact, Property and Entity
// detail pages (9/24/2026). Server components only — no client state — so they
// can be dropped into any page that already fetched its rows.

export function Section({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-8">
      <h2 className="text-lg font-semibold mb-2">
        {title}
        {count != null && <span className="text-gray-400 font-normal"> ({count})</span>}
      </h2>
      {children}
    </section>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-gray-400 text-sm">{children}</p>;
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-gray-500 uppercase tracking-wide">{label}</div>
      <div className="text-sm">{children}</div>
    </div>
  );
}

export function NotesBox({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <p className="text-sm text-gray-600 mb-6 border border-gray-200 rounded-lg p-3 whitespace-pre-wrap">
      {text}
    </p>
  );
}

export function VerificationBanner({
  needs,
  note,
}: {
  needs: boolean | null | undefined;
  note: string | null | undefined;
}) {
  if (!needs) return null;
  return (
    <div className="mb-6 border border-amber-300 bg-amber-50 rounded-lg p-3 text-sm text-amber-800">
      <span className="font-medium">Needs verification.</span> {note ?? ""}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------
type Named = { id: string; first_name: string | null; last_name: string | null };

export type TaskLite = {
  id: string;
  display_code: string | null;
  description: string;
  due_date: string | null;
  status: string;
  category: string | null;
  waiting_on_contact?: Named | Named[] | null;
};

export function TaskList({ tasks }: { tasks: TaskLite[] }) {
  if (tasks.length === 0) return <Empty>No open tasks.</Empty>;
  return (
    <div className="grid gap-2">
      {tasks.map((t) => {
        const waiting = one(t.waiting_on_contact ?? null);
        return (
          <div key={t.id} className="border border-gray-200 rounded-lg p-3">
            <p className="text-sm">{t.description}</p>
            <p className="text-xs text-gray-400 mt-1">
              {t.display_code}
              {t.category && <> · {t.category}</>}
              {t.due_date && (
                <>
                  {" · "}
                  <span className={dueClass(t.due_date)}>Due {t.due_date}</span>
                </>
              )}
              {waiting && (
                <>
                  {" · waiting on "}
                  <Link href={contactHref(waiting.id)} className="text-blue-600 underline">
                    {personName(waiting)}
                  </Link>
                </>
              )}
            </p>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Activity feed — newest first
// ---------------------------------------------------------------------------
type PropLite = { id: string; display_code: string | null; address: string; suite_number: string | null };
type EntLite = { id: string; name: string };
type ProjLite = { id: string; project_code: string };

export type ActivityLite = {
  id: string;
  display_code: string | null;
  activity_type: string;
  activity_date: string;
  summary: string | null;
  next_step: string | null;
  next_step_due_date: string | null;
  contact?: Named | Named[] | null;
  entity?: EntLite | EntLite[] | null;
  property?: PropLite | PropLite[] | null;
  project?: ProjLite | ProjLite[] | null;
};

// `hide` suppresses the link back to the record whose page this is — on a
// contact's page every entry would otherwise repeat that contact's name.
export function ActivityFeed({
  rows,
  hide,
}: {
  rows: ActivityLite[];
  hide?: "contact" | "entity" | "property";
}) {
  if (rows.length === 0) return <Empty>No activity logged.</Empty>;
  return (
    <div className="grid gap-2">
      {rows.map((a) => {
        const c = hide === "contact" ? null : one(a.contact ?? null);
        const e = hide === "entity" ? null : one(a.entity ?? null);
        const p = hide === "property" ? null : one(a.property ?? null);
        const pr = one(a.project ?? null);
        return (
          <div key={a.id} className="border border-gray-200 rounded-lg p-3">
            <p className="text-xs text-gray-400">
              {day(a.activity_date)} · {a.activity_type} · {a.display_code}
              {pr && (
                <>
                  {" · "}
                  <Link href={projectHref(pr.id)} className="text-blue-600 underline">
                    {pr.project_code}
                  </Link>
                </>
              )}
              {p && (
                <>
                  {" · "}
                  <Link href={propertyHref(p.id)} className="text-blue-600 underline">
                    {propertyLabel(p)}
                  </Link>
                </>
              )}
              {e && (
                <>
                  {" · "}
                  <Link href={entityHref(e.id)} className="text-blue-600 underline">
                    {e.name}
                  </Link>
                </>
              )}
              {c && (
                <>
                  {" · "}
                  <Link href={contactHref(c.id)} className="text-blue-600 underline">
                    {personName(c)}
                  </Link>
                </>
              )}
            </p>
            {a.summary && <p className="text-sm mt-1 whitespace-pre-wrap">{a.summary}</p>}
            {a.next_step && (
              <p className="text-xs text-gray-600 mt-1">
                <span className="font-medium">Next:</span> {a.next_step}
                {a.next_step_due_date && (
                  <span className={dueClass(a.next_step_due_date)}> (by {a.next_step_due_date})</span>
                )}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Leases, each with its open lease events
// ---------------------------------------------------------------------------
type EntBrief = { id: string; name: string; trade_name: string | null };
type ConBrief = Named;
type SpaceBrief = {
  id: string;
  suite_number: string | null;
  building_sf: number | null;
  property: PropLite | PropLite[] | null;
};

export type LeaseEventLite = {
  id: string;
  display_code: string | null;
  event_type: string;
  event_date: string | null;
  is_completed: boolean;
  notes: string | null;
};

export type LeaseLite = {
  id: string;
  display_code: string | null;
  lease_start_date: string | null;
  lease_end_date: string | null;
  rent_psf: number | null;
  is_current: boolean;
  master_lease_id: string | null;
  notes: string | null;
  space: SpaceBrief | SpaceBrief[] | null;
  tenant_entity: EntBrief | EntBrief[] | null;
  landlord_entity: EntBrief | EntBrief[] | null;
  tenant_contact: ConBrief | ConBrief[] | null;
  lease_events: LeaseEventLite[] | null;
};

export const LEASE_SELECT =
  "id, display_code, lease_start_date, lease_end_date, rent_psf, is_current, master_lease_id, notes, " +
  "space:spaces!space_id(id, suite_number, building_sf, property:properties!property_id(id, display_code, address, suite_number)), " +
  "tenant_entity:entities!tenant_entity_id(id, name, trade_name), " +
  "landlord_entity:entities!landlord_entity_id(id, name, trade_name), " +
  "tenant_contact:contacts!tenant_contact_id(id, first_name, last_name), " +
  "lease_events(id, display_code, event_type, event_date, is_completed, notes)";

export function LeaseList({
  leases,
  hide,
}: {
  leases: LeaseLite[];
  hide?: "property" | "tenant" | "landlord";
}) {
  if (leases.length === 0) return <Empty>No leases on file.</Empty>;
  // Current leases first, then by expiration soonest.
  const sorted = [...leases].sort((a, b) => {
    if (a.is_current !== b.is_current) return a.is_current ? -1 : 1;
    return (a.lease_end_date ?? "9999").localeCompare(b.lease_end_date ?? "9999");
  });
  return (
    <div className="grid gap-2">
      {sorted.map((l) => {
        const space = one(l.space);
        const prop = space ? one(space.property) : null;
        const tenant = one(l.tenant_entity);
        const landlord = one(l.landlord_entity);
        const tContact = one(l.tenant_contact);
        const openEvents = (l.lease_events ?? [])
          .filter((e) => !e.is_completed)
          .sort((a, b) => (a.event_date ?? "9999").localeCompare(b.event_date ?? "9999"));
        return (
          <div key={l.id} className="border border-gray-200 rounded-lg p-3">
            <p className="text-sm">
              {hide !== "tenant" && tenant && (
                <Link href={entityHref(tenant.id)} className="text-blue-600 underline font-medium">
                  {tenant.trade_name || tenant.name}
                </Link>
              )}
              {hide !== "tenant" && !tenant && tContact && (
                <Link href={contactHref(tContact.id)} className="text-blue-600 underline font-medium">
                  {personName(tContact)}
                </Link>
              )}
              {hide !== "property" && prop && (
                <>
                  {hide !== "tenant" ? " at " : ""}
                  <Link href={propertyHref(prop.id)} className="text-blue-600 underline">
                    {propertyLabel(prop)}
                  </Link>
                </>
              )}
              {space?.suite_number && <> · Suite {space.suite_number}</>}
              {space?.building_sf != null && <> · {sf(space.building_sf)}</>}
            </p>
            <p className="text-xs text-gray-500 mt-1">
              {l.display_code}
              {l.master_lease_id ? " · Sublease" : ""}
              {!l.is_current && " · superseded"}
              {" · "}
              {day(l.lease_start_date)} → {day(l.lease_end_date)}
              {l.rent_psf != null && <> · {psf(l.rent_psf)}</>}
              {hide !== "landlord" && landlord && (
                <>
                  {" · LL "}
                  <Link href={entityHref(landlord.id)} className="text-blue-600 underline">
                    {landlord.name}
                  </Link>
                </>
              )}
            </p>
            {openEvents.length > 0 && (
              <ul className="mt-2 text-xs space-y-1">
                {openEvents.map((e) => (
                  <li key={e.id}>
                    <span className={dueClass(e.event_date)}>
                      {e.event_date ?? "no confirmed date"}
                    </span>{" "}
                    — {e.event_type}{" "}
                    <span className="text-gray-400">{e.display_code}</span>
                    {e.notes && /DERIVED|NOT CONFIRMED|unconfirmed/i.test(e.notes) && (
                      <span className="ml-1 text-amber-700">(derived — confirm)</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

export const ACTIVITY_SELECT =
  "id, display_code, activity_type, activity_date, summary, next_step, next_step_due_date, " +
  "contact:contacts!contact_id(id, first_name, last_name), " +
  "entity:entities!entity_id(id, name), " +
  "property:properties!property_id(id, display_code, address, suite_number), " +
  "project:projects!project_id(id, project_code)";

export const TASK_SELECT =
  "id, display_code, description, due_date, status, category, " +
  "waiting_on_contact:contacts!waiting_on_contact_id(id, first_name, last_name)";
