"use client";

import Link from "next/link";
import { Fragment, useMemo, useState } from "react";
import { ActionForm } from "@/app/_components/ActionForm";
import {
  CAMPAIGN_STATUSES,
  PROSPECT_SOURCES,
  PROSPECT_STAGES,
  QUICK_LOG,
  type Campaign,
  type ProspectRow,
} from "@/lib/prospectChecklist";
import {
  quickLogProspectAction,
  setCampaignStatusAction,
  setProspectFieldAction,
} from "./actions";

// The Prospect Checklist table (11/18/2026). Sorting and filtering happen in
// the browser — a listing has tens of prospects, not thousands. Default order
// is first contact, oldest at the top, the same as the spreadsheet it
// replaces; the # column never changes, so "#19 talked" always means the same
// person.

type SortKey = "first_contact" | "last_action" | "stage" | "no";

const STAGE_ORDER = new Map<string, number>(PROSPECT_STAGES.map((s, i) => [s.value, i]));

function md(d: string | null): string {
  if (!d) return "—";
  const [y, m, dd] = d.split("-");
  return `${Number(m)}/${Number(dd)}/${y.slice(2)}`;
}

function AutoSelect({
  action,
  hidden,
  name,
  value,
  options,
  blank,
  className,
}: {
  action: (fd: FormData) => Promise<void>;
  hidden: Record<string, string>;
  name: string;
  value: string;
  options: readonly { value: string; label: string }[];
  blank: string;
  className?: string;
}) {
  return (
    <form action={action}>
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <select
        name={name}
        defaultValue={value}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className={className ?? "border border-gray-300 rounded px-1 py-0.5 text-xs bg-transparent"}
      >
        <option value="">{blank}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </form>
  );
}

function QuickLog({ projectId, row, onDone }: { projectId: string; row: ProspectRow; onDone: () => void }) {
  const [kind, setKind] = useState<string>("call");
  const input = "border border-gray-300 rounded px-2 py-1 text-sm bg-transparent";
  if (!row.contact_id) {
    return <p className="text-sm text-gray-500">No contact record on this row — log it from the deal page.</p>;
  }
  return (
    <ActionForm action={quickLogProspectAction} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="project_id" value={projectId} />
      <input type="hidden" name="contact_id" value={row.contact_id} />
      <input type="hidden" name="project_contact_id" value={row.project_contact_id} />
      <input type="hidden" name="name" value={row.name} />
      <input type="hidden" name="kind" value={kind} />
      <div className="flex gap-1" role="radiogroup" aria-label="What happened">
        {QUICK_LOG.map((q) => (
          <button
            key={q.key}
            type="button"
            role="radio"
            aria-checked={kind === q.key}
            onClick={() => setKind(q.key)}
            className={`px-2 py-1 rounded border text-xs ${
              kind === q.key ? "bg-blue-600 text-white border-blue-600" : "border-gray-300"
            }`}
          >
            {q.label}
          </button>
        ))}
      </div>
      <label className="text-xs text-gray-500 flex flex-col">
        Note
        <input name="note" className={`${input} w-80`} placeholder="e.g. wants a tour next week" />
      </label>
      <label className="text-xs text-gray-500 flex flex-col">
        Follow up on
        <input name="follow_up_date" type="date" className={input} />
      </label>
      <label className="text-xs text-gray-500 flex flex-col">
        Follow-up (optional)
        <input name="next_step" className={`${input} w-56`} placeholder={`Follow up with ${row.name}`} />
      </label>
      <button type="submit" className="px-3 py-1 rounded bg-blue-600 text-white text-sm">
        Save
      </button>
      <button type="button" onClick={onDone} className="px-2 py-1 text-sm text-gray-500 underline">
        Close
      </button>
    </ActionForm>
  );
}

