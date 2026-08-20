import { supabase } from "@/lib/supabase";
import { createProperty } from "./actions";

export const dynamic = "force-dynamic";

type PropertyRow = {
  id: string;
  display_code: string | null;
  address: string;
  city: string | null;
  state: string | null;
  zip: string | null;
  property_type: string | null;
  building_sf: number | null;
  land_acres: number | null;
  research_status: string | null;
};

const STATUS_STYLES: Record<string, string> = {
  unresearched: "bg-gray-100 text-gray-600",
  partial: "bg-amber-100 text-amber-700",
  confirmed: "bg-green-100 text-green-700",
};

export default async function PropertiesPage() {
  const { data: properties, error } = await supabase
    .from("properties")
    .select(
      "id, display_code, address, city, state, zip, property_type, building_sf, land_acres, research_status"
    )
    .order("created_at", { ascending: false })
    .returns<PropertyRow[]>();

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <h1 className="text-2xl font-semibold mb-6">Properties</h1>

      <form
        action={createProperty}
        className="grid grid-cols-2 gap-3 mb-10 border border-gray-200 rounded-lg p-4"
      >
        <input
          name="address"
          placeholder="Address"
          required
          className="border border-gray-300 rounded px-3 py-2 col-span-2"
        />
        <input
          name="city"
          placeholder="City"
          className="border border-gray-300 rounded px-3 py-2"
        />
        <input
          name="state"
          placeholder="State"
          defaultValue="NE"
          className="border border-gray-300 rounded px-3 py-2"
        />
        <input
          name="zip"
          placeholder="Zip"
          className="border border-gray-300 rounded px-3 py-2"
        />
        <input
          name="property_type"
          placeholder="Property type (retail, industrial, office...)"
          className="border border-gray-300 rounded px-3 py-2"
        />
        <input
          name="submarket"
          placeholder="Submarket"
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
          Add property
        </button>
      </form>

      {error && (
        <p className="text-red-600 mb-4">
          Error loading properties: {error.message}
        </p>
      )}

      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="text-left border-b border-gray-300">
            <th className="py-2 pr-3">Code</th>
            <th className="py-2 pr-3">Address</th>
            <th className="py-2 pr-3">Type</th>
            <th className="py-2 pr-3">Building SF</th>
            <th className="py-2 pr-3">Land Acres</th>
            <th className="py-2 pr-3">Status</th>
          </tr>
        </thead>
        <tbody>
          {properties?.map((p) => (
            <tr key={p.id} className="border-b border-gray-100">
              <td className="py-2 pr-3 text-gray-500">
                {p.display_code ?? "—"}
              </td>
              <td className="py-2 pr-3">
                {p.address}
                {p.city ? `, ${p.city}` : ""}
                {p.state ? `, ${p.state}` : ""} {p.zip ?? ""}
              </td>
              <td className="py-2 pr-3">{p.property_type ?? "—"}</td>
              <td className="py-2 pr-3">
                {p.building_sf?.toLocaleString() ?? "—"}
              </td>
              <td className="py-2 pr-3">{p.land_acres ?? "—"}</td>
              <td className="py-2 pr-3">
                <span
                  className={`px-2 py-0.5 rounded text-xs ${
                    STATUS_STYLES[p.research_status ?? "unresearched"]
                  }`}
                >
                  {p.research_status ?? "unresearched"}
                </span>
              </td>
            </tr>
          ))}
          {properties?.length === 0 && (
            <tr>
              <td colSpan={6} className="py-4 text-gray-400">
                No properties yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
