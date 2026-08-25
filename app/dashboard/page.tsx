import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { completeTaskAction } from "../tasks/actions";

export const dynamic = "force-dynamic";

type NamedContact = { id: string; first_name: string | null; last_name: string | null };
type NamedEntity = { id: string; name: string };
type NamedProperty = { id: string; display_code: string | null; address: string };
type NamedProject = { id: string; project_code: string; client_name: string };
type NamedRequirement = { id: string; display_code: string | null; deal_type: string | null };

type TaskRow = {
  id: string;
  display_code: string | null;
  description: string;
  due_date: string | null;
  category: string | null;
  waiting_on_contact: NamedContact | NamedContact[] | null;
  contact: NamedContact | NamedContact[] | null;
  entity: NamedEntity | NamedEntity[] | null;
  property: NamedProperty | NamedProperty[] | null;
  project: NamedProject | NamedProject[] | null;
  requirement: NamedRequirement | NamedRequirement[] | null;
};

type ActivityRow = {
  project_id: string | null;
  activity_date: string;
  summary: string | null;
  activity_type: string;
};

function one<T>(v: T | T[] | null): T | null {
  if (!v) return null;
  return Array.isArray(v) ? v[0] ?? null : v;
}

function contactName(c: NamedContact | null): string {
  if (!c) return "";
  return [c.first_name, c.last_name].filter(Boolean).join(" ") || "Unnamed contact";
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function isOverdue(dueDate: string | null): boolean {
  return !!dueDate && dueDate < todayStr();
}

function isDueToday(dueDate: string | null): boolean {
  return dueDate === todayStr();
}

function linkedToLabel(t: TaskRow): { label: string; href: string } | null {
  const project = one(t.project);
  if (project) {
    return {
      label: `${project.project_code} — ${project.client_name}`,
      href: `/projects/${project.id}`,
    };
  }
  const requirement = one(t.requirement);
  if (requirement) {
    return { label: requirement.display_code ?? "Requirement", href: `/requirements/${requirement.id}` };
  }
  const property = one(t.property);
  if (property) {
    return { label: property.display_code ?? property.address, href: "/properties" };
  }
  const entity = one(t.entity);
  if (entity) {
    return { label: entity.name, href: "/entities" };
  }
  const contact = one(t.contact);
  if (contact) {
    return { label: contactName(contact), href: "/contacts" };
  }
  return null;
}

function TaskCard({
  task,
  lastActivity,
}: {
  task: TaskRow;
  lastActivity: ActivityRow | undefined;
}) {
  const linked = linkedToLabel(task);
  const overdue = isOverdue(task.due_date);
  const dueToday = isDueToday(task.due_date);

  return (
    <div className="border border-gray-200 rounded-lg p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm">{task.description}</p>
          <p className="text-xs text-gray-400 mt-1">
            {task.display_code}
            {task.category && <> · {task.category}</>}
            {task.due_date && (
              <>
                {" · "}
                <span
                  className={
                    overdue
                      ? "text-red-600 font-medium"
                      : dueToday
                      ? "text-amber-600 font-medium"
                      : ""
                  }
                >
                  {overdue ? "Overdue " : dueToday ? "Due today " : "Due "}
                  {task.due_date}
                </span>
              </>
            )}
            {linked && (
              <>
                {" · "}
                <Link href={linked.href} className="text-blue-600 underline">
                  {linked.label}
                </Link>
              </>
            )}
          </p>
          {lastActivity && (
            <p className="text-xs text-gray-400 mt-1 italic">
              Last: {lastActivity.summary || lastActivity.activity_type} (
              {lastActivity.activity_date.slice(0, 10)})
            </p>
          )}
        </div>
        <form action={completeTaskAction} className="shrink-0">
          <input type="hidden" name="id" value={task.id} />
          <button
            type="submit"
            className="text-xs border border-gray-300 rounded px-2 py-1 hover:bg-gray-50 whitespace-nowrap"
          >
            Mark done
          </button>
        </form>
      </div>
    </div>
  );
}

export default async function DashboardPage() {
  const { data: tasks, error } = await supabase
    .from("tasks")
    .select(
      "id, display_code, description, due_date, category, waiting_on_contact:contacts!waiting_on_contact_id(id, first_name, last_name), contact:contacts!contact_id(id, first_name, last_name), entity:entities!entity_id(id, name), property:properties!property_id(id, display_code, address), project:projects!project_id(id, project_code, client_name), requirement:requirements!requirement_id(id, display_code, deal_type)"
    )
    .eq("status", "open")
    .order("due_date", { ascending: true, nullsFirst: false })
    .returns<TaskRow[]>();

  const allTasks = tasks ?? [];

  // "What was the last thing that happened" context: pull the most recent
  // activity_log entry per project among tasks linked to a project, per the
  // Dashboard design (last thing / next thing / who owns it).
  const projectIds = Array.from(
    new Set(allTasks.map((t) => one(t.project)?.id).filter((id): id is string => !!id))
  );

  let lastActivityByProject = new Map<string, ActivityRow>();
  if (projectIds.length > 0) {
    const { data: activity } = await supabase
      .from("activity_log")
      .select("project_id, activity_date, summary, activity_type")
      .in("project_id", projectIds)
      .order("activity_date", { ascending: false })
      .returns<ActivityRow[]>();

    lastActivityByProject = new Map();
    for (const a of activity ?? []) {
      if (a.project_id && !lastActivityByProject.has(a.project_id)) {
        lastActivityByProject.set(a.project_id, a);
      }
    }
  }

  const yourMove = allTasks.filter((t) => !one(t.waiting_on_contact));
  const waitingOnTasks = allTasks.filter((t) => one(t.waiting_on_contact));

  const waitingByContact = new Map<string, { contact: NamedContact; tasks: TaskRow[] }>();
  for (const t of waitingOnTasks) {
    const c = one(t.waiting_on_contact)!;
    const existing = waitingByContact.get(c.id);
    if (existing) {
      existing.tasks.push(t);
    } else {
      waitingByContact.set(c.id, { contact: c, tasks: [t] });
    }
  }

  const overdueCount = allTasks.filter((t) => isOverdue(t.due_date)).length;
  const dueTodayCount = allTasks.filter((t) => isDueToday(t.due_date)).length;

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <Link href="/tasks" className="text-sm text-blue-600 underline">
          All tasks →
        </Link>
      </div>
      <p className="text-gray-500 mb-6 text-sm">
        Daily triage: what&apos;s your move, and what are you waiting on
        someone else for. Open tasks only — see All tasks for the full list
        and to add new ones.
      </p>

      {error && <p className="text-red-600 mb-4">Error loading dashboard: {error.message}</p>}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        <div className="border border-gray-200 rounded-lg p-4">
          <div className="text-3xl font-semibold">{allTasks.length}</div>
          <div className="text-gray-500 text-sm">Open tasks</div>
        </div>
        <div className="border border-gray-200 rounded-lg p-4">
          <div className={`text-3xl font-semibold ${overdueCount > 0 ? "text-red-600" : ""}`}>
            {overdueCount}
          </div>
          <div className="text-gray-500 text-sm">Overdue</div>
        </div>
        <div className="border border-gray-200 rounded-lg p-4">
          <div className={`text-3xl font-semibold ${dueTodayCount > 0 ? "text-amber-600" : ""}`}>
            {dueTodayCount}
          </div>
          <div className="text-gray-500 text-sm">Due today</div>
        </div>
        <div className="border border-gray-200 rounded-lg p-4">
          <div className="text-3xl font-semibold">{waitingByContact.size}</div>
          <div className="text-gray-500 text-sm">People you&apos;re waiting on</div>
        </div>
      </div>

      <h2 className="text-lg font-semibold mb-3">Your move ({yourMove.length})</h2>
      <div className="grid gap-2 mb-10">
        {yourMove.map((t) => (
          <TaskCard
            key={t.id}
            task={t}
            lastActivity={
              one(t.project) ? lastActivityByProject.get(one(t.project)!.id) : undefined
            }
          />
        ))}
        {yourMove.length === 0 && (
          <p className="text-gray-400 text-sm">Nothing on your plate right now.</p>
        )}
      </div>

      <h2 className="text-lg font-semibold mb-3">Waiting on someone else</h2>
      <div className="grid gap-6">
        {Array.from(waitingByContact.values()).map(({ contact, tasks: contactTasks }) => (
          <div key={contact.id}>
            <h3 className="text-sm font-medium text-gray-600 mb-2">{contactName(contact)}</h3>
            <div className="grid gap-2">
              {contactTasks.map((t) => (
                <TaskCard
                  key={t.id}
                  task={t}
                  lastActivity={
                    one(t.project) ? lastActivityByProject.get(one(t.project)!.id) : undefined
                  }
                />
              ))}
            </div>
          </div>
        ))}
        {waitingByContact.size === 0 && (
          <p className="text-gray-400 text-sm">Not waiting on anyone right now.</p>
        )}
      </div>
    </div>
  );
}
