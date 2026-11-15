import Link from "next/link";
import { notFound } from "next/navigation";
import { supabase } from "@/lib/supabase";
import {
  addRequirementParty,
  removeRequirementParty,
  setRtdShared,
  updateRequirement,
  updateRequirementStatus,
} from "./actions";
import { ActionForm } from "@/app/_components/ActionForm";
import { SignalFields } from "../SignalFields";
import { CriteriaFields } from "../CriteriaFields";
import { MatchBreakdown, MatchScore } from "@/app/_components/MatchBreakdown";
import { matchesForRequirement, type PropertyMatch } from "@/lib/requirementMatch";
import { ASSET_CLASSES, CREDIT_LEVELS, SIDES, TENANCY_TYPES, labelOf } from "@/lib/requirementCriteria";
import { choiceLabel, TARGET_MARKETS } from "@/lib/retailBrands";
import { CONFIDENCE, RECONFIRM_CATEGORY } from "@/lib/requirementReconfirm";
import { dueClass } from "@/lib/records";

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
  confidence: string | null;
  source_date: string | null;
  reconfirm_date: string | null;
  target_markets: string[] | null;
  rtd_shared: boolean;
  rtd_shared_at: string | null;
  rtd_note: string | null;
  rtd_contact: string | null;
  source_system: string | null;
  sides: string[] | null;
  asset_classes: string[] | null;
  acres_min: number | null;
  acres_max: number | null;
  cap_rate_min: number | null;
  tenancy_types: string[] | null;
  credit_floor: string | null;
  min_term_years: number | null;
  exchange_1031: boolean | null;
  outside_markets: boolean | null;
  exchange_identify_by: string | null;
  exchange_close_by: string | null;
};

type NamedContact = { id: string; first_name: string | null; last_name: string | null };
type NamedEntity = { id: string; name: string };

