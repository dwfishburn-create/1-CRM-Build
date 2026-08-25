import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { createRequirement } from "./actions";

export const dynamic = "force-dynamic";

type RequirementRow = {
  id: string;
  display_code: string | null;
  deal_type: string | null;
  property_type: string | null;
  size_min: number | null;
  size_max: number | null;
  budget_min: number | null;
  budget_max: number | null;
  target_location: string | null;
  status: string;
  priority: string | null;
};

// Freeform per Dan's own design note (categories shouldn't be a fixed DB
// enum) — these are just convenience suggestions in the form, not enforced.
const DEAL_TYPES = ["Lease", "Buy", "Sell", "Build-to-suit", "1031 Exchange"];
const PROPERTY_TYPES = [
  "Office",
  "Industrial",
  "Retail",
  "Multifamily",
  "Land",
  "Flex",
  "Hospitality",
];
const PRIORITIES = ["High", "Medium", "Low"];
const SOURCES = ["Referral", "Cold call", "Networking", "Inbound"];

const STATUSES = [
  { value: "active", label: "Active" },
  { value: "on_hold", label: "On Hold" },
  { value: "fulfilled", label: "Fulfilled" },
  { value: "dead", label: "Dead" },
];

function statusLabel(value: string): string {
  return STATUSES.find((s) => s.value === value)?.label ?? value;
}

function formatNumber(n: number | null): string {
  if (n === null || n === undefined) return "";
  return new Intl.NumberFormat("en-US").format(n);
}

function rangeLabel(
  min: number | null,
  max: number | null,
  prefix = ""
): string {
  if (min === null && max === null) return "—";
  if (min !== null && max !== null)
    return `${prefix}${formatNumber(min)}–${prefix}${formatNumber(max)}`;
  if (min !== null) return `${prefix}${formatNumber(min)}+`;
  return `up to ${prefix}${formatNumber(max)}`;
}

export default async function RequirementsPage() {
  const { data: requirements, error } = await supabase
    .from("requirements")
    .select(
      "id, display_code, deal_type, property_type, size_min, size_max, budget_min, budget_max, target_location, status, priority"
    )
    .order("created_at", { ascending: false })
    .returns<RequirementRow[]>();

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <h1 className="text-2xl font-semibold mb-1">Requirements</h1>
      <p className="text-gray-500 mb-6 text-sm">
        What someone told you they need — &quot;let me know if you find this
        for me&quot; — with no engagement attached yet. Distinct from a formal
        Project/Assignment. Open a requirement to link the contacts/entities
        it belongs to and see possible matches among your properties.
      </p>

      <form
        action={createRequirement}
        className="grid grid-cols-4 gap-3 mb-10 border border-gray-200 rounded-lg p-4"
      >
        <input
          name="deal_type"
          list="deal-types"
          placeholder="Deal type (Lease, Buy, Sell…)"
          className="border border-gray-300 rounded px-3 py-2"
        />
        <datalist id="deal-types">
          {DEAL_TYPES.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>

        <input
          name="property_type"
          list="property-types"
          placeholder="Property type"
          className="border border-gray-300 rounded px-3 py-2"
        />
        <datalist id="property-types">
          {PROPERTY_TYPES.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>

        <input
          name="target_location"
          placeholder="Target location / submarket"
          className="border border-gray-300 rounded px-3 py-2 col-span-2"
        />

        <input
          name="size_min"
          type="number"
          placeholder="Size min (SF)"
          className="border border-gray-300 rounded px-3 py-2"
        />
        <input
          name="size_max"
          type="number"
          placeholder="Size max (SF)"
          className="border border-gray-300 rounded px-3 py-2"
        />
        <input
          name="budget_min"
          type="number"
          placeholder="Budget min ($)"
          className="border border-gray-300 rounded px-3 py-2"
        />
        <input
          name="budget_max"
          type="number"
          placeholder="Budget max ($)"
          className="border border-gray-300 rounded px-3 py-2"
        />

        <input
          name="timeline"
          placeholder="Timeline (e.g. next 6 months)"
          className="border border-gray-300 rounded px-3 py-2"
        />
        <select
          name="status"
          defaultValue="active"
          className="border border-gray-300 rounded px-3 py-2"
        >
          {STATUSES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <input
          name="priority"
          list="priorities"
          placeholder="Priority"
          defaultValue="Medium"
          className="border border-gray-300 rounded px-3 py-2"
        />
        <datalist id="priorities">
          {PRIORITIES.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
        <input
          name="source"
          list="sources"
          placeholder="Source (referral, cold call…)"
          className="border border-gray-300 rounded px-3 py-2"
        />
        <datalist id="sources">
          {SOURCES.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>

        <textarea
          name="details"
          placeholder="Details — what they actually said they need"
          rows={2}
          className="border border-gray-300 rounded px-3 py-2 col-span-4"
        />

        <button
          type="submit"
          className="col-span-4 bg-black text-white rounded px-4 py-2 justify-self-start"
        >
          Add requirement
        </button>
      </form>

      {error && (
        <p className="text-red-600 mb-4">
          Error loading requirements: {error.message}
        </p>
      )}

      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="text-left border-b border-gray-300">
            <th className="py-2 pr-3">Code</th>
            <th className="py-2 pr-3">Deal</th>
            <th className="py-2 pr-3">Property Type</th>
            <th className="py-2 pr-3">Location</th>
            <th className="py-2 pr-3">Size (SF)</th>
            <th className="py-2 pr-3">Budget</th>
            <th className="py-2 pr-3">Priority</th>
            <th className="py-2 pr-3">Status</th>
          </tr>
        </thead>
        <tbody>
          {requirements?.map((r) => (
            <tr key={r.id} className="border-b border-gray-100">
              <td className="py-2 pr-3">
                <Link
                  href={`/requirements/${r.id}`}
                  className="text-blue-600 underline"
                >
                  {r.display_code ?? r.id.slice(0, 8)}
                </Link>
              </td>
              <td className="py-2 pr-3 text-gray-500">{r.deal_type ?? "—"}</td>
              <td className="py-2 pr-3">{r.property_type ?? "—"}</td>
              <td className="py-2 pr-3">{r.target_location ?? "—"}</td>
              <td className="py-2 pr-3 text-gray-500">
                {rangeLabel(r.size_min, r.size_max)}
              </td>
              <td className="py-2 pr-3 text-gray-500">
                {rangeLabel(r.budget_min, r.budget_max, "$")}
              </td>
              <td className="py-2 pr-3">{r.priority ?? "—"}</td>
              <td className="py-2 pr-3">{statusLabel(r.status)}</td>
            </tr>
          ))}
          {requirements?.length === 0 && (
            <tr>
              <td colSpan={8} className="py-4 text-gray-400">
                No requirements yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
