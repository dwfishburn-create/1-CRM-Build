import { supabase } from "@/lib/supabase";
import { createCompany } from "./actions";

export const dynamic = "force-dynamic";

type CompanyRow = {
  id: string;
  display_code: string | null;
  name: string;
  industry: string | null;
  website: string | null;
  notes: string | null;
};

export default async function CompaniesPage() {
  const { data: companies, error } = await supabase
    .from("companies")
    .select("id, display_code, name, industry, website, notes")
    .order("created_at", { ascending: false })
    .returns<CompanyRow[]>();

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <h1 className="text-2xl font-semibold mb-6">Companies</h1>

      <form
        action={createCompany}
        className="grid grid-cols-2 gap-3 mb-10 border border-gray-200 rounded-lg p-4"
      >
        <input
          name="name"
          placeholder="Company name"
          required
          className="border border-gray-300 rounded px-3 py-2 col-span-2"
        />
        <input
          name="industry"
          placeholder="Industry"
          className="border border-gray-300 rounded px-3 py-2"
        />
        <input
          name="website"
          placeholder="Website"
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
          Add company
        </button>
      </form>

      {error && (
        <p className="text-red-600 mb-4">
          Error loading companies: {error.message}
        </p>
      )}

      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="text-left border-b border-gray-300">
            <th className="py-2 pr-3">Code</th>
            <th className="py-2 pr-3">Name</th>
            <th className="py-2 pr-3">Industry</th>
            <th className="py-2 pr-3">Website</th>
            <th className="py-2 pr-3">Notes</th>
          </tr>
        </thead>
        <tbody>
          {companies?.map((c) => (
            <tr key={c.id} className="border-b border-gray-100">
              <td className="py-2 pr-3 text-gray-500">
                {c.display_code ?? "—"}
              </td>
              <td className="py-2 pr-3">{c.name}</td>
              <td className="py-2 pr-3">{c.industry ?? "—"}</td>
              <td className="py-2 pr-3">
                {c.website ? (
                  <a
                    href={c.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 underline"
                  >
                    {c.website}
                  </a>
                ) : (
                  "—"
                )}
              </td>
              <td className="py-2 pr-3">{c.notes ?? "—"}</td>
            </tr>
          ))}
          {companies?.length === 0 && (
            <tr>
              <td colSpan={5} className="py-4 text-gray-400">
                No companies yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
