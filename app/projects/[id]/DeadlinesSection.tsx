import { supabase } from "@/lib/supabase";
import { daysBetween, todayCentral } from "@/lib/centralDate";
import { addDeadline, markDeadline, redateDeadline, removeDeadline } from "./deadline-actions";

// Deadlines on a project (migration 022). The dates Dan's own agreements run
// on; each one warns on the Dashboard at its lead times. Derived rows (tail,
// prospect list, deposit) are created by the database and say what they
// follow from.

type TypeRow = { code: string; label: string; family: string; derive_from: string | null; sort_order: number };
type Rule = { type_key: string; lead_label: string };
type DeadlineRow = {
  id: string;
  display_code: string | null;
  deadline_type: string;
  deadline_date: string | null;
  amount: number | null;
  offset_days: number | null;
  derived_from_id: string | null;
  date_overridden: boolean;
  is_completed: boolean;
  notes: string | null;
  source_document: string | null;
};

const FAMILY_LABEL: Record<string, string> = {
  listing: "Listing agreement",
  purchase: "Purchase agreement",
  lease: "Lease deal",
  other: "Other",
};

function fmt(d: string): string {
  const [y, m, day] = d.split("-");
  return `${Number(m)}/${Number(day)}/${y.slice(2)}`;
}

function when(d: string | null, today: string): { text: string; late: boolean } {
  if (!d) return { text: "Date not known", late: false };
  const n = daysBetween(today, d);
  if (n === 0) return { text: "Today", late: false };
  if (n === 1) return { text: "Tomorrow", late: false };
  if (n > 0) return { text: `In ${n} days`, late: false };
  return { text: n === -1 ? "Yesterday" : `${-n} days ago`, late: true };
}