type PartyRow = {
  id: string;
  contact: NamedContact | NamedContact[] | null;
  entity: NamedEntity | NamedEntity[] | null;
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

  const [
    { data: requirement },
    { data: parties },
    { data: contacts },
    { data: entities },
    { data: reconfirmTasks },
  ] =
    await Promise.all([
      supabase
        .from("requirements")
        .select(
          "id, display_code, deal_type, property_type, size_min, size_max, budget_min, budget_max, target_location, timeline, status, priority, details, source, confidence, source_date, reconfirm_date, target_markets, rtd_shared, rtd_shared_at, rtd_note, rtd_contact, source_system, sides, asset_classes, acres_min, acres_max, cap_rate_min, tenancy_types, credit_floor, min_term_years, exchange_1031, exchange_identify_by, exchange_close_by, outside_markets"
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
      supabase
        .from("tasks")
        .select("id, display_code, due_date")
        .eq("requirement_id", id)
        .eq("category", RECONFIRM_CATEGORY)
        .eq("status", "open")
        .returns<{ id: string; display_code: string | null; due_date: string | null }[]>(),
    ]);

  if (!requirement) notFound();

  // Phase 4 (11/14/2026): scored matches — lib/requirementMatchCore.ts.
  const sp = await props.searchParams;
  const includeOff = sp?.off === "1";
  let matchData: Awaited<ReturnType<typeof matchesForRequirement>> | null = null;
  let matchError: string | null = null;
  try {
    matchData = await matchesForRequirement(id, { includeOffMarket: includeOff });
  } catch (e) {
    matchError = e instanceof Error ? e.message : String(e);
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

      <div className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 p-3 text-sm dark:border-gray-700">
        <span className="font-semibold">Retail Tenant Directory:</span>
        {requirement.rtd_shared ? (
          <span className="text-green-700 dark:text-green-400">
            Shared{requirement.rtd_shared_at ? ` ${new Date(requirement.rtd_shared_at).toLocaleDateString("en-US", { timeZone: "America/Chicago" })}` : ""}
            {requirement.source_system === "rtd" ? " (added in the RTD)" : ""} — Jami and Trey can see and update it; Details stays private.
          </span>
        ) : (
          <span className="text-gray-500">Not shared — only you see it.</span>
        )}
        <form action={setRtdShared}>
          <input type="hidden" name="id" value={requirement.id} />
          <input type="hidden" name="share" value={requirement.rtd_shared ? "0" : "1"} />
          <button type="submit" className={requirement.rtd_shared
            ? "text-xs border border-gray-300 rounded px-2 py-1 hover:bg-gray-50 dark:hover:bg-gray-800"
            : "text-xs bg-blue-600 text-white rounded px-3 py-1"}>
            {requirement.rtd_shared ? "Stop sharing" : "Share to RTD"}
          </button>
        </form>
        {(requirement.rtd_note || requirement.rtd_contact) && (
          <div className="w-full text-gray-600 dark:text-gray-300">
            {requirement.rtd_note && <p className="whitespace-pre-line">RTD note: {requirement.rtd_note}</p>}
            {requirement.rtd_contact && <p>Who to call: {requirement.rtd_contact}</p>}
          </div>
        )}
      </div>

      {requirement.details && (
        <p className="text-sm text-gray-600 mb-8 border border-gray-200 rounded-lg p-3">
          {requirement.details}
        </p>
      )}

      <p className="text-sm text-gray-600 mb-4">
        Confidence: {choiceLabel(CONFIDENCE, requirement.confidence)}
        {" · "}Heard: {requirement.source_date ?? "—"}
        {" · "}Markets:{" "}
        {(requirement.target_markets ?? []).length
          ? (requirement.target_markets ?? []).map((m) => choiceLabel(TARGET_MARKETS, m)).join(", ")
          : "—"}
        {" · "}Re-confirm by:{" "}
        <span className={requirement.status === "active" ? dueClass(requirement.reconfirm_date) : ""}>
          {requirement.reconfirm_date ?? "—"}
        </span>
        {(reconfirmTasks ?? []).length > 0 && (
          <span className="text-gray-400"> (task {(reconfirmTasks ?? []).map((t) => t.display_code).join(", ")} open)</span>
        )}
      </p>

      <p className="text-sm text-gray-600 mb-4">
        Side: {(requirement.sides ?? []).map((x) => labelOf(SIDES, x)).join(", ") || "—"}
        {" · "}Classes: {(requirement.asset_classes ?? []).map((x) => labelOf(ASSET_CLASSES, x)).join(", ") || "—"}
        {(requirement.acres_min !== null || requirement.acres_max !== null) && (
          <> · Land {rangeLabel(requirement.acres_min, requirement.acres_max)} ac</>
        )}
        {requirement.outside_markets && <> · Market outside Dan&apos;s four</>}
        {requirement.cap_rate_min !== null && <> · Cap {requirement.cap_rate_min}%+</>}
        {(requirement.tenancy_types ?? []).length > 0 && (
          <> · Tenancy: {(requirement.tenancy_types ?? []).map((x) => labelOf(TENANCY_TYPES, x)).join(", ")}</>
        )}
        {requirement.credit_floor && <> · Credit: {labelOf(CREDIT_LEVELS, requirement.credit_floor)}+</>}
        {requirement.min_term_years !== null && <> · {requirement.min_term_years}+ yrs term</>}
        {requirement.exchange_1031 && (
          <span className="text-amber-700 dark:text-amber-400">
            {" · "}1031{requirement.exchange_identify_by ? ` — identify by ${requirement.exchange_identify_by}` : ""}
            {requirement.exchange_close_by ? `, close by ${requirement.exchange_close_by}` : ""}
          </span>
        )}
      </p>

      <details className="mb-8">
        <summary className="text-sm text-blue-700 cursor-pointer select-none">Edit requirement</summary>
        <ActionForm action={updateRequirement} className="mt-3 grid grid-cols-4 gap-3 items-end border border-gray-200 rounded-lg p-4">
          <input type="hidden" name="id" value={requirement.id} />
          <label className="text-xs text-gray-600">
            Deal type
            <input name="deal_type" defaultValue={requirement.deal_type ?? ""} className="border border-gray-300 rounded px-2 py-1 text-sm w-full" />
          </label>
          <label className="text-xs text-gray-600">
            Property type
            <input name="property_type" defaultValue={requirement.property_type ?? ""} className="border border-gray-300 rounded px-2 py-1 text-sm w-full" />
          </label>
          <label className="text-xs text-gray-600 col-span-2">
            Target location / submarket
            <input name="target_location" defaultValue={requirement.target_location ?? ""} className="border border-gray-300 rounded px-2 py-1 text-sm w-full" />
          </label>
          <label className="text-xs text-gray-600">
            Size min (SF)
            <input name="size_min" type="number" defaultValue={requirement.size_min ?? ""} className="border border-gray-300 rounded px-2 py-1 text-sm w-full" />
          </label>
          <label className="text-xs text-gray-600">
            Size max (SF)
            <input name="size_max" type="number" defaultValue={requirement.size_max ?? ""} className="border border-gray-300 rounded px-2 py-1 text-sm w-full" />
          </label>
          <label className="text-xs text-gray-600">
            Budget min ($)
            <input name="budget_min" type="number" defaultValue={requirement.budget_min ?? ""} className="border border-gray-300 rounded px-2 py-1 text-sm w-full" />
          </label>
          <label className="text-xs text-gray-600">
            Budget max ($)
            <input name="budget_max" type="number" defaultValue={requirement.budget_max ?? ""} className="border border-gray-300 rounded px-2 py-1 text-sm w-full" />
          </label>
          <label className="text-xs text-gray-600">
            Timeline
            <input name="timeline" defaultValue={requirement.timeline ?? ""} className="border border-gray-300 rounded px-2 py-1 text-sm w-full" />
          </label>
          <label className="text-xs text-gray-600">
            Status
            <select name="status" defaultValue={requirement.status} className="border border-gray-300 rounded px-2 py-1 text-sm w-full">
              {STATUS_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-gray-600">
            Priority
            <input name="priority" defaultValue={requirement.priority ?? ""} className="border border-gray-300 rounded px-2 py-1 text-sm w-full" />
          </label>
          <label className="text-xs text-gray-600">
            Source
            <input name="source" defaultValue={requirement.source ?? ""} className="border border-gray-300 rounded px-2 py-1 text-sm w-full" />
          </label>
          <SignalFields
            input="border border-gray-300 rounded px-2 py-1 text-sm"
            confidence={requirement.confidence}
            sourceDate={requirement.source_date}
            reconfirmDate={requirement.reconfirm_date}
            markets={requirement.target_markets ?? []}
          />
          <CriteriaFields input="border border-gray-300 rounded px-2 py-1 text-sm" v={requirement} />
          <label className="text-xs text-gray-600 col-span-4">
            Details
            <textarea name="details" rows={3} defaultValue={requirement.details ?? ""} className="border border-gray-300 rounded px-2 py-1 text-sm w-full" />
          </label>
          <div className="col-span-4">
            <button type="submit" className="bg-blue-600 text-white rounded px-3 py-1 text-sm">
              Save changes
            </button>
          </div>
        </ActionForm>
      </details>

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
        Listings scored against this requirement&apos;s stated criteria — strong = 50%+ of what&apos;s known,
        with property type and market not missed. ? = the listing doesn&apos;t say (not a miss).
        {requirement.status === "on_hold" && " This requirement is on hold, so matches show as paused."}
        {!(requirement.sides ?? []).length || !(requirement.asset_classes ?? []).length || !(requirement.target_markets ?? []).length
          ? " Set side, property classes and target markets above for sharper matches."
          : ""}
      </p>
      {matchError && <p className="text-sm text-red-600 mb-4">Couldn&apos;t score matches: {matchError}</p>}
      {matchData && (
        <>
          <MatchTable rows={matchData.listed} empty="No listed properties match yet." />
          <h3 className="text-sm font-semibold mt-6 mb-2">Off-market properties that fit</h3>
          {includeOff ? (
            <>
              <p className="text-xs text-gray-500 mb-2">
                Strong fits among every property in the CRM (incl. the RealNex set) — owner-conversation leads.
                {matchData.off_market_total > matchData.off_market.length &&
                  ` Showing the top ${matchData.off_market.length} of ${matchData.off_market_total}.`}
              </p>
              <MatchTable rows={matchData.off_market} empty="No strong off-market fits." />
            </>
          ) : (
            <Link href={`/requirements/${requirement.id}?off=1`} className="text-sm text-blue-600 underline">
              Score off-market properties too (slower)
            </Link>
          )}
        </>
      )}
    </div>
  );
}

function MatchTable({ rows, empty }: { rows: PropertyMatch[]; empty: string }) {
  return (
    <table className="w-full text-sm border-collapse mb-6">
      <thead>
        <tr className="text-left border-b border-gray-300">
          <th className="py-2 pr-3">Score</th>
          <th className="py-2 pr-3">Property</th>
          <th className="py-2 pr-3">Listing</th>
          <th className="py-2 pr-3">Why</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((m) => (
          <tr key={m.property.id} className="border-b border-gray-100 align-top">
            <td className="py-2 pr-3">
              <MatchScore pct={m.pct} strong={m.strong} paused={m.paused} />
            </td>
            <td className="py-2 pr-3">
              <Link href={`/properties/${m.property.id}`} className="text-blue-600 underline">
                {m.property.display_code ? `${m.property.display_code} — ` : ""}
                {m.property.address}
                {m.property.suite_number ? `, Suite ${m.property.suite_number}` : ""}
              </Link>
              <div className="text-xs text-gray-500">
                {[m.property.city, m.property.property_type].filter(Boolean).join(" · ")}
              </div>
            </td>
            <td className="py-2 pr-3 text-xs text-gray-600">
              {m.listing ? (
                <>
                  {m.listing.listing_type}
                  {m.listing.asking_price ? ` · $${formatNumber(m.listing.asking_price)}` : ""}
                  {m.listing.asking_rate ? ` · $${m.listing.asking_rate}/SF ${m.listing.rate_basis ?? ""}` : ""}
                  {m.listing.cap_rate ? ` · ${m.listing.cap_rate}% cap` : ""}
                  {m.listing.is_dan_listing ? " · your listing" : ""}
                </>
              ) : (
                marketStatusLabel(m.property.market_status)
              )}
            </td>
            <td className="py-2 pr-3">
              <MatchBreakdown met={m.met} missed={m.missed} unknown={m.unknown} />
            </td>
          </tr>
        ))}
        {rows.length === 0 && (
          <tr>
            <td colSpan={4} className="py-4 text-gray-400">{empty}</td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
