import Link from "next/link";
import { notFound } from "next/navigation";
import { supabase } from "@/lib/supabase";
import {
  addRequirementParty,
  removeRequirementParty,
  updateRequirementStatus,
} from "./actions";

export const dynamic = "force-dynamic";

type Requirement = {
  id: string;
  display_code: string | null;
  deal_type: string | null;
  property_type: string | null;
  size_min: number | null;
  size_max: number | null;
  budget_min: number | null;
  budget_max: number | null;
  target_location: string | null;
  timeline: string | null;
  status: string;
  priority: string | null;
  details: string | null;
  source: string | null;
};

type NamedContact = { id: string; first_name: string | null; last_name: string | null };
type NamedEntity = { id: string; name: string };

type PartyRow = {
  id: string;
  contact: NamedContact | NamedContact[] | null;
  entity: NamedEntity | NamedEntity[] | null;
};

type PropertyMatch = {
  id: string;
  display_code: string | null;
  address: string;
  suite_number: string | null;
  property_type: string | null;
  building_sf: number | null;
  market_status: string | null;
};

const STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "on_hold", label: "On Hold" },
  { value: "fulfilled", label: "Fulfilled" },
  { value: "dead", label: "Dead" },
];

function one<T>(v: T | T[] | null): T | null {
  if (!v) return null;
  return Array.isArray(v) ? v[0] ?? null : v;
}

function contactName(c: NamedContact | null): string {
  if (!c) return null as unknown as string;
  return [c.first_name, c.last_name].filter(Boolean).join(" ") || "Unnamed contact";
}

function formatNumber(n: number | null): string {
  if (n === null || n === undefined) return "";
  return new Intl.NumberFormat("en-US").format(n);
}

function rangeLabel(min: number | null, max: number | null, prefix = ""): string {
  if (min === null && max === null) return "—";
  if (min !== null && max !== null)
    return `${prefix}${formatNumber(min)}–${prefix}${formatNumber(max)}`;
  if (min !== null) return `${prefix}${formatNumber(min)}+`;
  return `up to ${prefix}${formatNumber(max)}`;
}

function marketStatusLabel(v: string | null): string {
  switch (v) {
    case "on_market":
      return "On Market";
    case "off_market":
      return "Off-Market";
    case "sold":
      return "Sold";
    case "leased":
      return "Leased";
    default:
      return v ?? "—";
  }
}

