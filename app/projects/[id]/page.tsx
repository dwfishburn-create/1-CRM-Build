import Link from "next/link";
import { notFound } from "next/navigation";
import { supabase } from "@/lib/supabase";
import {
  addCandidateProperty,
  removeCandidateProperty,
  updateCandidateStatus,
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

export default async function ProjectDetailPage(
  props: PageProps<"/projects/[id]">
) {
  const { id } = await props.params;

  const [{ data: project }, { data: candidates }, { data: allProperties }] =
    await Promise.all([
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
    ]);

  if (!project) notFound();

  const linkedIds = new Set((candidates ?? []).map((c) => oneProperty(c.property)?.id));
  const availableProperties = (allProperties ?? []).filter(
    (p) => !linkedIds.has(p.id)
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

      <table className="w-full text-sm border-collapse">
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
    </div>
  );
}
