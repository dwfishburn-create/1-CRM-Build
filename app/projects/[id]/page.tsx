import Link from "next/link";
import { notFound } from "next/navigation";
import { supabase } from "@/lib/supabase";
import {
  addCandidateProperty,
  removeCandidateProperty,
  updateCandidateStatus,
  addProjectContact,
  addProjectCollaboratorEntity,
  removeProjectContact,
  addReferenceLink,
  removeReferenceLink,
} from "./actions";

export const dynamic = "force-dynamic";

type Project = {
  id: string;
  project_code: string;
  project_type: string;
  client_name: string;
  status: string;
  start_date: string | null;
  target_close_date: string | null;
  notes: string | null;
};

type CandidateRow = {
  id: string;
  status: string;
  notes: string | null;
  property:
    | {
        id: string;
        display_code: string | null;
        address: string;
        suite_number: string | null;
      }
    | {
        id: string;
        display_code: string | null;
        address: string;
        suite_number: string | null;
      }[]
    | null;
};

type PropertyOption = {
  id: string;
  display_code: string | null;
  address: string;
  suite_number: string | null;
};

type NamedContact = { id: string; first_name: string | null; last_name: string | null };
type NamedEntity = { id: string; display_code: string | null; name: string };

type ProjectContactRow = {
  id: string;
  role: string | null;
  split_pct: number | null;
  notes: string | null;
  contact: NamedContact | NamedContact[] | null;
  entity: NamedEntity | NamedEntity[] | null;
};

type ReferenceLinkRow = {
  id: string;
  label: string;
  url: string | null;
  link_type: string | null;
  notes: string | null;
};

const STATUS_OPTIONS = [
  { value: "candidate", label: "Candidate" },
  { value: "toured", label: "Toured" },
  { value: "selected", label: "Selected" },
  { value: "rejected", label: "Rejected" },
];

function statusLabel(value: string): string {
  return STATUS_OPTIONS.find((s) => s.value === value)?.label ?? value;
}

function propertyLabel(p: PropertyOption): string {
  const base = p.suite_number ? `${p.address}, Suite ${p.suite_number}` : p.address;
  return p.display_code ? `${p.display_code} — ${base}` : base;
}

function oneProperty(
  p: CandidateRow["property"]
): PropertyOption | null {
  if (!p) return null;
  return Array.isArray(p) ? p[0] ?? null : p;
}

function one<T>(v: T | T[] | null): T | null {
  if (!v) return null;
  return Array.isArray(v) ? v[0] ?? null : v;
}

function contactName(c: NamedContact | null): string {
  if (!c) return "Unknown contact";
  return [c.first_name, c.last_name].filter(Boolean).join(" ") || "Unnamed contact";
}

function entityLabel(e: NamedEntity | null): string {
  if (!e) return "Unknown entity";
  return e.display_code ? `${e.display_code} — ${e.name}` : e.name;
}

