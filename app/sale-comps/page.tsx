import { supabase } from "@/lib/supabase";
import { createSaleComp } from "./actions";

export const dynamic = "force-dynamic";

type SaleCompRow = {
  id: string;
  property_address: string;
  property_id: string | null;
  sale_date: string | null;
  sale_price: number | null;
  buyer: string | null;
  seller: string | null;
  building_sf: number | null;
  land_acres: number | null;
  price_per_sf: number | null;
  cap_rate: number | null;
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

function linkedProperty(p: SaleCompRow["property"]): string {
  if (!p) return "—";
  const one = Array.isArray(p) ? p[0] : p;
  if (!one) return "—";
  return `${one.display_code ?? "—"} · ${one.address}`;
}

export default async function SaleCompsPage() {
  const [{ data: comps, error }, { data: propertyOptions }] =
    await Promise.all([
      supabase
        .from("sale_comps")
        .select(
          "id, property_address, property_id, sale_date, sale_price, buyer, seller, building_sf, land_acres, price_per_sf, cap_rate, property_type, confidence_level, why_it_matters, notes, source, property:properties(display_code, address)"
        )
        .order("sale_date", { ascending: false, nullsFirst: false })
        .returns<SaleCompRow[]>(),
      supabase
        .from("properties")
        .select("id, display_code, address")
        .order("address", { ascending: true })
        .returns<PropertyOption[]>(),
    ]);

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <h1 className="text-2xl font-semibold mb-1">Sale Comps</h1>
      <p className="text-gray-500 mb-6 text-sm">
        Entered manually for data quality — no automated market-data feed in
        v1.
      </p>

      <form
        action={createSaleComp}
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
          name="sale_date"
          type="date"
          className="border border-gray-300 rounded px-3 py-2"
        />
        <input
          name="sale_price"
          type="number"
          step="0.01"
          placeholder="Sale price"
          className="border border-gray-300 rounded px-3 py-2"
        />
        <input
          name="buyer"
          placeholder="Buyer"
          className="border border-gray-300 rounded px-3 py-2"
        />
        <input
          name="seller"
          placeholder="Seller"
          className="border border-gray-300 rounded px-3 py-2"
        />
        <input
          name="building_sf"
          type="number"
          placeholder="Building SF"
          className="border border-gray-300 rounded px-3 py-2"
        />
        <input
          name="land_acres"
          type="number"
          step="0.01"
          placeholder="Land acres"
          className="border border-gray-300 rounded px-3 py-2"
        />
        <input
          name="cap_rate"
          type="number"
          step="0.01"
          placeholder="Cap rate (%)"
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
          placeholder="Why this comp matters (judgment/context — e.g. buyer overpaid for a corner lot)"
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
          Add sale comp
        </button>
      </form>

      {error && (
        <p className="text-red-600 mb-4">
          Error loading sale comps: {error.message}
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-left border-b border-gray-300">
              <th className="py-2 pr-3">Address</th>
              <th className="py-2 pr-3">Linked property</th>
              <th className="py-2 pr-3">Date</th>
              <th className="py-2 pr-3">Price</th>
              <th className="py-2 pr-3">$/SF</th>
              <th className="py-2 pr-3">Cap Rate</th>
              <th className="py-2 pr-3">Buyer</th>
              <th className="py-2 pr-3">Seller</th>
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
                  {c.sale_date ?? "—"}
                </td>
                <td className="py-2 pr-3 whitespace-nowrap">
                  {c.sale_price != null
                    ? `$${c.sale_price.toLocaleString()}`
                    : "—"}
                </td>
                <td className="py-2 pr-3 whitespace-nowrap">
                  {c.price_per_sf != null
                    ? `$${c.price_per_sf.toLocaleString()}`
                    : "—"}
                </td>
                <td className="py-2 pr-3 whitespace-nowrap">
                  {c.cap_rate != null ? `${c.cap_rate}%` : "—"}
                </td>
                <td className="py-2 pr-3">{c.buyer ?? "—"}</td>
                <td className="py-2 pr-3">{c.seller ?? "—"}</td>
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
                  No sale comps yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
