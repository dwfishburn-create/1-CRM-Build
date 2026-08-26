import { supabase } from "@/lib/supabase";
import { createLeaseComp } from "./actions";

export const dynamic = "force-dynamic";

type LeaseCompRow = {
  id: string;
  property_address: string;
  property_id: string | null;
  tenant: string | null;
  landlord: string | null;
  lease_date: string | null;
  sf: number | null;
  asking_rent: number | null;
  final_rent: number | null;
  lease_term_months: number | null;
  ti_allowance: number | null;
  free_rent_months: number | null;
  property_type: string | null;
  confidence_level: string | null;
  why_it_matters: string | null;
  notes: string | null;
  source: string | null;
  property:
    | { display_code: string | null; address: string }
    | { display_code: string | null; address: string }[]
    | null;
};

type PropertyOption = {
  id: string;
  display_code: string | null;
  address: string;
};

const CONFIDENCE_LEVELS = [
  { value: "confirmed", label: "Confirmed" },
  { value: "broker_reported", label: "Broker-reported" },
  { value: "market_estimate", label: "Market estimate" },
  { value: "rumor", label: "Rumor" },
];

const CONFIDENCE_STYLES: Record<string, string> = {
  confirmed: "bg-green-100 text-green-700",
  broker_reported: "bg-blue-100 text-blue-700",
  market_estimate: "bg-amber-100 text-amber-700",
  rumor: "bg-gray-100 text-gray-600",
};

function confidenceLabel(v: string | null): string {
  return CONFIDENCE_LEVELS.find((c) => c.value === v)?.label ?? v ?? "—";
}

function linkedProperty(p: LeaseCompRow["property"]): string {
  if (!p) return "—";
  const one = Array.isArray(p) ? p[0] : p;
  if (!one) return "—";
  return `${one.display_code ?? "—"} · ${one.address}`;
}

function rentSummary(c: LeaseCompRow): string {
  if (c.final_rent != null && c.asking_rent != null && c.final_rent !== c.asking_rent) {
    return `$${c.final_rent} (asking $${c.asking_rent})`;
  }
  if (c.final_rent != null) return `$${c.final_rent}`;
  if (c.asking_rent != null) return `$${c.asking_rent} (asking)`;
  return "—";
}