export default async function ProjectDetailPage(
  props: PageProps<"/projects/[id]">
) {
  const { id } = await props.params;

  const [
    { data: project },
    { data: candidates },
    { data: allProperties },
    { data: projectContacts },
    { data: allContacts },
    { data: allEntities },
    { data: referenceLinks },
  ] = await Promise.all([
    supabase
      .from("projects")
      .select(
        "id, project_code, project_type, client_name, status, start_date, target_close_date, notes"
      )
      .eq("id", id)
      .maybeSingle()
      .returns<Project | null>(),
    supabase
      .from("project_properties")
      .select(
        "id, status, notes, property:properties!property_id(id, display_code, address, suite_number)"
      )
      .eq("project_id", id)
      .order("created_at", { ascending: false })
      .returns<CandidateRow[]>(),
    supabase
      .from("properties")
      .select("id, display_code, address, suite_number")
      .order("address", { ascending: true })
      .returns<PropertyOption[]>(),
    supabase
      .from("project_contacts")
      .select(
        "id, role, split_pct, notes, contact:contacts!contact_id(id, first_name, last_name), entity:entities!entity_id(id, display_code, name)"
      )
      .eq("project_id", id)
      .order("created_at", { ascending: false })
      .returns<ProjectContactRow[]>(),
    supabase
      .from("contacts")
      .select("id, first_name, last_name")
      .order("first_name", { ascending: true })
      .returns<{ id: string; first_name: string | null; last_name: string | null }[]>(),
    supabase
      .from("entities")
      .select("id, display_code, name")
      .order("name", { ascending: true })
      .returns<NamedEntity[]>(),
    supabase
      .from("reference_links")
      .select("id, label, url, link_type, notes")
      .eq("project_id", id)
      .order("created_at", { ascending: false })
      .returns<ReferenceLinkRow[]>(),
  ]);

  if (!project) notFound();

  const linkedIds = new Set((candidates ?? []).map((c) => oneProperty(c.property)?.id));
  const availableProperties = (allProperties ?? []).filter(
    (p) => !linkedIds.has(p.id)
  );

  const linkedContactIds = new Set(
    (projectContacts ?? []).map((pc) => one(pc.contact)?.id).filter(Boolean)
  );
  const availableContacts = (allContacts ?? []).filter(
    (c) => !linkedContactIds.has(c.id)
  );

  const linkedEntityIds = new Set(
    (projectContacts ?? []).map((pc) => one(pc.entity)?.id).filter(Boolean)
  );
  const availableEntities = (allEntities ?? []).filter(
    (e) => !linkedEntityIds.has(e.id)
  );

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <Link href="/projects" className="text-sm text-blue-600 underline">
        ← All projects
      </Link>

      <h1 className="text-2xl font-semibold mt-2 mb-1">
        {project.project_code}
        <span className="text-gray-400 font-normal"> — {project.project_type}</span>
      </h1>
      <p className="text-gray-500 mb-6">
        {project.client_name} · {statusLabel(project.status)}
        {project.start_date && <> · started {project.start_date}</>}
        {project.target_close_date && (
          <> · target close {project.target_close_date}</>
        )}
      </p>
      {project.notes && (
        <p className="text-sm text-gray-600 mb-6 border border-gray-200 rounded-lg p-3">
          {project.notes}
        </p>
      )}

      <h2 className="text-lg font-semibold mb-3">Candidate properties</h2>

      <form
        action={addCandidateProperty}
        className="grid grid-cols-3 gap-3 mb-6 border border-gray-200 rounded-lg p-4"
      >
        <input type="hidden" name="project_id" value={project.id} />
        <select
          name="property_id"
          defaultValue=""
          required
          className="border border-gray-300 rounded px-3 py-2 col-span-2"
        >
          <option value="" disabled>
            Select a property…
          </option>
          {availableProperties.map((p) => (
            <option key={p.id} value={p.id}>
              {propertyLabel(p)}
            </option>
          ))}
        </select>
        <select
          name="status"
          defaultValue="candidate"
          className="border border-gray-300 rounded px-3 py-2"
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <textarea
          name="notes"
          placeholder="Notes (optional)"
          rows={2}
          className="border border-gray-300 rounded px-3 py-2 col-span-2"
        />
        <button
          type="submit"
          className="bg-black text-white rounded px-4 py-2 justify-self-start h-fit"
        >
          Add candidate
        </button>
      </form>

      <table className="w-full text-sm border-collapse mb-10">
        <thead>
          <tr className="text-left border-b border-gray-300">
            <th className="py-2 pr-3">Property</th>
            <th className="py-2 pr-3">Status</th>
            <th className="py-2 pr-3">Notes</th>
            <th className="py-2 pr-3"></th>
          </tr>
        </thead>
        <tbody>
          {candidates?.map((c) => {
            const property = oneProperty(c.property);
            return (
              <tr key={c.id} className="border-b border-gray-100">
                <td className="py-2 pr-3">
                  {property ? (
                    <Link
                      href={`/properties`}
                      className="text-blue-600 underline"
                    >
                      {propertyLabel(property)}
                    </Link>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="py-2 pr-3">
                  <form
                    action={updateCandidateStatus}
                    className="flex items-center gap-2"
                  >
                    <input type="hidden" name="id" value={c.id} />
                    <input
                      type="hidden"
                      name="project_id"
                      value={project.id}
                    />
                    <select
                      name="status"
                      defaultValue={c.status}
                      className="border border-gray-300 rounded px-2 py-1"
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
                </td>
                <td className="py-2 pr-3 text-gray-500">{c.notes ?? "—"}</td>
                <td className="py-2 pr-3">
                  <form action={removeCandidateProperty}>
                    <input type="hidden" name="id" value={c.id} />
                    <input
                      type="hidden"
                      name="project_id"
                      value={project.id}
                    />
                    <button
                      type="submit"
                      className="text-xs text-red-600 hover:underline"
                    >
                      Remove
                    </button>
                  </form>
                </td>
              </tr>
            );
          })}
          {candidates?.length === 0 && (
            <tr>
              <td colSpan={4} className="py-4 text-gray-400">
                No candidate properties linked yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <h2 className="text-lg font-semibold mb-1">
        Linked contacts &amp; collaborators
      </h2>
      <p className="text-gray-500 mb-4 text-sm">
        Decision-makers, co-brokers, referral sources, or other parties on
        this deal. For a commission-split collaborator, set Split % — a
        referral fee is typically 10–20% off the top of the gross
        commission, a co-broker split (50/50 or 60/40 typical) divides
        what&apos;s left after any referral. Link a specific person below, or
        an outside brokerage directly (e.g. before you have a contact
        there) in the second form.
      </p>

      <form
        action={addProjectContact}
        className="grid grid-cols-4 gap-3 mb-3 border border-gray-200 rounded-lg p-4"
      >
        <input type="hidden" name="project_id" value={project.id} />
        <select
          name="contact_id"
          defaultValue=""
          required
          className="border border-gray-300 rounded px-3 py-2"
        >
          <option value="" disabled>
            Select a contact…
          </option>
          {availableContacts.map((c) => (
            <option key={c.id} value={c.id}>
              {[c.first_name, c.last_name].filter(Boolean).join(" ") || "Unnamed contact"}
            </option>
          ))}
        </select>
        <input
          name="role"
          placeholder="Role (e.g. co-broker, referral) — optional"
          className="border border-gray-300 rounded px-3 py-2"
        />
        <input
          name="split_pct"
          type="number"
          step="0.01"
          placeholder="Split % — optional"
          className="border border-gray-300 rounded px-3 py-2"
        />
        <button
          type="submit"
          className="bg-black text-white rounded px-4 py-2 justify-self-start h-fit"
        >
          Link contact
        </button>
      </form>

      <form
        action={addProjectCollaboratorEntity}
        className="grid grid-cols-4 gap-3 mb-6 border border-gray-200 rounded-lg p-4"
      >
        <input type="hidden" name="project_id" value={project.id} />
        <select
          name="entity_id"
          defaultValue=""
          required
          className="border border-gray-300 rounded px-3 py-2"
        >
          <option value="" disabled>
            Select an entity (brokerage, company)…
          </option>
          {availableEntities.map((e) => (
            <option key={e.id} value={e.id}>
              {entityLabel(e)}
            </option>
          ))}
        </select>
        <input
          name="role"
          placeholder="Role (e.g. co-broker, referral) — optional"
          className="border border-gray-300 rounded px-3 py-2"
        />
        <input
          name="split_pct"
          type="number"
          step="0.01"
          placeholder="Split % — optional"
          className="border border-gray-300 rounded px-3 py-2"
        />
        <button
          type="submit"
          className="bg-black text-white rounded px-4 py-2 justify-self-start h-fit"
        >
          Link entity
        </button>
      </form>

      <table className="w-full text-sm border-collapse mb-10">
        <thead>
          <tr className="text-left border-b border-gray-300">
            <th className="py-2 pr-3">Contact / Entity</th>
            <th className="py-2 pr-3">Role</th>
            <th className="py-2 pr-3">Split %</th>
            <th className="py-2 pr-3">Notes</th>
            <th className="py-2 pr-3"></th>
          </tr>
        </thead>
        <tbody>
          {projectContacts?.map((pc) => {
            const contact = one(pc.contact);
            const entity = one(pc.entity);
            return (
              <tr key={pc.id} className="border-b border-gray-100">
                <td className="py-2 pr-3">
                  {contact ? (
                    <Link href="/contacts" className="text-blue-600 underline">
                      {contactName(contact)}
                    </Link>
                  ) : entity ? (
                    <Link href="/entities" className="text-blue-600 underline">
                      {entityLabel(entity)}
                    </Link>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="py-2 pr-3 text-gray-500">{pc.role ?? "—"}</td>
                <td className="py-2 pr-3 text-gray-500">
                  {pc.split_pct != null ? `${pc.split_pct}%` : "—"}
                </td>
                <td className="py-2 pr-3 text-gray-500">{pc.notes ?? "—"}</td>
                <td className="py-2 pr-3">
                  <form action={removeProjectContact}>
                    <input type="hidden" name="id" value={pc.id} />
                    <input type="hidden" name="project_id" value={project.id} />
                    <button
                      type="submit"
                      className="text-xs text-red-600 hover:underline"
                    >
                      Remove
                    </button>
                  </form>
                </td>
              </tr>
            );
          })}
          {projectContacts?.length === 0 && (
            <tr>
              <td colSpan={5} className="py-4 text-gray-400">
                No contacts or collaborators linked yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <h2 className="text-lg font-semibold mb-3">Reference links</h2>
      <p className="text-gray-500 mb-4 text-sm">
        Standing deal-terms answers and shareable links (marketing package,
        due diligence, etc.) for this project — a structured alternative to
        logging them as activity notes.
      </p>

      <form
        action={addReferenceLink}
        className="grid grid-cols-4 gap-3 mb-6 border border-gray-200 rounded-lg p-4"
      >
        <input type="hidden" name="project_id" value={project.id} />
        <input
          name="label"
          placeholder="Label (e.g. Marketing Package)"
          required
          className="border border-gray-300 rounded px-3 py-2"
        />
        <input
          name="url"
          placeholder="URL (optional)"
          className="border border-gray-300 rounded px-3 py-2"
        />
        <input
          name="link_type"
          placeholder="Type (e.g. marketing_package) — optional"
          className="border border-gray-300 rounded px-3 py-2"
        />
        <textarea
          name="notes"
          placeholder="Notes / standing answer text — optional"
          rows={1}
          className="border border-gray-300 rounded px-3 py-2 col-span-3"
        />
        <button
          type="submit"
          className="bg-black text-white rounded px-4 py-2 justify-self-start h-fit"
        >
          Add link
        </button>
      </form>

      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="text-left border-b border-gray-300">
            <th className="py-2 pr-3">Label</th>
            <th className="py-2 pr-3">Link</th>
            <th className="py-2 pr-3">Notes</th>
            <th className="py-2 pr-3"></th>
          </tr>
        </thead>
        <tbody>
          {referenceLinks?.map((rl) => (
            <tr key={rl.id} className="border-b border-gray-100">
              <td className="py-2 pr-3">
                {rl.label}
                {rl.link_type && (
                  <span className="text-gray-400"> · {rl.link_type}</span>
                )}
              </td>
              <td className="py-2 pr-3">
                {rl.url ? (
                  <a
                    href={rl.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-blue-600 underline"
                  >
                    Open
                  </a>
                ) : (
                  "—"
                )}
              </td>
              <td className="py-2 pr-3 text-gray-500">{rl.notes ?? "—"}</td>
              <td className="py-2 pr-3">
                <form action={removeReferenceLink}>
                  <input type="hidden" name="id" value={rl.id} />
                  <input type="hidden" name="project_id" value={project.id} />
                  <button
                    type="submit"
                    className="text-xs text-red-600 hover:underline"
                  >
                    Remove
                  </button>
                </form>
              </td>
            </tr>
          ))}
          {referenceLinks?.length === 0 && (
            <tr>
              <td colSpan={4} className="py-4 text-gray-400">
                No reference links yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
