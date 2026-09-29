"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  bumpTaskFromDashboard,
  completeTaskFromDashboard,
  redateTaskFromDashboard,
  retirePreview,
} from "./actions";
import { completeDeadlineAction, completeLeaseEventAction } from "./lease-event-actions";

export type DashTask = {
  id: string;
  code: string;
  title: string;
  description: string;
  due: string;
  category: string;
};
export type DashRow = {
  key: string;
  title: string;
  count: number;
  context: string;
  href: string | null;
  due: string;
  late: boolean;
  last: string | null;
  tasks: DashTask[];
};
export type WaitingRow = {
  id: string;
  who: string;
  whoHref: string;
  what: string;
  context: string;
  since: string;
  late: boolean;
};
export type PreviewData = {
  weekStart: string;
  rangeLabel: string;
  headline: string[];
  more: number;
  total: number;
  days: { label: string; items: { text: string; flag: string }[] }[];
};
export type AheadData = {
  months: { label: string; items: { date: string; text: string; kind: string }[] }[];
  pastDue: { id: string; kind: "lease" | "deadline"; date: string; text: string }[];
};

const label = "text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400";
const btn =
  "inline-flex items-center justify-center min-h-11 px-4 rounded-lg text-sm border border-gray-300 dark:border-neutral-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-neutral-800";
const btnSolid =
  "inline-flex items-center justify-center min-h-11 px-4 rounded-lg text-sm font-medium bg-gray-900 text-white hover:bg-gray-700 dark:bg-neutral-700 dark:hover:bg-neutral-600";

// The full Preview opens on its own at most twice a day — the first visit in
// the morning and the first after 1 pm — until retired. Tracked per browser.
function previewSlotKey(weekStart: string): string {
  const now = new Date();
  const day = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
  return `crm-preview-shown:${weekStart}:${day}:${now.getHours() < 13 ? "am" : "pm"}`;
}

