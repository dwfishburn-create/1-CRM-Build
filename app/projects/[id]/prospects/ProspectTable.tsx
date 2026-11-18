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
} from "@/lib/prospectChecklistShared";
import type { ProspectRow } from "@/lib/prospectChecklist";
import {
  quickLogProspectAction,
  setCampaignStatusAction,
  setSignedCaAction,
  setMilestoneAction,
  setProspectFieldAction,
} from "./actions";

// The Prospect Checklist table (11/18/2026). Sorting and filtering happen in
// the browser — a listing has tens of prospects, not thousands. Default order
// is first contact, oldest at the top, the same as the spreadsheet it
// replaces; the # column never changes, so "#19 talked" always means the same
// person.

// Teal = executed documents, the same as Dan's deal timelines.
const CA_TAG =
  "px-1.5 py-0.5 rounded text-xs font-medium whitespace-nowrap bg-teal-100 text-teal-800 border border-teal-300 dark:bg-teal-900/70 dark:text-teal-200 dark:border-teal-600";

// Purple = documents sent; coral = closing/target milestones (migration 041).
const PKG_TAG =
  "px-1.5 py-0.5 rounded text-xs font-medium whitespace-nowrap bg-purple-100 text-purple-800 border border-purple-300 dark:bg-purple-900/70 dark:text-purple-200 dark:border-purple-500";
const OFFER_TAG =
  "px-1.5 py-0.5 rounded text-xs font-medium whitespace-nowrap bg-orange-100 text-orange-800 border border-orange-300 dark:bg-orange-900/70 dark:text-orange-200 dark:border-orange-500";

type SortKey = "first_contact" | "last_action" | "stage" | "no" | "ca" | "package" | "offer";

// Milestone sorts: prospects that reached it first, newest date at the top,
// "sent but no date recorded" next, then everyone else by first contact.
function milestoneOf(r: ProspectRow, key: "ca" | "package" | "offer"): { has: boolean; on: string | null } {
  if (key === "ca") return { has: !!r.ca_signed_on, on: r.ca_signed_on };
  if (key === "package") return { has: r.package_sent, on: r.package_sent_on };
  return { has: r.offer_made, on: r.offer_made_on };
}

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
              kind === q.key ? "bg-blue-600 text-white border-blue-600" : "border-gray-300 dark:border-gray-500"
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