export default async function LeaseCompsPage() {
  const [{ data: comps, error }, { data: propertyOptions }] =
    await Promise.all([
      supabase
        .from("lease_comps")
        .select(
          "id, property_address, property_id, tenant, landlord, lease_date, sf, asking_rent, final_rent, lease_term_months, ti_allowance, free_rent_months, property_type, confidence_level, why_it_matters, notes, source, property:properties(display_code, address)"
        )
        .order("lease_date", { ascending: false, nullsFirst: false })
        .returns<LeaseCompRow[]>(),
      supabase
        .from("properties")
        .select("id, display_code, address")
        .order("address", { ascending: true })
        .returns<PropertyOption[]>(),
    ]);

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <h1 className="text-2xl font-semibold mb-1">Lease Comps</h1>
      <p className="text-gray-500 mb-6 text-sm">
        Entered manually for data quality — no automated market-data feed in
        v1.
      </p>

      <form
        action={createLeaseComp}
        className="grid grid-cols-2 gap-3 mb-10 border border-gray-200 rounded-lg p-4"
      >
        <input
          name="property_address"
          placeholder="Property address"
          required
          className="border border-gray-300 rounded px-3 py-2 col-span-2"
        />
        <select
          name="property_id"
          defaultValue=""
          className="border border-gray-300 rounded px-3 py-2 col-span-2"
        >
          <option value="">Link to a property in the DB (optional)</option>
          {propertyOptions?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.display_code ?? "—"} · {p.address}
            </option>
          ))}
        </select>
        <input
          name="tenant"
          placeholder="Tenant"
          className="border border-gray-300 rounded px-3 py-2"
        />
        <input
          name="landlord"
          placeholder="Landlord"
          className="border border-gray-300 rounded px-3 py-2"
        />
        <input
          name="lease_date"
          type="date"
          className="border border-gray-300 rounded px-3 py-2"
        />
        <input
          name="sf"
          type="number"
          placeholder="SF"
          className="border border-gray-300 rounded px-3 py-2"
        />
        <input
          name="asking_rent"
          type="number"
          step="0.01"
          placeholder="Asking rent ($/SF/yr)"
          className="border border-gray-300 rounded px-3 py-2"
        />
        <input
          name="final_rent"
          type="number"
          step="0.01"
          placeholder="Final rent ($/SF/yr)"
          className="border border-gray-300 rounded px-3 py-2"
        />
        <input
          name="lease_term_months"
          type="number"
          placeholder="Lease term (months)"
          className="border border-gray-300 rounded px-3 py-2"
        />
        <input
          name="ti_allowance"
          type="number"
          step="0.01"
          placeholder="TI allowance ($/SF)"
          className="border border-gray-300 rounded px-3 py-2"
        />
        <input
          name="free_rent_months"
          type="number"
          step="0.5"
          placeholder="Free rent (months)"
          className="border border-gray-300 rounded px-3 py-2"
        />
        <input
          name="property_type"
          placeholder="Property type (retail, industrial, office...)"
          className="border border-gray-300 rounded px-3 py-2"
        />
        <select
          name="confidence_level"
          defaultValue="broker_reported"
          className="border border-gray-300 rounded px-3 py-2"
        >
          {CONFIDENCE_LEVELS.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        <input
          name="source"
          placeholder="Source"
          className="border border-gray-300 rounded px-3 py-2"
        />
        <textarea
          name="why_it_matters"
          placeholder="Why this comp matters (judgment/context)"
          rows={2}
          className="border border-gray-300 rounded px-3 py-2 col-span-2"
        />
        <textarea
          name="notes"
          placeholder="Notes"
          rows={2}
          className="border border-gray-300 rounded px-3 py-2 col-span-2"
        />
        <button
          type="submit"
          className="col-span-2 bg-black text-white rounded px-4 py-2 justify-self-start"
        >
          Add lease comp
        </button>
      </form>

      {error && (
        <p className="text-red-600 mb-4">
          Error loading lease comps: {error.message}
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-left border-b border-gray-300">
              <th className="py-2 pr-3">Address</th>
              <th className="py-2 pr-3">Linked property</th>
              <th className="py-2 pr-3">Date</th>
              <th className="py-2 pr-3">Tenant</th>
              <th className="py-2 pr-3">Landlord</th>
              <th className="py-2 pr-3">SF</th>
              <th className="py-2 pr-3">Rent</th>
              <th className="py-2 pr-3">Term</th>
              <th className="py-2 pr-3">Type</th>
              <th className="py-2 pr-3">Confidence</th>
            </tr>
          </thead>
          <tbody>
            {comps?.map((c) => (
              <tr key={c.id} className="border-b border-gray-100 align-top">
                <td className="py-2 pr-3">
                  {c.property_address}
                  {c.why_it_matters && (
                    <div className="text-xs text-gray-400 italic mt-0.5 max-w-xs">
                      {c.why_it_matters}
                    </div>
                  )}
                </td>
                <td className="py-2 pr-3 text-gray-500">
                  {linkedProperty(c.property)}
                </td>
                <td className="py-2 pr-3 whitespace-nowrap">
                  {c.lease_date ?? "—"}
                </td>
                <td className="py-2 pr-3">{c.tenant ?? "—"}</td>
                <td className="py-2 pr-3">{c.landlord ?? "—"}</td>
                <td className="py-2 pr-3 whitespace-nowrap">
                  {c.sf != null ? c.sf.toLocaleString() : "—"}
                </td>
                <td className="py-2 pr-3 whitespace-nowrap">
                  {rentSummary(c)}
                </td>
                <td className="py-2 pr-3 whitespace-nowrap">
                  {c.lease_term_months != null
                    ? `${c.lease_term_months} mo`
                    : "—"}
                </td>
                <td className="py-2 pr-3">{c.property_type ?? "—"}</td>
                <td className="py-2 pr-3">
                  <span
                    className={`px-2 py-0.5 rounded text-xs whitespace-nowrap ${
                      CONFIDENCE_STYLES[c.confidence_level ?? "broker_reported"]
                    }`}
                  >
                    {confidenceLabel(c.confidence_level)}
                  </span>
                </td>
              </tr>
            ))}
            {comps?.length === 0 && (
              <tr>
                <td colSpan={10} className="py-4 text-gray-400">
                  No lease comps yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