export default async function DeadlinesSection({ projectId }: { projectId: string }) {
  const today = todayCentral();
  const [{ data: rows }, { data: types }, { data: rules }] = await Promise.all([
    supabase
      .from("project_deadlines")
      .select("id, display_code, deadline_type, deadline_date, amount, offset_days, derived_from_id, date_overridden, is_completed, notes, source_document")
      .eq("project_id", projectId)
      .order("deadline_date", { ascending: true, nullsFirst: false })
      .returns<DeadlineRow[]>(),
    supabase.from("deadline_types").select("code, label, family, derive_from, sort_order").order("sort_order").returns<TypeRow[]>(),
    supabase.from("deadline_warning_rules").select("type_key, lead_label").eq("source_kind", "project_deadline").returns<Rule[]>(),
  ]);

  const typeByCode = new Map((types ?? []).map((t) => [t.code, t]));
  const codeById = new Map((rows ?? []).map((r) => [r.id, r.display_code]));
  const leads = (code: string) =>
    (rules ?? []).filter((r) => r.type_key === code && r.lead_label !== "due").map((r) => r.lead_label);
  const open = (rows ?? []).filter((r) => !r.is_completed);
  const done = (rows ?? []).filter((r) => r.is_completed);
  // Anchors and hand-entered types only; derived types are created for you.
  const addable = (types ?? []).filter((t) => !t.derive_from);

  const cell = "py-2 pr-3 align-top";
  const input = "border border-gray-300 rounded px-3 py-2 w-full mt-1";
  const small = "text-xs text-gray-500";

  function Row({ r }: { r: DeadlineRow }) {
    const t = typeByCode.get(r.deadline_type);
    const w = when(r.deadline_date, today);
    const leadList = leads(r.deadline_type);
    return (
      <tr className={`border-b border-gray-100 ${r.is_completed ? "text-gray-400" : ""}`}>
        <td className={cell}>
          <div className="font-medium">{t?.label ?? r.deadline_type}</div>
          <div className={small}>
            {r.display_code}
            {r.derived_from_id && (
              <> · follows {codeById.get(r.derived_from_id) ?? "its anchor"}{r.date_overridden ? " (date set by hand)" : ""}</>
            )}
          </div>
        </td>
        <td className={cell}>
          <div>{r.deadline_date ? fmt(r.deadline_date) : "—"}</div>
          {!r.is_completed && (
            <div className={`text-xs ${w.late ? "text-red-600 font-medium" : "text-gray-500"}`}>{w.text}</div>
          )}
        </td>
        <td className={`${cell} text-gray-600`}>
          {r.amount != null && <div>${r.amount.toLocaleString()}</div>}
          {r.notes && <div className="text-xs">{r.notes}</div>}
          {r.source_document && <div className={small}>Source: {r.source_document}</div>}
          {!r.is_completed && leadList.length > 0 && <div className={small}>Warns {leadList.join(", ")} ahead</div>}
        </td>
        <td className={`${cell} whitespace-nowrap`}>
          <div className="flex flex-col gap-1 items-start">
            <form action={markDeadline}>
              <input type="hidden" name="id" value={r.id} />
              <input type="hidden" name="project_id" value={projectId} />
              <input type="hidden" name="done" value={r.is_completed ? "false" : "true"} />
              <button type="submit" className="text-xs text-blue-600 hover:underline">
                {r.is_completed ? "Reopen" : "Mark done"}
              </button>
            </form>
            {!r.is_completed && (
              <details>
                <summary className="text-xs text-blue-600 cursor-pointer">Change date</summary>
                <form action={redateDeadline} className="flex flex-col gap-1 mt-1">
                  <input type="hidden" name="id" value={r.id} />
                  <input type="hidden" name="project_id" value={projectId} />
                  <input type="date" name="deadline_date" defaultValue={r.deadline_date ?? ""} className="border border-gray-300 rounded px-2 py-1 text-xs" />
                  <button type="submit" className="text-xs bg-black text-white rounded px-2 py-1 w-fit">Save date</button>
                </form>
                {r.derived_from_id && r.offset_days == null && (
                  <form action={redateDeadline} className="flex gap-1 mt-1">
                    <input type="hidden" name="id" value={r.id} />
                    <input type="hidden" name="project_id" value={projectId} />
                    <input type="number" min="0" name="offset_days" placeholder="Days after" className="border border-gray-300 rounded px-2 py-1 text-xs w-24" />
                    <button type="submit" className="text-xs bg-black text-white rounded px-2 py-1">Set</button>
                  </form>
                )}
              </details>
            )}
            {!r.derived_from_id && (
              <form action={removeDeadline}>
                <input type="hidden" name="id" value={r.id} />
                <input type="hidden" name="project_id" value={projectId} />
                <button type="submit" className="text-xs text-red-600 hover:underline">Delete</button>
              </form>
            )}
          </div>
        </td>
      </tr>
    );
  }

  return (
    <section className="mb-10">
      <h2 className="text-lg font-semibold mb-1">Deadlines</h2>
      <p className="text-gray-500 mb-4 text-sm">
        The dates this deal&apos;s agreements run on. Each one reaches the Dashboard as a task on its
        warning dates, and never before. Entering a listing expiration adds the tail and the Existing
        Prospect List date; entering a purchase agreement&apos;s effective date adds the deposit.
      </p>

      <table className="w-full text-sm border-collapse mb-4">
        <thead>
          <tr className="text-left border-b border-gray-300">
            <th className="py-2 pr-3">Deadline</th>
            <th className="py-2 pr-3">Date</th>
            <th className="py-2 pr-3">Details</th>
            <th className="py-2 pr-3"></th>
          </tr>
        </thead>
        <tbody>
          {open.map((r) => <Row key={r.id} r={r} />)}
          {open.length === 0 && (
            <tr>
              <td colSpan={4} className="py-4 text-gray-400">
                No open deadlines. Add the listing or purchase agreement dates below.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {done.length > 0 && (
        <details className="mb-4">
          <summary className="text-sm text-gray-500 cursor-pointer">{done.length} done</summary>
          <table className="w-full text-sm border-collapse mt-2">
            <tbody>{done.map((r) => <Row key={r.id} r={r} />)}</tbody>
          </table>
        </details>
      )}

      <details className="border border-gray-200 rounded-lg p-4">
        <summary className="text-sm font-medium cursor-pointer">Add a deadline</summary>
        <form action={addDeadline} className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
          <input type="hidden" name="project_id" value={projectId} />
          <label className="text-sm sm:col-span-2">
            Deadline
            <select name="deadline_type" required defaultValue="" className={input}>
              <option value="" disabled>Choose…</option>
              {["listing", "purchase", "lease", "other"].map((fam) => (
                <optgroup key={fam} label={FAMILY_LABEL[fam]}>
                  {addable.filter((t) => t.family === fam).map((t) => (
                    <option key={t.code} value={t.code}>{t.label}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Date
            <input type="date" name="deadline_date" className={input} />
          </label>
          <label className="text-sm">
            Deposit due, days after effective date
            <input type="number" min="0" name="deposit_offset_days" placeholder="Purchase agreement only" className={input} />
          </label>
          <label className="text-sm">
            Amount
            <input type="number" step="0.01" name="amount" placeholder="Optional" className={input} />
          </label>
          <label className="text-sm">
            Source document
            <input name="source_document" placeholder="File name and section" className={input} />
          </label>
          <label className="text-sm sm:col-span-3">
            Notes
            <textarea name="notes" rows={1} className={input} />
          </label>
          <label className="text-sm flex items-center gap-2">
            <input type="checkbox" name="is_completed" /> Already passed and handled
          </label>
          <div className="sm:col-span-2 flex justify-end">
            <button type="submit" className="bg-black text-white rounded px-4 py-2">Add deadline</button>
          </div>
        </form>
      </details>
    </section>
  );
}
