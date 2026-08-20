import { supabase } from "@/lib/supabase";
import { createContact } from "./actions";

export const dynamic = "force-dynamic";

type ContactRow = {
  id: string;
  display_code: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  mobile_phone: string | null;
  title: string | null;
  companies: { name: string } | { name: string }[] | null;
};

function companyName(c: ContactRow["companies"]): string {
  if (!c) return "—";
  if (Array.isArray(c)) return c[0]?.name ?? "—";
  return c.name ?? "—";
}

export default async function ContactsPage() {
  const { data: contacts, error } = await supabase
    .from("contacts")
    .select(
      "id, display_code, first_name, last_name, email, phone, mobile_phone, title, companies(name)"
    )
    .order("created_at", { ascending: false })
    .returns<ContactRow[]>();

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <h1 className="text-2xl font-semibold mb-6">Contacts</h1>

      <form
        action={createContact}
        className="grid grid-cols-2 gap-3 mb-10 border border-gray-200 rounded-lg p-4"
      >
        <input
          name="first_name"
          placeholder="First name"
          className="border border-gray-300 rounded px-3 py-2"
        />
        <input
          name="last_name"
          placeholder="Last name"
          className="border border-gray-300 rounded px-3 py-2"
        />
        <input
          name="email"
          type="email"
          placeholder="Email"
          className="border border-gray-300 rounded px-3 py-2"
        />
        <input
          name="phone"
          placeholder="Phone"
          className="border border-gray-300 rounded px-3 py-2"
        />
        <input
          name="mobile_phone"
          placeholder="Mobile phone"
          className="border border-gray-300 rounded px-3 py-2"
        />
        <input
          name="title"
          placeholder="Title"
          className="border border-gray-300 rounded px-3 py-2"
        />
        <input
          name="company_name"
          placeholder="Company"
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
          Add contact
        </button>
      </form>

      {error && (
        <p className="text-red-600 mb-4">
          Error loading contacts: {error.message}
        </p>
      )}

      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="text-left border-b border-gray-300">
            <th className="py-2 pr-3">Code</th>
            <th className="py-2 pr-3">Name</th>
            <th className="py-2 pr-3">Company</th>
            <th className="py-2 pr-3">Title</th>
            <th className="py-2 pr-3">Email</th>
            <th className="py-2 pr-3">Phone</th>
          </tr>
        </thead>
        <tbody>
          {contacts?.map((c) => (
            <tr key={c.id} className="border-b border-gray-100">
              <td className="py-2 pr-3 text-gray-500">
                {c.display_code ?? "—"}
              </td>
              <td className="py-2 pr-3">
                {[c.first_name, c.last_name].filter(Boolean).join(" ") ||
                  "—"}
              </td>
              <td className="py-2 pr-3">{companyName(c.companies)}</td>
              <td className="py-2 pr-3">{c.title ?? "—"}</td>
              <td className="py-2 pr-3">{c.email ?? "—"}</td>
              <td className="py-2 pr-3">
                {c.phone ?? c.mobile_phone ?? "—"}
              </td>
            </tr>
          ))}
          {contacts?.length === 0 && (
            <tr>
              <td colSpan={6} className="py-4 text-gray-400">
                No contacts yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
