import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { createProject } from "./actions";

export const dynamic = "force-dynamic";

type ProjectRow = {
  id: string;
  project_code: string;
  project_type: string;
  client_name: string;
  status: string;
  start_date: string | null;
  target_close_date: string | null;
};

// Dan's existing engagement taxonomy from
// New_Project_Setup_and_Categorization_-_SOP.md. SL (Sub-Lease Listing)
// added 8/26/2026 — this list was stale (missing it) until 9/1/2026.
// project_type stays free text in the DB (no check constraint) so a
// live compound/undecided case like "TR/BR" (deal path not yet chosen)
// stays possible — pick one of these for the normal case, or type a
// "X/Y" combo directly in this field if the path is genuinely undecided.
const PROJECT_TYPES = ["TR", "BR", "CL", "CS", "L", "LRT", "LRLL", "SL"];

const STATUSES = [
  { value: "active", label: "Active" },
  { value: "on_hold", label: "On Hold" },
  { value: "closed_won", label: "Closed — Won" },
  { value: "closed_lost", label: "Closed — Lost" },
];

function statusLabel(value: string): string {
  return STATUSES.find((s) => s.value === value)?.label ?? value;
}

export default async function ProjectsPage() {
  const { data: projects, error } = await supabase
    .from("projects")
    .select(
      "id, project_code, project_type, client_name, status, start_date, target_close_date"
    )
    .order("created_at", { ascending: false })
    .returns<ProjectRow[]>();

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <h1 className="text-2xl font-semibold mb-1">Projects</h1>
      <p className="text-gray-500 mb-6 text-sm">
        Formal assignments — TR/BR/CL/CS/L/LRT/LRLL per your existing SOP.
        Open a project to link and track candidate properties (Candidate →
        Toured → Selected/Rejected).
      </p>

      <form
        action={createProject}
        className="grid grid-cols-2 gap-3 mb-10 border border-gray-200 rounded-lg p-4"
      >
        <input
          name="project_code"
          placeholder="Project code (e.g. TR-2026-014)"
          required
          className="border border-gray-300 rounded px-3 py-2"
        />
        <select
          name="project_type"
          defaultValue=""
          required
          className="border border-gray-300 rounded px-3 py-2"
        >
          <option value="" disabled>
            Type…
          </option>
          {PROJECT_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <input
          name="client_name"
          placeholder="Client name"
          required
          className="border border-gray-300 rounded px-3 py-2 col-span-2"
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
        <div />
        <label className="text-xs text-gray-500 -mb-2">Start date</label>
        <label className="text-xs text-gray-500 -mb-2">
          Target close date
        </label>
        <input
          name="start_date"
          type="date"
          className="border border-gray-300 rounded px-3 py-2"
        />
        <input
          name="target_close_date"
          type="date"
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
          Add project
        </button>
      </form>

      {error && (
        <p className="text-red-600 mb-4">
          Error loading projects: {error.message}
        </p>
      )}

      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="text-left border-b border-gray-300">
            <th className="py-2 pr-3">Code</th>
            <th className="py-2 pr-3">Type</th>
            <th className="py-2 pr-3">Client</th>
            <th className="py-2 pr-3">Status</th>
            <th className="py-2 pr-3">Start</th>
            <th className="py-2 pr-3">Target Close</th>
          </tr>
        </thead>
        <tbody>
          {projects?.map((p) => (
            <tr key={p.id} className="border-b border-gray-100">
              <td className="py-2 pr-3">
                <Link
                  href={`/projects/${p.id}`}
                  className="text-blue-600 underline"
                >
                  {p.project_code}
                </Link>
              </td>
              <td className="py-2 pr-3 text-gray-500">{p.project_type}</td>
              <td className="py-2 pr-3">{p.client_name}</td>
              <td className="py-2 pr-3">{statusLabel(p.status)}</td>
              <td className="py-2 pr-3 text-gray-500">
                {p.start_date ?? "—"}
              </td>
              <td className="py-2 pr-3 text-gray-500">
                {p.target_close_date ?? "—"}
              </td>
            </tr>
          ))}
          {projects?.length === 0 && (
            <tr>
              <td colSpan={6} className="py-4 text-gray-400">
                No projects yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