function Row({ row, dim }: { row: DashRow; dim?: boolean }) {
  const [open, setOpen] = useState(false);
  const dot = row.late ? "bg-red-500" : dim ? "bg-gray-400 dark:bg-neutral-600" : "bg-blue-500";
  return (
    <div className="border border-gray-200 dark:border-neutral-800 rounded-xl bg-white dark:bg-neutral-900">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="w-full text-left px-5 min-h-14 py-3 flex items-center gap-4"
      >
        <span className={`w-2 h-2 rounded-full shrink-0 ${dot}`} />
        <span className="flex-1 min-w-0">
          <span className="block text-[15px] font-medium text-gray-900 dark:text-gray-100">
            {row.title}
            {row.count > 1 && (
              <span className="ml-2 text-xs font-normal text-gray-500 dark:text-gray-400">{row.count} items</span>
            )}
          </span>
          <span className="block md:hidden text-xs text-gray-500 dark:text-gray-400 truncate">{row.context}</span>
        </span>
        <span className="hidden md:block w-72 shrink-0 truncate text-sm text-gray-500 dark:text-gray-400">
          {row.context}
        </span>
        <span
          className={`w-28 shrink-0 text-right text-sm font-medium ${
            row.late ? "text-red-600 dark:text-red-400" : "text-gray-700 dark:text-gray-300"
          }`}
        >
          {row.due}
        </span>
      </button>
      {open && (
        <div className="border-t border-gray-100 dark:border-neutral-800 px-5 pb-5 md:pl-11 flex flex-col gap-5">
          {row.tasks.map((t) => (
            <div key={t.id} className="pt-4 flex flex-col gap-3">
              {row.tasks.length > 1 && (
                <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                  {t.title} <span className="font-normal text-gray-500 dark:text-gray-400">· {t.due}</span>
                </div>
              )}
              <p className="text-sm leading-relaxed text-gray-700 dark:text-gray-300">{t.description}</p>
              <div className="flex flex-wrap items-center gap-2">
                <form action={completeTaskFromDashboard}>
                  <input type="hidden" name="id" value={t.id} />
                  <button type="submit" className={btnSolid}>Mark done</button>
                </form>
                <form action={bumpTaskFromDashboard}>
                  <input type="hidden" name="id" value={t.id} />
                  <input type="hidden" name="days" value="1" />
                  <button type="submit" className={btn}>Tomorrow</button>
                </form>
                <form action={bumpTaskFromDashboard}>
                  <input type="hidden" name="id" value={t.id} />
                  <input type="hidden" name="days" value="7" />
                  <button type="submit" className={btn}>+1 week</button>
                </form>
                <form action={redateTaskFromDashboard} className="flex items-center gap-2">
                  <input type="hidden" name="id" value={t.id} />
                  <label className="sr-only" htmlFor={`due-${t.id}`}>New date</label>
                  <input
                    id={`due-${t.id}`}
                    type="date"
                    name="due_date"
                    required
                    className="min-h-11 rounded-lg border border-gray-300 px-3 text-sm"
                  />
                  <button type="submit" className={btn}>Re-date</button>
                </form>
                <span className="text-xs text-gray-400 dark:text-gray-500">{[t.code, t.category].filter(Boolean).join(" · ")}</span>
              </div>
            </div>
          ))}
          {row.last && (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              <span className="font-medium text-gray-600 dark:text-gray-300">Last activity · </span>
              {row.last}
            </p>
          )}
          {row.href && (
            <Link href={row.href} className="text-sm text-blue-600 dark:text-blue-400 hover:underline self-start min-h-11 inline-flex items-center">
              Open the record to log activity →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

export default function DashboardView(props: {
  dateLabel: string;
  summary: string;
  error: string | null;
  deals: DashRow[];
  prospects: DashRow[];
  waiting: WaitingRow[];
  preview: PreviewData | null;
  ahead: AheadData;
}) {
  const { preview } = props;
  const [showFull, setShowFull] = useState(false);
  const [showProspects, setShowProspects] = useState(false);
  const [showAhead, setShowAhead] = useState(false);

  useEffect(() => {
    if (!preview || preview.total === 0) return;
    const key = previewSlotKey(preview.weekStart);
    // Deferred so the check-and-mark happens once even when React runs the
    // effect twice in development (the first run's timer is cleared).
    const timer = window.setTimeout(() => {
      try {
        if (!window.localStorage.getItem(key)) {
          window.localStorage.setItem(key, "1");
          setShowFull(true);
        }
      } catch {
        /* storage unavailable: the strip still shows */
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [preview]);

  const pc = props.prospects.length;

  return (
    <div className="max-w-5xl w-full mx-auto px-6 md:px-8 py-10 flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-semibold text-gray-900 dark:text-gray-100">{props.dateLabel}</h1>
          <p className="text-[15px] text-gray-500 dark:text-gray-400">{props.summary}</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => setShowAhead(!showAhead)} aria-expanded={showAhead} className={btn}>
            {showAhead ? "Close looking ahead" : "Looking ahead"}
          </button>
          <Link href="/tasks" className={btn}>All tasks</Link>
        </div>
      </div>

      {props.error && <p className="text-red-600">Error loading tasks: {props.error}</p>}

      {showAhead && (
        <section className="rounded-xl border border-gray-200 dark:border-neutral-800 bg-gray-50 dark:bg-neutral-900 p-6 flex flex-col gap-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Looking ahead</h2>
            <span className="text-sm text-gray-500 dark:text-gray-400">Everything after today, the next six months. Never on the daily screen.</span>
          </div>
          {props.ahead.pastDue.length > 0 && (
            <div className="flex flex-col gap-2">
              <div className={label}>Past dates not yet marked done</div>
              {props.ahead.pastDue.map((e) => (
                <div key={e.id} className="flex items-center gap-4 text-sm border-b border-gray-200 dark:border-neutral-800 py-1">
                  <span className="w-20 shrink-0 font-mono text-gray-500 dark:text-gray-400">{e.date}</span>
                  <span className="flex-1 min-w-0 text-gray-800 dark:text-gray-200">{e.text}</span>
                  <form action={e.kind === "deadline" ? completeDeadlineAction : completeLeaseEventAction}>
                    <input type="hidden" name="id" value={e.id} />
                    <button type="submit" className={btn}>Mark done</button>
                  </form>
                </div>
              ))}
            </div>
          )}
          {props.ahead.months.map((m) => (
            <div key={m.label} className="flex flex-col gap-1">
              <div className={label}>{m.label}</div>
              {m.items.map((it, i) => (
                <div key={i} className="flex items-baseline gap-4 text-sm border-b border-gray-200 dark:border-neutral-800 py-2">
                  <span className="w-12 shrink-0 font-mono text-gray-500 dark:text-gray-400">{it.date}</span>
                  <span className="flex-1 min-w-0 text-gray-800 dark:text-gray-200">{it.text}</span>
                  <span className="hidden sm:block w-40 shrink-0 text-right text-gray-500 dark:text-gray-400">{it.kind}</span>
                </div>
              ))}
            </div>
          ))}
          {props.ahead.months.length === 0 && props.ahead.pastDue.length === 0 && (
            <p className="text-sm text-gray-500">Nothing scheduled.</p>
          )}
        </section>
      )}

      {preview && preview.total > 0 && (
        <section className="rounded-xl border border-blue-200 bg-blue-50 dark:border-[#2f3a52] dark:bg-[#1a1d24] px-5 py-4 flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-4 min-w-0 flex-1">
              <span className="text-xs font-semibold uppercase tracking-wider text-blue-700 dark:text-blue-300 shrink-0">
                Next week
              </span>
              <span className="text-sm text-gray-700 dark:text-gray-300 truncate">
                {preview.headline.join("   ·   ")}
                {preview.more > 0 && `   ·   +${preview.more} more`}
              </span>
            </div>
            <div className="flex gap-2 shrink-0">
              <button type="button" onClick={() => setShowFull(!showFull)} aria-expanded={showFull} className={btn}>
                {showFull ? "Hide" : "See full preview"}
              </button>
              <button type="button" onClick={() => setShowFull(false)} className={btn}>Later</button>
              <form action={retirePreview}>
                <input type="hidden" name="week_start" value={preview.weekStart} />
                <button type="submit" className="inline-flex items-center justify-center min-h-11 px-4 rounded-lg text-sm font-medium bg-blue-700 text-white hover:bg-blue-800">
                  Got it
                </button>
              </form>
            </div>
          </div>
          {showFull && (
            <div className="border-t border-blue-200 dark:border-[#2a3244] pt-3 flex flex-col gap-3">
              <div className="text-sm text-gray-500 dark:text-gray-400">{preview.rangeLabel}</div>
              <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
                {preview.days.map((d) => (
                  <div key={d.label} className="flex flex-col gap-2">
                    <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{d.label}</div>
                    {d.items.map((it, i) => (
                      <div key={i} className="rounded-lg bg-white dark:bg-[#20242d] px-3 py-2 text-[13px] leading-snug text-gray-700 dark:text-gray-300 flex flex-col gap-1">
                        <span>{it.text}</span>
                        {it.flag && (
                          <span className="text-[11px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">{it.flag}</span>
                        )}
                      </div>
                    ))}
                    {d.items.length === 0 && <div className="text-[13px] text-gray-400 dark:text-gray-500">Nothing scheduled</div>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className={label}>Your move — deals</h2>
        {props.deals.map((r) => (
          <Row key={r.key} row={r} />
        ))}
        {props.deals.length === 0 && <p className="text-sm text-gray-500 dark:text-gray-400">Nothing due on your deals today.</p>}
      </section>

      <section className="flex flex-col gap-3">
        <button
          type="button"
          onClick={() => setShowProspects(!showProspects)}
          disabled={pc === 0}
          aria-expanded={showProspects}
          className="self-start min-h-11 flex items-center gap-3 text-left"
        >
          <span className={label}>Your move — prospecting</span>
          <span className="text-sm text-gray-500 dark:text-gray-400">
            {pc === 0 ? "Nothing today" : showProspects ? "Hide ▴" : `${pc} today — show ▾`}
          </span>
        </button>
        {showProspects && props.prospects.map((r) => <Row key={r.key} row={r} dim />)}
      </section>

      <section className="flex flex-col gap-1">
        <h2 className={`${label} mb-2`}>Waiting on</h2>
        {props.waiting.map((w) => (
          <div key={w.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 min-h-12 py-2 border-b border-gray-100 dark:border-neutral-800 md:pl-6">
            <span className="flex-1 min-w-0 text-[15px] text-gray-900 dark:text-gray-100">
              <Link href={w.whoHref} className="hover:underline">{w.who}</Link>
              <span className="text-gray-500 dark:text-gray-400"> — {w.what}</span>
            </span>
            <span className="hidden md:block w-72 shrink-0 truncate text-sm text-gray-500 dark:text-gray-400">{w.context}</span>
            <span className={`text-sm ${w.late ? "text-red-600 dark:text-red-400" : "text-gray-500 dark:text-gray-400"}`}>{w.since}</span>
          </div>
        ))}
        {props.waiting.length === 0 && <p className="text-sm text-gray-500 dark:text-gray-400">Not waiting on anyone.</p>}
      </section>
    </div>
  );
}
