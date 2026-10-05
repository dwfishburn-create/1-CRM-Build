import { supabase } from "@/lib/supabase";
import { runDeadlineWarnings } from "@/lib/deadlines";
import { contactHref, entityHref, propertyHref } from "@/lib/records";
import {
  addDays,
  dayOfWeek,
  daysBetween,
  longDate,
  monthDay,
  monthName,
  nextMonday,
  shortDay,
  todayCentral,
} from "@/lib/centralDate";
import DashboardView, {
  type AheadData,
  type DashRow,
  type PreviewData,
  type WaitingRow,
} from "./DashboardView";

export const dynamic = "force-dynamic";

// Dashboard redesign, 9/26/2026. The rule (Dan): the Dashboard shows nothing
// that is in the future — only what is due today or overdue. Next week comes
// through the weekly Preview (Wednesday–Sunday, retired with "Got it"); anything
// further out is behind the Looking Ahead button. One line per item; the full
// description, last activity and actions open on click. Deal work and
// prospecting are separate lanes. Supersedes the 9/9/2026 lease-events panel:
// lease dates show in the Preview and Looking Ahead, not on the daily screen.

type Named = { id: string; name: string; trade_name?: string | null };
type Person = { id: string; first_name: string | null; last_name: string | null };
type Prop = { id: string; display_code: string | null; address: string; city: string | null };
type Proj = { id: string; project_code: string; client_name: string; expected_value: number | null };

type TaskRow = {
  id: string;
  display_code: string | null;
  title: string | null;
  description: string;
  due_date: string | null;
  category: string | null;
  created_at: string;
  source_system: string | null;
  project_id: string | null;
  waiting_on_contact: Person | Person[] | null;
  contact: Person | Person[] | null;
  entity: Named | Named[] | null;
  property: Prop | Prop[] | null;
  project: Proj | Proj[] | null;
};

type LeaseEventRow = {
  id: string;
  event_type: string;
  event_date: string | null;
  amount: number | null;
  lease: {
    tenant_entity: Named | Named[] | null;
    space: { property: Prop | Prop[] | null } | { property: Prop | Prop[] | null }[] | null;
  } | null;
};

type DeadlineRow = {
  id: string;
  deadline_date: string | null;
  amount: number | null;
  type: { label: string; is_money: boolean } | { label: string; is_money: boolean }[] | null;
  project: { project_code: string; status: string | null } | { project_code: string; status: string | null }[] | null;
};

type PastItem = { id: string; kind: "lease" | "deadline"; sortDate: string; date: string; text: string };

function one<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  return Array.isArray(v) ? v[0] ?? null : v;
}

function personName(p: Person | null): string {
  if (!p) return "";
  return [p.first_name, p.last_name].filter(Boolean).join(" ") || "Unnamed contact";
}

/** Falls back to the first clause of the description when a task has no title. */
function titleOf(t: TaskRow): string {
  if (t.title) return t.title;
  const first = t.description.split(/(?<=[.:;?!])\s|\s—\s/)[0] ?? t.description;
  return first.length > 80 ? first.slice(0, 77).trimEnd() + "…" : first;
}

function contextOf(t: TaskRow): { label: string; href: string | null } {
  const entity = one(t.entity);
  const property = one(t.property);
  const project = one(t.project);
  const parts: string[] = [];
  if (entity) parts.push(entity.trade_name || entity.name);
  if (property) parts.push([property.address, property.city].filter(Boolean).join(", "));
  const href = project
    ? `/projects/${project.id}`
    : property
    ? propertyHref(property.id)
    : entity
    ? entityHref(entity.id)
    : one(t.contact)
    ? contactHref(one(t.contact)!.id)
    : null;
  if (parts.length) return { label: parts.join(" · "), href };
  if (project) return { label: project.project_code, href };
  const c = one(t.contact);
  return { label: c ? personName(c) : "", href };
}

function dueLabel(due: string | null, today: string): { text: string; late: boolean } {
  if (!due) return { text: "No date", late: false };
  const d = daysBetween(due, today);
  if (d > 0) return { text: d === 1 ? "1 day late" : `${d} days late`, late: true };
  if (d === 0) return { text: "Today", late: false };
  return { text: shortDay(due), late: false };
}

function leaseEventText(e: LeaseEventRow): string {
  const tenant = one(e.lease?.tenant_entity);
  const space = one(e.lease?.space ?? null);
  const property = space ? one(space.property) : null;
  const who = [tenant ? tenant.trade_name || tenant.name : null, property?.address].filter(Boolean).join(", ");
  return who ? `${e.event_type} — ${who}` : e.event_type;
}

function flagFor(category: string | null): string {
  return category && /listing|contract|deposit|closing|escrow/i.test(category) ? "Contract" : "";
}