function MilestoneForm({ projectId, row, which }: { projectId: string; row: ProspectRow; which: "package" | "offer" }) {
  const isPkg = which === "package";
  const has = isPkg ? row.package_sent : row.offer_made;
  const on = isPkg ? row.package_sent_on : row.offer_made_on;
  const note = isPkg ? row.package_note : row.offer_note;
  const field = "border border-gray-300 rounded px-2 py-1 text-sm bg-transparent";
  return (
    <ActionForm action={setMilestoneAction} className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700 flex flex-wrap items-end gap-3">
      <input type="hidden" name="project_id" value={projectId} />
      <input type="hidden" name="project_contact_id" value={row.project_contact_id} />
      <input type="hidden" name="milestone" value={which} />
      <label className="text-sm flex items-center gap-1.5 self-center">
        <input type="checkbox" name="flag" defaultChecked={has} />
        <span className={isPkg ? PKG_TAG : OFFER_TAG}>{isPkg ? "Buyer package sent" : "Offer made"}</span>
      </label>
      <label className="text-xs text-gray-500 flex flex-col">
        {isPkg ? "Sent on (optional)" : "Latest offer on (optional)"}
        <input name="on" type="date" defaultValue={on ?? ""} className={field} />
      </label>
      <label className="text-xs text-gray-500 flex flex-col">
        {isPkg ? "Package note (optional)" : "Offer terms"}
        <input
          name="note"
          defaultValue={note ?? ""}
          className={`${field} w-96`}
          placeholder={isPkg ? "e.g. Dropbox link; 2026 YTD still owed" : "e.g. $500K cash, 30-day close, $50K EM"}
        />
      </label>
      <button
        type="submit"
        className={`px-3 py-1 rounded border text-sm ${
          isPkg
            ? "border-purple-600 text-purple-700 dark:border-purple-400 dark:text-purple-300"
            : "border-orange-600 text-orange-700 dark:border-orange-400 dark:text-orange-300"
        }`}
      >
        {isPkg ? "Save package" : "Save offer"}
      </button>
      <span className="text-xs text-gray-500">
        Uncheck and save to remove. Checking it moves an earlier stage to {isPkg ? "Package sent" : "Offer"}.
      </span>
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
  const [caOnly, setCaOnly] = useState(false);
  const [pkgOnly, setPkgOnly] = useState(false);
  const [offerOnly, setOfferOnly] = useState(false);
  const [q, setQ] = useState("");
  const [openLog, setOpenLog] = useState<string | null>(null);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const out = rows.filter((r) => {
      if (stage === "_none" ? r.stage : stage && r.stage !== stage) return false;
      if (hidePassed && r.stage === "passed") return false;
      if (notCalled && r.called_on) return false;
      if (caOnly && !r.ca_signed_on) return false;
      if (pkgOnly && !r.package_sent) return false;
      if (offerOnly && !r.offer_made) return false;
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
      if (sort === "ca" || sort === "package" || sort === "offer") {
        const ma = milestoneOf(a, sort);
        const mb = milestoneOf(b, sort);
        if (ma.has !== mb.has) return ma.has ? -1 : 1;
        if (ma.has) {
          if (!!ma.on !== !!mb.on) return ma.on ? -1 : 1;
          const c = (mb.on ?? "").localeCompare(ma.on ?? "");
          if (c) return c;
        }
        return byFirst(a, b);
      }
      if (sort === "no") return (a.prospect_no ?? 1e9) - (b.prospect_no ?? 1e9);
      if (sort === "last_action")
        return (b.last_action_date ?? "").localeCompare(a.last_action_date ?? "") || byFirst(a, b);
      if (sort === "stage")
        return (STAGE_ORDER.get(b.stage ?? "") ?? -1) - (STAGE_ORDER.get(a.stage ?? "") ?? -1) || byFirst(a, b);
      return byFirst(a, b);
    });
    return out;
  }, [rows, sort, stage, hidePassed, notCalled, caOnly, pkgOnly, offerOnly, q]);

  const calledCount = rows.filter((r) => r.called_on).length;
  const caCount = rows.filter((r) => r.ca_signed_on).length;
  const pkgCount = rows.filter((r) => r.package_sent).length;
  const offerCount = rows.filter((r) => r.offer_made).length;
  const ctl = "border border-gray-300 rounded px-2 py-1 text-sm bg-transparent";
  // Frozen header row (Dan, 11/18): the table scrolls inside its own box and
  // the header cells stick to its top. Each cell needs its own solid
  // background, or rows show through while scrolling.
  const th =
    "px-2 py-2 text-left font-medium whitespace-nowrap sticky top-0 z-10 bg-gray-50 dark:bg-gray-800 shadow-[inset_0_-1px_0_rgba(0,0,0,0.15)] dark:shadow-[inset_0_-1px_0_rgba(255,255,255,0.15)]";
  const td = "px-2 py-1.5 align-top";
  const cols = 12 + campaigns.length;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-3 text-sm">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find ID # / name / company / phone" className={`${ctl} w-64`} />
        <label className="flex items-center gap-1">
          Sort
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className={ctl}>
            <option value="first_contact">First contact (oldest first)</option>
            <option value="last_action">Last action (newest first)</option>
            <option value="stage">Stage (furthest along first)</option>
            <option value="ca">Signed CA (newest first)</option>
            <option value="package">Buyer package sent (newest first)</option>
            <option value="offer">Offer made (newest first)</option>
            <option value="no">ID #</option>
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
          <input type="checkbox" checked={caOnly} onChange={(e) => setCaOnly(e.target.checked)} />
          Signed CA only ({caCount})
        </label>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={pkgOnly} onChange={(e) => setPkgOnly(e.target.checked)} />
          Package sent only ({pkgCount})
        </label>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={offerOnly} onChange={(e) => setOfferOnly(e.target.checked)} />
          Offer made only ({offerCount})
        </label>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={hidePassed} onChange={(e) => setHidePassed(e.target.checked)} />
          Hide passed
        </label>
        <span className="text-gray-500">
          {shown.length} of {rows.length} shown · called {calledCount}, remaining {rows.length - calledCount}
        </span>
      </div>

      <div className="mb-3 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-xs">
        <p className="mb-1.5">
          <span className="font-semibold">ID #</span> is permanent for this listing — it never changes or gets reused, so
          you can say “#19 talked, wants tour” in chat and it updates the right record.
        </p>
        <p className="font-semibold mb-1.5">Color key</p>
        <ul className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-4">
          <li className="flex items-center gap-2">
            <span className="inline-block w-5 h-4 rounded-sm bg-green-50 dark:bg-emerald-900/45 border-l-4 border-l-green-500 dark:border-l-emerald-400" />
            Green row = called or texted{calledSince ? ` since ${md(calledSince)}` : ""}
          </li>
          <li className="flex items-center gap-2">
            <span className="inline-block w-5 h-4 rounded-sm border border-gray-400 opacity-50 bg-gray-300 dark:bg-gray-600" />
            Faded row = passed
          </li>
          <li className="flex items-center gap-2">
            <span className="font-medium text-red-600 dark:text-red-400 tabular-nums">11/20/26 overdue</span>
            = follow-up past due
          </li>
          <li className="flex items-center gap-2">
            <span className={CA_TAG}>CA ✓ 11/13/26</span>
            = signed confidentiality agreement received
          </li>
          <li className="flex items-center gap-2">
            <span className={PKG_TAG}>Pkg ✓ 11/14/26</span>
            = buyer package sent (no date = sent, date not recorded)
          </li>
          <li className="flex items-center gap-2">
            <span className={OFFER_TAG}>Offer 11/16/26</span>
            = offer made (latest; hover for terms)
          </li>
          <li className="flex items-center gap-2">
            <span className="text-amber-600 dark:text-amber-400">⚑</span>
            = contact record needs checking
          </li>
          <li className="flex items-center gap-2">
            <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-900/70 dark:text-amber-200">no email</span>
            = no email on file
          </li>
          <li className="flex items-center gap-2">
            <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-800 dark:bg-red-900/70 dark:text-red-200">no phone</span>
            = no phone on file
          </li>
          {campaigns.length > 0 && (
            <>
              <li className="flex items-center gap-2">
                <span className="inline-block px-1.5 rounded border-2 border-green-500 bg-white text-gray-900">Sent</span>
                = got the campaign (sent, or told another way)
              </li>
              <li className="flex items-center gap-2">
                <span className="inline-block px-1.5 rounded border-2 border-amber-500 bg-white text-gray-900">Not sent</span>
                = didn&apos;t get it (not sent or bounced); gray box = no flag yet
              </li>
            </>
          )}
        </ul>
      </div>
      <div className="overflow-auto max-h-[calc(100vh-9rem)] border border-gray-200 dark:border-gray-700 rounded-lg">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-600">
            <tr>
              <th className={th} title="Permanent ID for this listing — never changes or gets reused. Use it in chat: “#19 talked, wants tour.”">
                ID #
              </th>
              <th className={th}>First contact</th>
              <th className={th}>Name</th>
              <th className={th}>Company / entity</th>
              <th className={th}>Email</th>
              <th className={th}>Phone</th>
              <th className={th}>Source</th>
              <th className={th} title="Stage, plus milestone tags: CA signed (teal), buyer package sent (purple), offer made (coral)">Stage / milestones</th>
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
                    className={`border-b border-gray-200 dark:border-gray-700 border-l-4 ${
                      r.called_on
                        ? "bg-green-50 dark:bg-emerald-900/45 border-l-green-500 dark:border-l-emerald-400"
                        : "border-l-transparent"
                    } ${r.stage === "passed" ? "opacity-50" : ""}`}
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
                        <span title="Contact record needs verification" className="ml-1 text-amber-600 dark:text-amber-400">
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
                        <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-900/70 dark:text-amber-200 text-xs">no email</span>
                      )}
                    </td>
                    <td className={`${td} whitespace-nowrap`}>
                      {r.phone ? (
                        <a href={`tel:${r.phone.replace(/[^\d+]/g, "")}`} className="text-blue-600 underline">
                          {r.phone}
                        </a>
                      ) : (
                        <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-800 dark:bg-red-900/70 dark:text-red-200 text-xs">no phone</span>
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
                      {(r.ca_signed_on || r.package_sent || r.offer_made) && (
                        <div className="mt-1 flex flex-col items-start gap-1">
                          {r.ca_signed_on && (
                            <span className={`${CA_TAG}`} title={`Signed CA received ${md(r.ca_signed_on)}${r.ca_note ? ` — ${r.ca_note}` : ""}`}>
                              CA ✓ {md(r.ca_signed_on)}
                            </span>
                          )}
                          {r.package_sent && (
                            <span
                              className={`${PKG_TAG}`}
                              title={`Buyer package sent${r.package_sent_on ? ` ${md(r.package_sent_on)}` : " (date not recorded)"}${r.package_note ? ` — ${r.package_note}` : ""}`}
                            >
                              Pkg ✓{r.package_sent_on ? ` ${md(r.package_sent_on)}` : ""}
                            </span>
                          )}
                          {r.offer_made && (
                            <span
                              className={`${OFFER_TAG}`}
                              title={`Offer made${r.offer_made_on ? ` ${md(r.offer_made_on)}` : " (date not recorded)"}${r.offer_note ? ` — ${r.offer_note}` : ""}`}
                            >
                              Offer{r.offer_made_on ? ` ${md(r.offer_made_on)}` : ""}
                            </span>
                          )}
                        </div>
                      )}
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
                    <td className={`${td} whitespace-nowrap tabular-nums`}>
                      {r.called_on ? (
                        <span className="font-medium text-green-700 dark:text-emerald-300">✓ {md(r.called_on)}</span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className={`${td} min-w-[12rem] max-w-[18rem]`}>
                      {r.open_task ? (
                        <span className={r.open_task_overdue ? "text-red-600 dark:text-red-400 font-medium" : ""}>
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
                        className="px-2 py-0.5 rounded border border-blue-600 dark:border-blue-400 text-blue-700 text-xs whitespace-nowrap"
                      >
                        + Log
                      </button>
                    </td>
                  </tr>
                  {openLog === r.project_contact_id && (
                    <tr className="border-b border-gray-200 dark:border-gray-700 bg-blue-50/50 dark:bg-blue-950/60">
                      <td colSpan={cols} className="px-3 py-3">
                        <p className="text-xs text-gray-500 mb-2">
                          #{r.prospect_no} {r.name}
                          {r.phone ? ` · ${r.phone}` : ""}
                        </p>
                        <QuickLog projectId={projectId} row={r} onDone={() => setOpenLog(null)} />
                        <ActionForm action={setSignedCaAction} className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700 flex flex-wrap items-end gap-3">
                          <input type="hidden" name="project_id" value={projectId} />
                          <input type="hidden" name="project_contact_id" value={r.project_contact_id} />
                          <label className="text-xs text-gray-500 flex flex-col">
                            Signed CA received on
                            <input name="ca_signed_on" type="date" defaultValue={r.ca_signed_on ?? ""} className="border border-gray-300 rounded px-2 py-1 text-sm" />
                          </label>
                          <label className="text-xs text-gray-500 flex flex-col">
                            CA note (optional)
                            <input name="ca_note" defaultValue={r.ca_note ?? ""} className="border border-gray-300 rounded px-2 py-1 text-sm w-96" placeholder="e.g. broker block only; buyer not named" />
                          </label>
                          <button type="submit" className="px-3 py-1 rounded border border-teal-600 text-teal-700 dark:border-teal-400 dark:text-teal-300 text-sm">
                            Save CA
                          </button>
                          <span className="text-xs text-gray-500">Clear the date and save to remove it. Saving a date moves an earlier stage to CA signed.</span>
                        </ActionForm>
                        <MilestoneForm projectId={projectId} row={r} which="package" />
                        <MilestoneForm projectId={projectId} row={r} which="offer" />
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
