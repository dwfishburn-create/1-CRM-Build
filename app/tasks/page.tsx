import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { createTask, completeTaskAction, cancelTaskAction } from "./actions";

export const dynamic = "force-dynamic";

type NamedContact = { id: string; first_name: string | null; last_name: string | null };
type NamedEntity = { id: string; name: string };
type NamedProperty = { id: string; display_code: string | null; address: string };
type NamedProject = { id: string; display_code: string | null; project_code: string; client_name: string };
type NamedRequirement = { id: string; display_code: string | null; deal_type: string | null };

type TaskRow = {
  id: string;
  display_code: string | null;
  description: string;
  due_date: string | null;
  status: string;
  category: string | null;
  recurrence_unit: string;
  recurrence_interval: number;
  waiting_on_contact: NamedContact | NamedContact[] | null;
  contact: NamedContact | NamedContact[] | null;
  entity: NamedEntity | NamedEntity[] | null;
  property: NamedProperty | NamedProperty[] | null;
  project: NamedProject | NamedProject[] | null;
  requirement: NamedRequirement | NamedRequirement[] | null;
};

const CATEGORIES = ["Call", "Email", "Follow-up", "Showing", "License renewal", "Admin"];
const RECURRENCE_OPTIONS = [
  { value: "none", label: "One-time" },
  { value: "day", label: "Day(s)" },
  { value: "week", label: "Week(s)" },
  { value: "month", label: "Month(s)" },
  { value: "year", label: "Year(s)" },
];

function one<T>(v: T | T[] | null): T | null {
  if (!v) return null;
  return Array.isArray(v) ? v[0] ?? null : v;
}

function contactName(c: NamedContact | null): string {
  if (!c) return "";
  return [c.first_name, c.last_name].filter(Boolean).join(" ") || "Unnamed contact";
}

function isOverdue(dueDate: string | null, status: string): boolean {
  if (!dueDate || status !== "open") return false;
  return dueDate < new Date().toISOString().slice(0, 10);
}

function linkedToLabel(t: TaskRow): { label: string; href: string } | null {
  const project = one(t.project);
  if (project) {
    return {
      label: `Project — ${project.display_code ?? project.project_code}`,
      href: `/projects/${project.id}`,
    };
  }
  const requirement = one(t.requirement);
  if (requirement) {
    return {
      label: `Requirement — ${requirement.display_code ?? "REQ"}`,
      href: `/requirements/${requirement.id}`,
    };
  }
  const property = one(t.property);
  if (property) {
    return { label: `Property — ${property.display_code ?? property.address}`, href: "/properties" };
  }
  const entity = one(t.entity);
  if (entity) {
    return { label: `Entity — ${entity.name}`, href: "/entities" };
  }
  const contact = one(t.contact);
  if (contact) {
    return { label: `Contact — ${contactName(contact)}`, href: "/contacts" };
  }
  return null;
}