export default async function DashboardPage() {
  const today = todayCentral();

  // Safety net for the daily cron (migration 022): issue any deadline warnings
  // due today before reading tasks. Idempotent, so it costs nothing when the
  // cron has already run. A failure here must never take the Dashboard down.
  let warningError: string | null = null;
  try {
    await runDeadlineWarnings();
  } catch (e) {
    warningError = (e as Error).message;
  }

  const { data: tasksData, error } = await supabase
    .from("tasks")
    .select(
      "id, display_code, title, description, due_date, category, created_at, source_system, project_id, " +
        "waiting_on_contact:contacts!waiting_on_contact_id(id, first_name, last_name), " +
        "contact:contacts!contact_id(id, first_name, last_name), " +
        "entity:entities!entity_id(id, name, trade_name), " +
        "property:properties!property_id(id, display_code, address, city), " +
        "project:projects!project_id(id, project_code, client_name, expected_value)"
    )
    .eq("status", "open")
    .returns<TaskRow[]>();
  const tasks = tasksData ?? [];

  const { data: eventsData } = await supabase
    .from("lease_events")
    .select(
      "id, event_type, event_date, amount, lease:leases(tenant_entity:entities!tenant_entity_id(id, name, trade_name), space:spaces(property:properties(id, display_code, address, city)))"
    )
    .eq("is_completed", false)
    .returns<LeaseEventRow[]>();
  const events = eventsData ?? [];

  const { data: deadlinesData } = await supabase
    .from("project_deadlines")
    .select("id, deadline_date, amount, type:deadline_types!deadline_type(label, is_money), project:projects!project_id(project_code, status)")
    .eq("is_completed", false)
    .not("deadline_date", "is", null)
    .returns<DeadlineRow[]>();
  const deadlines = (deadlinesData ?? []).filter((d) => one(d.project)?.status !== "closed_lost");
  const deadlineText = (d: DeadlineRow) =>
    `${one(d.project)?.project_code.split(" - ")[0] ?? "Project"} — ${one(d.type)?.label ?? "Deadline"}`;

  // Client work vs prospecting (replaces the 9/27 interim rule): a task with
  // no project is prospecting only when it came from RealNex AND is not about
  // a client — neither a client entity nor a property carrying a client lease.
  // client_leases is a UNION view, so PostgREST can't embed through it: read
  // the lease ids, then their properties.
  const [{ data: clientRows }, { data: clientLeaseRows }] = await Promise.all([
    supabase.from("projects").select("client_entity_id").in("status", ["active", "closed_won"]).not("client_entity_id", "is", null),
    supabase.from("client_leases").select("lease_id"),
  ]);
  const clientEntities = new Set((clientRows ?? []).map((r) => r.client_entity_id as string));
  const clientProperties = new Set<string>();
  const clientLeaseIds = Array.from(new Set((clientLeaseRows ?? []).map((r) => r.lease_id as string)));
  if (clientLeaseIds.length) {
    const { data: leaseRows } = await supabase
      .from("leases")
      .select("space:spaces(property_id)")
      .in("id", clientLeaseIds);
    for (const row of (leaseRows ?? []) as unknown as { space: { property_id: string } | { property_id: string }[] | null }[]) {
      const space = one(row.space);
      if (space?.property_id) clientProperties.add(space.property_id);
    }
  }

  // Latest activity per project, shown only when a row is opened.
  const projectIds = Array.from(new Set(tasks.map((t) => t.project_id).filter((x): x is string => !!x)));
  const lastByProject = new Map<string, string>();
  if (projectIds.length) {
    const { data: acts } = await supabase
      .from("activity_log")
      .select("project_id, activity_date, summary, activity_type")
      .in("project_id", projectIds)
      .order("activity_date", { ascending: false });
    for (const a of acts ?? []) {
      if (a.project_id && !lastByProject.has(a.project_id)) {
        const text = String(a.summary || a.activity_type);
        lastByProject.set(
          a.project_id,
          `${monthDay(String(a.activity_date).slice(0, 10))} — ${text.length > 280 ? text.slice(0, 277) + "…" : text}`
        );
      }
    }
  }

  // Which open tasks the warning generator created, and what each warns about
  // (10/5/2026, migration 023). Those rows get "Got it" (clears the reminder;
  // the next lead time still warns) and "Deadline / Lease date handled" (marks
  // the date itself done, which closes the task). Warnings attached to a task
  // Dan wrote himself are not listed — his task keeps the plain "Mark done".
  const warningSource = new Map<string, { kind: "deadline" | "lease"; id: string }>();
  const openIds = tasks.map((t) => t.id);
  if (openIds.length) {
    const { data: warnRows } = await supabase
      .from("deadline_warnings")
      .select("task_id, source_kind, source_id, created_at")
      .in("task_id", openIds)
      .eq("attached", false)
      .order("created_at", { ascending: false });
    for (const w of warnRows ?? []) {
      if (w.task_id && !warningSource.has(w.task_id)) {
        warningSource.set(w.task_id, {
          kind: w.source_kind === "project_deadline" ? "deadline" : "lease",
          id: w.source_id,
        });
      }
    }
  }

  // ---- Today: your move, split into deals and prospecting -----------------
  const isNow = (t: TaskRow) => !t.due_date || t.due_date <= today;
  const mine = tasks.filter((t) => !one(t.waiting_on_contact));
  const nowTasks = mine.filter(isNow);
  const isProspecting = (t: TaskRow) =>
    t.source_system === "realnex" &&
    !t.project_id &&
    !(one(t.entity) && clientEntities.has(one(t.entity)!.id)) &&
    !(one(t.property) && clientProperties.has(one(t.property)!.id));

  function toRows(list: TaskRow[]): DashRow[] {
    const groups = new Map<string, TaskRow[]>();
    for (const t of list) {
      // One row per project; without a project, one row per lease (same
      // property and tenant) so a lease's warnings and Dan's own task on it
      // read as one conversation (10/5/2026).
      const ent = one(t.entity);
      const prop = one(t.property);
      const key = t.project_id
        ? `p:${t.project_id}`
        : ent && prop
        ? `l:${prop.id}:${ent.id}`
        : `t:${t.id}`;
      groups.set(key, [...(groups.get(key) ?? []), t]);
    }
    const rows: (DashRow & { sortDue: string; ev: number })[] = [];
    for (const [key, g] of groups) {
      g.sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"));
      const lead = g[0];
      const due = dueLabel(lead.due_date, today);
      const ctx = contextOf(lead);
      rows.push({
        key,
        title: titleOf(lead),
        count: g.length,
        context: ctx.label,
        href: ctx.href,
        due: due.text,
        late: due.late,
        last: lead.project_id ? lastByProject.get(lead.project_id) ?? null : null,
        tasks: g.map((t) => ({
          id: t.id,
          code: t.display_code ?? "",
          title: titleOf(t),
          description: t.description,
          due: dueLabel(t.due_date, today).text,
          category: t.category ?? "",
          source: warningSource.get(t.id) ?? null,
        })),
        sortDue: lead.due_date ?? "9999-12-31",
        ev: one(lead.project)?.expected_value ?? 0,
      });
    }
    // Most overdue first, then today, then undated; bigger deals first on ties.
    rows.sort((a, b) => a.sortDue.localeCompare(b.sortDue) || b.ev - a.ev);
    return rows.map((r) => ({
      key: r.key, title: r.title, count: r.count, context: r.context, href: r.href,
      due: r.due, late: r.late, last: r.last, tasks: r.tasks,
    }));
  }

  const deals = toRows(nowTasks.filter((t) => !isProspecting(t)));
  const prospects = toRows(nowTasks.filter(isProspecting));

  // ---- Waiting on: status, not a to-do, so every one shows ----------------
  const waiting: WaitingRow[] = tasks
    .filter((t) => one(t.waiting_on_contact))
    .sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"))
    .map((t) => {
      const who = one(t.waiting_on_contact)!;
      const ctx = contextOf(t);
      let follow = "";
      let late = false;
      if (t.due_date) {
        const d = daysBetween(t.due_date, today);
        if (d > 0) {
          follow = `follow up — ${d === 1 ? "1 day" : `${d} days`} late`;
          late = true;
        } else follow = d === 0 ? "follow up today" : `follow up ${shortDay(t.due_date)}`;
      }
      return {
        id: t.id,
        description: t.description,
        who: personName(who),
        whoHref: contactHref(who.id),
        what: titleOf(t),
        context: ctx.label,
        since: [`Asked ${monthDay(t.created_at.slice(0, 10))}`, follow].filter(Boolean).join(" · "),
        late,
      };
    });

  // ---- Weekly Preview: shown Wednesday through Sunday ---------------------
  const dow = dayOfWeek(today);
  const inPreviewWindow = dow === 0 || dow >= 3;
  const weekStart = nextMonday(today);
  const weekEnd = addDays(weekStart, 6);
  let preview: PreviewData | null = null;
  if (inPreviewWindow) {
    const { data: dismissed } = await supabase
      .from("dashboard_preview_dismissals")
      .select("week_start")
      .eq("week_start", weekStart)
      .maybeSingle();
    if (!dismissed) {
      type Item = { date: string; text: string; flag: string };
      const items: Item[] = [];
      for (const t of tasks) {
        if (t.due_date && t.due_date >= weekStart && t.due_date <= weekEnd) {
          const w = one(t.waiting_on_contact);
          items.push({
            date: t.due_date,
            text: w ? `${personName(w)} — follow up: ${titleOf(t)}` : titleOf(t),
            flag: flagFor(t.category),
          });
        }
      }
      for (const e of events) {
        if (e.event_date && e.event_date >= weekStart && e.event_date <= weekEnd) {
          items.push({ date: e.event_date, text: leaseEventText(e), flag: e.amount ? "Money due" : "Deadline" });
        }
      }
      for (const d of deadlines) {
        if (d.deadline_date! >= weekStart && d.deadline_date! <= weekEnd) {
          items.push({ date: d.deadline_date!, text: deadlineText(d), flag: one(d.type)?.is_money ? "Money due" : "Contract" });
        }
      }
      items.sort((a, b) => a.date.localeCompare(b.date) || (b.flag ? 1 : 0) - (a.flag ? 1 : 0));
      const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
        .map((d) => ({
          label: shortDay(d),
          weekend: dayOfWeek(d) === 0 || dayOfWeek(d) === 6,
          items: items.filter((it) => it.date === d).map(({ text, flag }) => ({ text, flag })),
        }))
        .filter((d) => !d.weekend || d.items.length > 0)
        .map(({ label, items: its }) => ({ label, items: its }));
      const headlinePicks: string[] = [];
      for (const d of days) {
        if (d.items.length && headlinePicks.length < 3) headlinePicks.push(`${d.label.split(" ")[0]}  ${d.items[0].text}`);
      }
      const shown = headlinePicks.length;
      preview = {
        weekStart,
        rangeLabel: `${shortDay(weekStart)} – ${shortDay(weekEnd)}`,
        headline: headlinePicks,
        more: Math.max(0, items.length - shown),
        total: items.length,
        days,
      };
    }
  }

  // ---- Looking Ahead: everything after today, on demand -------------------
  const horizon = addDays(today, 183);
  type AheadItem = { date: string; text: string; kind: string };
  const ahead: AheadItem[] = [];
  for (const t of tasks) {
    if (t.due_date && t.due_date > today && t.due_date <= horizon) {
      const w = one(t.waiting_on_contact);
      ahead.push({ date: t.due_date, text: w ? `${personName(w)} — ${titleOf(t)}` : titleOf(t), kind: w ? "Waiting on" : t.category || "Task" });
    }
  }
  for (const e of events) {
    if (e.event_date && e.event_date > today && e.event_date <= horizon) {
      ahead.push({ date: e.event_date, text: leaseEventText(e), kind: "Lease date" });
    }
  }
  for (const d of deadlines) {
    if (d.deadline_date! > today && d.deadline_date! <= horizon) {
      ahead.push({ date: d.deadline_date!, text: deadlineText(d), kind: one(d.type)?.is_money ? "Money due" : "Deal deadline" });
    }
  }
  ahead.sort((a, b) => a.date.localeCompare(b.date));
  const months: AheadData["months"] = [];
  for (const it of ahead) {
    const label = monthName(it.date);
    let m = months.find((x) => x.label === label);
    if (!m) months.push((m = { label, items: [] }));
    m.items.push({ date: monthDay(it.date), text: it.text, kind: it.kind });
  }
  const pastDue = events
    .filter((e) => e.event_date && e.event_date < today)
    .sort((a, b) => (a.event_date ?? "").localeCompare(b.event_date ?? ""))
    .map((e): PastItem => ({ id: e.id, kind: "lease", sortDate: e.event_date!, date: monthDay(e.event_date!) + "/" + e.event_date!.slice(2, 4), text: leaseEventText(e) }))
    .concat(
      deadlines
        .filter((d) => d.deadline_date! < today)
        .map((d): PastItem => ({ id: d.id, kind: "deadline", sortDate: d.deadline_date!, date: monthDay(d.deadline_date!) + "/" + d.deadline_date!.slice(2, 4), text: deadlineText(d) }))
    )
    .sort((a, b) => a.sortDate.localeCompare(b.sortDate))
    .map(({ id, kind, date, text }) => ({ id, kind, date, text }));

  // ---- Summary line ---------------------------------------------------------
  const overdue = nowTasks.filter((t) => t.due_date && t.due_date < today).length;
  const dueToday = nowTasks.filter((t) => t.due_date === today).length;
  const summary = [
    overdue ? `${overdue} overdue` : "nothing overdue",
    dueToday ? `${dueToday} due today` : overdue ? "nothing else due today" : "nothing due today",
    waiting.length ? `${waiting.length} waiting` : "not waiting on anyone",
  ].join(" · ");

  return (
    <DashboardView
      dateLabel={longDate(today)}
      summary={summary}
      error={error?.message ?? warningError}
      deals={deals}
      prospects={prospects}
      waiting={waiting}
      preview={preview}
      ahead={{ months, pastDue }}
    />
  );
}
