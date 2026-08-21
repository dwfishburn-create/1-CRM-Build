import { supabase } from "@/lib/supabase";
import { createOwner } from "./actions";

export const dynamic = "force-dynamic";

type OwnerRow = {
  id: string;
  display_code: string | null;
  name: string;
  entity_type: string | null;
  notes: string | null;
  primary_contact:
    | { first_name: string | null; last_name: string | null }
    | { first_name: string | null; last_name: string | null }[]
    | null;
};

type ContactOption = {
  id: string;
  first_name: string | null;
  last_name: string | null;
};

function contactName(c: OwnerRow["primary_contact"]): string {
  if (!c) return "—";
  const one = Array.isArray(c) ? c[0] : c;
  if (!one) return "—";
  return [one.first_name, one.last_name].filter(Boolean).join(" ") || "—";
}

const ENTITY_TYPES = [
  "Individual",
  "LLC",
  "Trust",
  "Partnership",
  "Corporation",
  "Other",
];

export default async function OwnersPage() {
  const [{ data: owners, error }, { data: contacts }] = await Promise.all([
    supabase
      .from("owners")
      .select(
        "id, display_code, name, entity_type, notes, primary_contact:contacts!primary_contact_id(first_name, last_name)"
      )
      .order("created_at", { ascending: false })
      .returns<OwnerRow[]>(),
    supabase
      .from("contacts")
      .select("id, first_name, last_name")
      .order("first_name", { ascending: true })
      .returns<ContactOption[]>(),
  ]);

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <h1 className="text-2xl font-semibold mb-6">Owners</h1>

      <form
        action={createOwner}
        className="grid grid-cols-2 gap-3 mb-10 border border-gray-200 rounded-lg p-4"
      >
        <input
          name="name"
          placeholder="Owner / entity name"
          required
          className="border border-gray-300 rounded px-3 py-2 col-span-2"
        />
        <select
          name="entity_type"
          defaultValue=""
          className="border border-gray-300 rounded px-3 py-2"
        >
          <option value="">Entity type…</option>
          {ENTITY_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select
          name="primary_contact_id"
          defaultValue=""
          className="border border-gray-300 rounded px-3 py-2"
        >
          <option value="">Primary contact (none)</option>
          {contacts?.map((c) => (
            <option key={c.id} value={c.id}>
              {[c.first_name, c.last_name].filter(Boolean).join(" ") ||
                "Unnamed contact"}
            </option>
          ))}
        </select>
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
          Add owner
        </button>
      </form>

      {error && (
        <p className="text-red-600 mb-4">
          Error loading owners: {error.message}
        </p>
      )}

      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="text-left border-b border-gray-300">
            <th className="py-2 pr-3">Code</th>
            <th className="py-2 pr-3">Name</th>
            <th className="py-2 pr-3">Type</th>
            <th className="py-2 pr-3">Primary Contact</th>
            <th className="py-2 pr-3">Notes</th>
          </tr>
        </thead>
        <tbody>
          {owners?.map((o) => (
            <tr key={o.id} className="border-b border-gray-100">
              <td className="py-2 pr-3 text-gray-500">
                {o.display_code ?? "—"}
              </td>
              <td className="py-2 pr-3">{o.name}</td>
              <td className="py-2 pr-3">{o.entity_type ?? "—"}</td>
              <td className="py-2 pr-3">{contactName(o.primary_contact)}</td>
              <td className="py-2 pr-3">{o.notes ?? "—"}</td>
            </tr>
          ))}
          {owners?.length === 0 && (
            <tr>
              <td colSpan={5} className="py-4 text-gray-400">
                No owners yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