export default async function TasksPage() {
  const [
    { data: tasks, error },
    { data: contacts },
    { data: entities },
    { data: properties },
    { data: projects },
    { data: requirements },
  ] = await Promise.all([
    supabase
      .from("tasks")
      .select(
        "id, display_code, description, due_date, status, category, recurrence_unit, recurrence_interval, waiting_on_contact:contacts!waiting_on_contact_id(id, first_name, last_name), contact:contacts!contact_id(id, first_name, last_name), entity:entities!entity_id(id, name), property:properties!property_id(id, display_code, address), project:projects!project_id(id, display_code, project_code, client_name), requirement:requirements!requirement_id(id, display_code, deal_type)"
      )
      .order("status", { ascending: true })
      .order("due_date", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false })
      .returns<TaskRow[]>(),
    supabase
      .from("contacts")
      .select("id, first_name, last_name")
      .order("first_name", { ascending: true })
      .returns<NamedContact[]>(),
    supabase.from("entities").select("id, name").order("name", { ascending: true }).returns<NamedEntity[]>(),
    supabase
      .from("properties")
      .select("id, display_code, address")
      .order("address", { ascending: true })
      .returns<NamedProperty[]>(),
    supabase
      .from("projects")
      .select("id, display_code, project_code, client_name")
      .order("created_at", { ascending: false })
      .returns<NamedProject[]>(),
    supabase
      .from("requirements")
      .select("id, display_code, deal_type")
      .order("created_at", { ascending: false })
      .returns<NamedRequirement[]>(),
  ]);

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-semibold">Tasks</h1>
        <Link href="/dashboard" className="text-sm text-blue-600 underline">
          Go to Dashboard →
        </Link>
      </div>
      <p className="text-gray-500 mb-6 text-sm">
        Every follow-up, reminder, and standalone to-do — including ones with
        no CRM entity attached at all (e.g. a license renewal date). Set
        &quot;Waiting on&quot; to hand the ball to a contact; leave it blank
        and it&apos;s your move. Recurring tasks spin up their next
        occurrence automatically when marked done.
      </p>

      <form
        action={createTask}
        className="grid grid-cols-4 gap-3 mb-10 border border-gray-200 rounded-lg p-4"
      >
        <textarea
          name="description"
          placeholder="What needs to happen?"
          rows={2}
          required
          className="border border-gray-300 rounded px-3 py-2 col-span-4"
        />

        <input
          name="category"
          list="categories"
          placeholder="Category (call, email, follow-up…)"
          className="border border-gray-300 rounded px-3 py-2"
        />
        <datalist id="categories">
          {CATEGORIES.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>

        <input
          name="due_date"
          type="date"
          className="border border-gray-300 rounded px-3 py-2"
        />

        <select
          name="waiting_on_contact_id"
          defaultValue=""
          className="border border-gray-300 rounded px-3 py-2"
        >
          <option value="">Your move (default)</option>
          {(contacts ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              Waiting on: {contactName(c)}
            </option>
          ))}
        </select>

        <div className="flex gap-2">
          <select
            name="recurrence_unit"
            defaultValue="none"
            className="border border-gray-300 rounded px-3 py-2 flex-1"
          >
            {RECURRENCE_OPTIONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
          <input
            name="recurrence_interval"
            type="number"
            min={1}
            defaultValue={1}
            title="Repeat every N units"
            className="border border-gray-300 rounded px-3 py-2 w-16"
          />
        </div>

        <select
          name="project_id"
          defaultValue=""
          className="border border-gray-300 rounded px-3 py-2"
        >
          <option value="">No project link</option>
          {(projects ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.display_code ?? p.project_code} — {p.client_name}
            </option>
          ))}
        </select>

        <select
          name="property_id"
          defaultValue=""
          className="border border-gray-300 rounded px-3 py-2"
        >
          <option value="">No property link</option>
          {(properties ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.display_code ? `${p.display_code} — ` : ""}
              {p.address}
            </option>
          ))}
        </select>

        <select
          name="contact_id"
          defaultValue=""
          className="border border-gray-300 rounded px-3 py-2"
        >
          <option value="">No contact link</option>
          {(contacts ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {contactName(c)}
            </option>
          ))}
        </select>

        <select
          name="entity_id"
          defaultValue=""
          className="border border-gray-300 rounded px-3 py-2"
        >
          <option value="">No entity link</option>
          {(entities ?? []).map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>

        <select
          name="requirement_id"
          defaultValue=""
          className="border border-gray-300 rounded px-3 py-2"
        >
          <option value="">No requirement link</option>
          {(requirements ?? []).map((r) => (
            <option key={r.id} value={r.id}>
              {r.display_code ?? "REQ"}
              {r.deal_type ? ` — ${r.deal_type}` : ""}
            </option>
          ))}
        </select>

        <button
          type="submit"
          className="col-span-4 bg-black text-white rounded px-4 py-2 justify-self-start"
        >
          Add task
        </button>
      </form>

      {error && <p className="text-red-600 mb-4">Error loading tasks: {error.message}</p>}

      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="text-left border-b border-gray-300">
            <th className="py-2 pr-3">Code</th>
            <th className="py-2 pr-3">Description</th>
            <th className="py-2 pr-3">Category</th>
            <th className="py-2 pr-3">Due</th>
            <th className="py-2 pr-3">Ball in court</th>
            <th className="py-2 pr-3">Linked to</th>
            <th className="py-2 pr-3">Status</th>
            <th className="py-2 pr-3"></th>
          </tr>
        </thead>
        <tbody>
          {tasks?.map((t) => {
            const waitingOn = one(t.waiting_on_contact);
            const linked = linkedToLabel(t);
            const overdue = isOverdue(t.due_date, t.status);
            return (
              <tr key={t.id} className="border-b border-gray-100">
                <td className="py-2 pr-3 text-gray-500">{t.display_code ?? t.id.slice(0, 8)}</td>
                <td className="py-2 pr-3">
                  {t.description}
                  {t.recurrence_unit !== "none" && (
                    <span className="text-xs text-gray-400">
                      {" "}
                      (repeats every {t.recurrence_interval} {t.recurrence_unit}
                      {t.recurrence_interval > 1 ? "s" : ""})
                    </span>
                  )}
                </td>
                <td className="py-2 pr-3 text-gray-500">{t.category ?? "—"}</td>
                <td className={`py-2 pr-3 ${overdue ? "text-red-600 font-medium" : "text-gray-500"}`}>
                  {t.due_date ?? "—"}
                </td>
                <td className="py-2 pr-3">
                  {waitingOn ? `Waiting: ${contactName(waitingOn)}` : "Your move"}
                </td>
                <td className="py-2 pr-3">
                  {linked ? (
                    <Link href={linked.href} className="text-blue-600 underline">
                      {linked.label}
                    </Link>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="py-2 pr-3 capitalize">{t.status}</td>
                <td className="py-2 pr-3">
                  {t.status === "open" && (
                    <div className="flex gap-2">
                      <form action={completeTaskAction}>
                        <input type="hidden" name="id" value={t.id} />
                        <button type="submit" className="text-xs text-green-700 hover:underline">
                          Mark done
                        </button>
                      </form>
                      <form action={cancelTaskAction}>
                        <input type="hidden" name="id" value={t.id} />
                        <button type="submit" className="text-xs text-gray-400 hover:underline">
                          Cancel
                        </button>
                      </form>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
          {tasks?.length === 0 && (
            <tr>
              <td colSpan={8} className="py-4 text-gray-400">
                No tasks yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