export function ProspectTable({
  projectId,
  rows,
  campaigns,
  calledSince,
}: {
  projectId: string;
  rows: ProspectRow[];
  campaigns: Campaign[];
  calledSince: string | null;
}) {
  const [sort, setSort] = useState<SortKey>("first_contact");
  const [stage, setStage] = useState<string>("");
  const [hidePassed, setHidePassed] = useState(false);
  const [notCalled, setNotCalled] = useState(false);
  const [q, setQ] = useState("");
  const [openLog, setOpenLog] = useState<string | null>(null);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const out = rows.filter((r) => {
      if (stage === "_none" ? r.stage : stage && r.stage !== stage) return false;
      if (hidePassed && r.stage === "passed") return false;
      if (notCalled && r.called_on) return false;
      if (needle) {
        const hay = [r.name, r.company, r.email, r.phone, r.prospect_no?.toString()].join(" ").toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
    const byFirst = (a: ProspectRow, b: ProspectRow) =>
      (a.first_contact_date ?? "9999").localeCompare(b.first_contact_date ?? "9999") ||
      (a.prospect_no ?? 1e9) - (b.prospect_no ?? 1e9);
    out.sort((a, b) => {
      if (sort === "no") return (a.prospect_no ?? 1e9) - (b.prospect_no ?? 1e9);
      if (sort === "last_action")
        return (b.last_action_date ?? "").localeCompare(a.last_action_date ?? "") || byFirst(a, b);
      if (sort === "stage")
        return (STAGE_ORDER.get(b.stage ?? "") ?? -1) - (STAGE_ORDER.get(a.stage ?? "") ?? -1) || byFirst(a, b);
      return byFirst(a, b);
    });
    return out;
  }, [rows, sort, stage, hidePassed, notCalled, q]);

  const calledCount = rows.filter((r) => r.called_on).length;
  const ctl = "border border-gray-300 rounded px-2 py-1 text-sm bg-transparent";
  const th = "px-2 py-2 text-left font-medium whitespace-nowrap";
  const td = "px-2 py-1.5 align-top";
  const cols = 12 + campaigns.length;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-3 text-sm">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find # / name / company / phone" className={`${ctl} w-64`} />
        <label className="flex items-center gap-1">
          Sort
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className={ctl}>
            <option value="first_contact">First contact (oldest first)</option>
            <option value="last_action">Last action (newest first)</option>
            <option value="stage">Stage (furthest along first)</option>
            <option value="no">#</option>
          </select>
        </label>
        <label className="flex items-center gap-1">
          Stage
          <select value={stage} onChange={(e) => setStage(e.target.value)} className={ctl}>
            <option value="">All</option>
            {PROSPECT_STAGES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
            <option value="_none">(no stage)</option>
          </select>
        </label>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={notCalled} onChange={(e) => setNotCalled(e.target.checked)} />
          Not yet called{calledSince ? ` since ${md(calledSince)}` : ""}
        </label>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={hidePassed} onChange={(e) => setHidePassed(e.target.checked)} />
          Hide passed
        </label>
        <span className="text-gray-500">
          {shown.length} of {rows.length} shown · called {calledCount}, remaining {rows.length - calledCount}
        </span>
      </div>

      <div className="overflow-x-auto border border-gray-200 rounded-lg">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200">
            <tr>
              <th className={th}>#</th>
              <th className={th}>First contact</th>
              <th className={th}>Name</th>
              <th className={th}>Company / entity</th>
              <th className={th}>Email</th>
              <th className={th}>Phone</th>
              <th className={th}>Source</th>
              <th className={th}>Stage</th>
              <th className={th}>Last action</th>
              <th className={th} title={calledSince ? `Phone touch (call or text) on or after ${md(calledSince)}` : "Phone touch (call or text)"}>
                Called
              </th>
              <th className={th}>Open task</th>
              {campaigns.map((c) => (
                <th key={c.id} className={th} title={c.notes ?? undefined}>
                  {c.name}
                  {c.sent_on && <span className="block text-xs font-normal text-gray-500">{md(c.sent_on)}</span>}
                </th>
              ))}
              <th className={th}></th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const hidden = { project_id: projectId, project_contact_id: r.project_contact_id };
              return (
                <Fragment key={r.project_contact_id}>
                  <tr
                    className={`border-b border-gray-100 ${r.stage === "passed" ? "text-gray-400" : ""} ${
                      r.called_on ? "bg-green-50 dark:bg-green-950/30" : ""
                    }`}
                  >
                    <td className={`${td} font-semibold tabular-nums`}>{r.prospect_no ?? "—"}</td>
                    <td className={`${td} whitespace-nowrap tabular-nums`}>{md(r.first_contact_date)}</td>
                    <td className={`${td} whitespace-nowrap`}>
                      {r.contact_id ? (
                        <Link href={`/contacts/${r.contact_id}`} className="text-blue-600 underline">
                          {r.name}
                        </Link>
                      ) : (
                        r.name
                      )}
                      {r.needs_verification && (
                        <span title="Contact record needs verification" className="ml-1 text-amber-600">
                          ⚑
                        </span>
                      )}
                    </td>
                    <td className={`${td} max-w-[14rem]`}>
                      {r.entity_id ? (
                        <Link href={`/entities/${r.entity_id}`} className="text-blue-600 underline">
                          {r.company}
                        </Link>
                      ) : (
                        r.company ?? "—"
                      )}
                    </td>
                    <td className={`${td} whitespace-nowrap`}>
                      {r.email ? (
                        <a href={`mailto:${r.email}`} className="text-blue-600 underline">
                          {r.email}
                        </a>
                      ) : (
                        <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-xs">no email</span>
                      )}
                    </td>
                    <td className={`${td} whitespace-nowrap`}>
                      {r.phone ? (
                        <a href={`tel:${r.phone.replace(/[^\d+]/g, "")}`} className="text-blue-600 underline">
                          {r.phone}
                        </a>
                      ) : (
                        <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-800 text-xs">no phone</span>
                      )}
                    </td>
                    <td className={td}>
                      <AutoSelect
                        action={setProspectFieldAction}
                        hidden={{ ...hidden, field: "prospect_source" }}
                        name="value"
                        value={r.source ?? ""}
                        options={PROSPECT_SOURCES}
                        blank="—"
                      />
                    </td>
                    <td className={td}>
                      <AutoSelect
                        action={setProspectFieldAction}
                        hidden={{ ...hidden, field: "prospect_stage" }}
                        name="value"
                        value={r.stage ?? ""}
                        options={PROSPECT_STAGES}
                        blank="—"
                      />
                    </td>
                    <td className={`${td} min-w-[16rem] max-w-[24rem]`}>
                      {r.last_action_date ? (
                        <>
                          <span className="tabular-nums font-medium">{md(r.last_action_date)}</span>{" "}
                          <span className="text-gray-500">{r.last_action_type}</span>
                          {r.last_action_summary && (
                            <span className="block text-xs text-gray-600 line-clamp-2" title={r.last_action_summary}>
                              {r.last_action_summary}
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="text-gray-400">No activity logged</span>
                      )}
                    </td>
                    <td className={`${td} whitespace-nowrap tabular-nums`}>{r.called_on ? `✓ ${md(r.called_on)}` : "—"}</td>
                    <td className={`${td} min-w-[12rem] max-w-[18rem]`}>
                      {r.open_task ? (
                        <span className={r.open_task_overdue ? "text-red-600 font-medium" : ""}>
                          <span className="tabular-nums">{md(r.open_task.due_date)}</span>
                          {r.open_task_overdue && " overdue"}
                          <span className="block text-xs line-clamp-2" title={r.open_task.description}>
                            {r.open_task.description}
                          </span>
                        </span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    {campaigns.map((c) => (
                      <td key={c.id} className={td} title={r.campaigns[c.id]?.note ?? undefined}>
                        <AutoSelect
                          action={setCampaignStatusAction}
                          hidden={{ ...hidden, campaign_id: c.id }}
                          name="status"
                          value={r.campaigns[c.id]?.status ?? ""}
                          options={CAMPAIGN_STATUSES}
                          blank="—"
                          className={`border rounded px-1 py-0.5 text-xs bg-transparent ${
                            r.campaigns[c.id]?.status === "sent" || r.campaigns[c.id]?.status === "told_other"
                              ? "border-green-500"
                              : r.campaigns[c.id]
                              ? "border-amber-500"
                              : "border-gray-300"
                          }`}
                        />
                      </td>
                    ))}
                    <td className={td}>
                      <button
                        type="button"
                        onClick={() => setOpenLog(openLog === r.project_contact_id ? null : r.project_contact_id)}
                        className="px-2 py-0.5 rounded border border-blue-600 text-blue-700 text-xs whitespace-nowrap"
                      >
                        + Log
                      </button>
                    </td>
                  </tr>
                  {openLog === r.project_contact_id && (
                    <tr className="border-b border-gray-200 bg-blue-50/50 dark:bg-blue-950/30">
                      <td colSpan={cols} className="px-3 py-3">
                        <p className="text-xs text-gray-500 mb-2">
                          #{r.prospect_no} {r.name}
                          {r.phone ? ` · ${r.phone}` : ""}
                        </p>
                        <QuickLog projectId={projectId} row={r} onDone={() => setOpenLog(null)} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {shown.length === 0 && (
              <tr>
                <td colSpan={cols} className="px-3 py-6 text-center text-gray-500">
                  No prospects match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