export default async function RequirementDetailPage(
  props: PageProps<"/requirements/[id]">
) {
  const { id } = await props.params;

  const [{ data: requirement }, { data: parties }, { data: contacts }, { data: entities }] =
    await Promise.all([
      supabase
        .from("requirements")
        .select(
          "id, display_code, deal_type, property_type, size_min, size_max, budget_min, budget_max, target_location, timeline, status, priority, details, source"
        )
        .eq("id", id)
        .maybeSingle()
        .returns<Requirement | null>(),
      supabase
        .from("requirement_parties")
        .select(
          "id, contact:contacts!contact_id(id, first_name, last_name), entity:entities!entity_id(id, name)"
        )
        .eq("requirement_id", id)
        .order("created_at", { ascending: false })
        .returns<PartyRow[]>(),
      supabase
        .from("contacts")
        .select("id, first_name, last_name")
        .order("first_name", { ascending: true })
        .returns<{ id: string; first_name: string | null; last_name: string | null }[]>(),
      supabase
        .from("entities")
        .select("id, name")
        .order("name", { ascending: true })
        .returns<{ id: string; name: string }[]>(),
    ]);

  if (!requirement) notFound();

  let matches: PropertyMatch[] = [];
  if (requirement.property_type) {
    let query = supabase
      .from("properties")
      .select("id, display_code, address, suite_number, property_type, building_sf, market_status")
      .eq("property_type", requirement.property_type)
      .in("market_status", ["on_market", "off_market"])
      .order("created_at", { ascending: false })
      .limit(20);

    if (requirement.size_min !== null) query = query.gte("building_sf", requirement.size_min);
    if (requirement.size_max !== null) query = query.lte("building_sf", requirement.size_max);

    const { data } = await query.returns<PropertyMatch[]>();
    matches = data ?? [];
  }

  const linkedContactIds = new Set(
    (parties ?? []).map((p) => one(p.contact)?.id).filter(Boolean)
  );
  const linkedEntityIds = new Set(
    (parties ?? []).map((p) => one(p.entity)?.id).filter(Boolean)
  );
  const availableContacts = (contacts ?? []).filter((c) => !linkedContactIds.has(c.id));
  const availableEntities = (entities ?? []).filter((e) => !linkedEntityIds.has(e.id));

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <Link href="/requirements" className="text-sm text-blue-600 underline">
        ← All requirements
      </Link>

      <div className="flex items-center justify-between mt-2 mb-1">
        <h1 className="text-2xl font-semibold">
          {requirement.display_code}
          {requirement.deal_type && (
            <span className="text-gray-400 font-normal"> — {requirement.deal_type}</span>
          )}
        </h1>
        <form action={updateRequirementStatus} className="flex items-center gap-2">
          <input type="hidden" name="id" value={requirement.id} />
          <select
            name="status"
            defaultValue={requirement.status}
            className="border border-gray-300 rounded px-2 py-1 text-sm"
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="text-xs border border-gray-300 rounded px-2 py-1 hover:bg-gray-50"
          >
            Update
          </button>
        </form>
      </div>

      <p className="text-gray-500 mb-6">
        {requirement.property_type ?? "Any property type"}
        {requirement.target_location && <> · {requirement.target_location}</>}
        {" · "}
        {rangeLabel(requirement.size_min, requirement.size_max)} SF
        {" · "}
        {rangeLabel(requirement.budget_min, requirement.budget_max, "$")}
        {requirement.timeline && <> · {requirement.timeline}</>}
        {requirement.priority && <> · Priority: {requirement.priority}</>}
        {requirement.source && <> · Source: {requirement.source}</>}
      </p>

      {requirement.details && (
        <p className="text-sm text-gray-600 mb-8 border border-gray-200 rounded-lg p-3">
          {requirement.details}
        </p>
      )}

      <h2 className="text-lg font-semibold mb-3">Linked contacts &amp; entities</h2>

      <div className="grid grid-cols-2 gap-4 mb-6">
        <form
          action={addRequirementParty}
          className="flex gap-2 border border-gray-200 rounded-lg p-3"
        >
          <input type="hidden" name="requirement_id" value={requirement.id} />
          <select
            name="contact_id"
            defaultValue=""
            className="border border-gray-300 rounded px-2 py-2 flex-1 text-sm"
          >
            <option value="" disabled>
              Link a contact…
            </option>
            {availableContacts.map((c) => (
              <option key={c.id} value={c.id}>
                {[c.first_name, c.last_name].filter(Boolean).join(" ") || "Unnamed contact"}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="text-xs bg-black text-white rounded px-3 py-2"
          >
            Link
          </button>
        </form>

        <form
          action={addRequirementParty}
          className="flex gap-2 border border-gray-200 rounded-lg p-3"
        >
          <input type="hidden" name="requirement_id" value={requirement.id} />
          <select
            name="entity_id"
            defaultValue=""
            className="border border-gray-300 rounded px-2 py-2 flex-1 text-sm"
          >
            <option value="" disabled>
              Link an entity…
            </option>
            {availableEntities.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="text-xs bg-black text-white rounded px-3 py-2"
          >
            Link
          </button>
        </form>
      </div>

      <table className="w-full text-sm border-collapse mb-10">
        <thead>
          <tr className="text-left border-b border-gray-300">
            <th className="py-2 pr-3">Type</th>
            <th className="py-2 pr-3">Name</th>
            <th className="py-2 pr-3"></th>
          </tr>
        </thead>
        <tbody>
          {parties?.map((p) => {
            const contact = one(p.contact);
            const entity = one(p.entity);
            return (
              <tr key={p.id} className="border-b border-gray-100">
                <td className="py-2 pr-3 text-gray-500">
                  {contact ? "Contact" : "Entity"}
                </td>
                <td className="py-2 pr-3">
                  {contact ? contactName(contact) : entity?.name}
                </td>
                <td className="py-2 pr-3">
                  <form action={removeRequirementParty}>
                    <input type="hidden" name="id" value={p.id} />
                    <input type="hidden" name="requirement_id" value={requirement.id} />
                    <button type="submit" className="text-xs text-red-600 hover:underline">
                      Remove
                    </button>
                  </form>
                </td>
              </tr>
            );
          })}
          {parties?.length === 0 && (
            <tr>
              <td colSpan={3} className="py-4 text-gray-400">
                No contacts or entities linked yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <h2 className="text-lg font-semibold mb-3">Possible matches</h2>
      <p className="text-gray-500 mb-4 text-sm">
        Properties in your database matching this requirement&apos;s property
        type{requirement.size_min || requirement.size_max ? " and size range" : ""},
        on-market or off-market. Read-only — this doesn&apos;t link anything.
      </p>

      {!requirement.property_type ? (
        <p className="text-sm text-gray-400 mb-10">
          Set a property type on this requirement to see possible matches.
        </p>
      ) : (
        <table className="w-full text-sm border-collapse mb-10">
          <thead>
            <tr className="text-left border-b border-gray-300">
              <th className="py-2 pr-3">Property</th>
              <th className="py-2 pr-3">Type</th>
              <th className="py-2 pr-3">Size (SF)</th>
              <th className="py-2 pr-3">Market Status</th>
            </tr>
          </thead>
          <tbody>
            {matches.map((m) => (
              <tr key={m.id} className="border-b border-gray-100">
                <td className="py-2 pr-3">
                  <Link href="/properties" className="text-blue-600 underline">
                    {m.display_code ? `${m.display_code} — ` : ""}
                    {m.address}
                    {m.suite_number ? `, Suite ${m.suite_number}` : ""}
                  </Link>
                </td>
                <td className="py-2 pr-3 text-gray-500">{m.property_type ?? "—"}</td>
                <td className="py-2 pr-3 text-gray-500">{formatNumber(m.building_sf)}</td>
                <td className="py-2 pr-3">{marketStatusLabel(m.market_status)}</td>
              </tr>
            ))}
            {matches.length === 0 && (
              <tr>
                <td colSpan={4} className="py-4 text-gray-400">
                  No matching properties yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
