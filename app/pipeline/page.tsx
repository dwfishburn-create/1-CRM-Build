import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { todayCentral } from "@/lib/contactOptions";
import { feeBasisLabel, missingFields, pct, usd } from "@/lib/pipeline";

export const dynamic = "force-dynamic";

// Pipeline (Build #2, 10/10/2026). Active deals with gross, Dan's share and
// the probability-weighted share; Won deals' unpaid commission listed
// separately as receivables — owed money is not weighted (10/6/2026).
// Share = after deal-level splits, before CBRE's internal payout (9/26/2026).

type Deal = {
  id: string;
  project_code: string;
  project_type: string;
  client_name: string;
  fee_basis: string | null;
  deal_price: number | null;
  commission_rate: number | null;
  deal_value: number | null;
  dan_share_pct: number | null;
  dan_share_value: number | null;
  probability_pct: number | null;
  expected_share_value: number | null;
  target_close_date: string | null;
  pipeline_setup_at: string | null;
};

type Payment = {
  id: string;
  label: string;
  amount: number | null;
  earned_date: string | null;
  due_note: string | null;
  project: { id: string; project_code: string; dan_share_pct: number | null } | { id: string; project_code: string; dan_share_pct: number | null }[] | null;
};

function one<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  return Array.isArray(v) ? v[0] ?? null : v;
}

function daysSince(d: string, today: string): number {
  return Math.round((Date.parse(today) - Date.parse(d)) / 86400000);
}

const th = "py-2 pr-3 font-medium whitespace-nowrap";
const td = "py-2 pr-3 whitespace-nowrap";
const num = "py-2 pr-3 text-right tabular-nums whitespace-nowrap";

export default async function PipelinePage() {
  const today = todayCentral();
  const [{ data: deals, error }, { data: owed, error: owedErr }] = await Promise.all([
    supabase
      .from("projects")
      .select(
        "id, project_code, project_type, client_name, fee_basis, deal_price, commission_rate, deal_value, dan_share_pct, dan_share_value, probability_pct, expected_share_value, target_close_date, pipeline_setup_at"
      )
      .eq("status", "active")
      .eq("result", "active")
      .returns<Deal[]>(),
    supabase
      .from("commission_payments")
      .select("id, label, amount, earned_date, due_note, project:projects!project_id(id, project_code, dan_share_pct)")
      .is("received_date", null)
      .order("earned_date", { ascending: true, nullsFirst: false })
      .returns<Payment[]>(),
  ]);

  const rows = [...(deals ?? [])].sort(
    (a, b) =>
      (Number(b.expected_share_value) || 0) - (Number(a.expected_share_value) || 0) ||
      (Number(b.dan_share_value) || 0) - (Number(a.dan_share_value) || 0) ||
      (Number(b.deal_value) || 0) - (Number(a.deal_value) || 0) ||
      a.project_code.localeCompare(b.project_code)
  );

  const sum = (f: (d: Deal) => number | null) => rows.reduce((n, d) => n + (Number(f(d)) || 0), 0);
  const gross = sum((d) => d.deal_value);
  const share = sum((d) => d.dan_share_value);
  const expected = sum((d) => d.expected_share_value);
  const withShare = rows.filter((d) => d.dan_share_value != null).length;
  const withExpected = rows.filter((d) => d.expected_share_value != null).length;
  const notSetUp = rows.filter((d) => !d.pipeline_setup_at).length;

  const receivables = (owed ?? []).map((p) => {
    const proj = one(p.project);
    const yours = p.amount != null && proj?.dan_share_pct != null ? (p.amount * proj.dan_share_pct) / 100 : null;
    const isOwed = !!p.earned_date && p.earned_date <= today;
    return { ...p, proj, yours, isOwed };
  });
  const owedNow = receivables.filter((r) => r.isOwed);
  const later = receivables.filter((r) => !r.isOwed);

  const tile = "border border-gray-200 dark:border-neutral-800 rounded-lg p-4";
  const k = "text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400";

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <h1 className="text-2xl font-semibold mb-1">Pipeline</h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
        Active deals. Your share is after deal-level splits and before CBRE&apos;s payout; expected is
        your share × probability.
      </p>

      {(error || owedErr) && (
        <p className="mb-4 text-sm text-red-600">Couldn&apos;t load: {(error || owedErr)?.message}</p>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
        <div className={tile}>
          <div className={k}>Expected — your share</div>
          <div className="text-2xl font-semibold">{usd(expected)}</div>
          <div className="text-xs text-gray-500 dark:text-gray-400">{withExpected} of {rows.length} deals have share and probability</div>
        </div>
        <div className={tile}>
          <div className={k}>Your share, unweighted</div>
          <div className="text-2xl font-semibold">{usd(share)}</div>
          <div className="text-xs text-gray-500 dark:text-gray-400">{withShare} of {rows.length} deals have a share</div>
        </div>
        <div className={tile}>
          <div className={k}>Gross fees</div>
          <div className="text-2xl font-semibold">{usd(gross)}</div>
          <div className="text-xs text-gray-500 dark:text-gray-400">{rows.filter((d) => d.deal_value != null).length} of {rows.length} deals have a fee</div>
        </div>
        <div className={tile}>
          <div className={k}>Commission owed to you</div>
          <div className="text-2xl font-semibold">{usd(owedNow.reduce((n, r) => n + (r.yours ?? 0), 0))}</div>
          <div className="text-xs text-gray-500 dark:text-gray-400">
            {owedNow.length} payment{owedNow.length === 1 ? "" : "s"} earned, not received
          </div>
        </div>
      </div>

      {notSetUp > 0 && (
        <p className="mb-4 text-sm text-blue-700 dark:text-blue-300">
          {notSetUp} deal{notSetUp === 1 ? "" : "s"} not set up yet — open one and fill in the card at the top.
        </p>
      )}

      <div className="overflow-x-auto mb-10">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-left border-b border-gray-300 dark:border-neutral-700">
              <th className={th}>Deal</th>
              <th className={th}>Fee basis</th>
              <th className={`${th} text-right`}>Gross</th>
              <th className={`${th} text-right`}>Share</th>
              <th className={`${th} text-right`}>Your share</th>
              <th className={`${th} text-right`}>Prob.</th>
              <th className={`${th} text-right`}>Expected</th>
              <th className={th}>Close</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => {
              const missing = missingFields(d);
              return (
                <tr key={d.id} className="border-b border-gray-100 dark:border-neutral-800 align-top">
                  <td className="py-2 pr-3">
                    <Link href={`/projects/${d.id}`} className="text-blue-600 dark:text-blue-400 hover:underline">
                      {d.project_code}
                    </Link>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {d.client_name}
                      {!d.pipeline_setup_at ? (
                        <span className="ml-2 text-blue-700 dark:text-blue-300">· set up</span>
                      ) : missing.length > 0 ? (
                        <span className="ml-2 text-amber-700 dark:text-amber-400">· needs {missing.join(", ")}</span>
                      ) : null}
                    </div>
                  </td>
                  <td className={td}>{feeBasisLabel(d.fee_basis)}</td>
                  <td className={num}>{usd(d.deal_value)}</td>
                  <td className={num}>{pct(d.dan_share_pct)}</td>
                  <td className={num}>{usd(d.dan_share_value)}</td>
                  <td className={num}>{pct(d.probability_pct)}</td>
                  <td className={`${num} font-medium`}>{usd(d.expected_share_value)}</td>
                  <td className={td}>{d.target_close_date ?? "—"}</td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="py-4 text-gray-500">No active deals.</td>
              </tr>
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="border-t border-gray-300 dark:border-neutral-700 font-medium">
                <td className="py-2 pr-3">Total — {rows.length} deals</td>
                <td></td>
                <td className={num}>{usd(gross)}</td>
                <td></td>
                <td className={num}>{usd(share)}</td>
                <td></td>
                <td className={num}>{usd(expected)}</td>
                <td></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <h2 className="text-lg font-semibold mb-2">Receivables</h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
        Commission on deals already won — owed, so not weighted by probability.
      </p>
      {receivables.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">Nothing outstanding.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="text-left border-b border-gray-300 dark:border-neutral-700">
                <th className={th}>Deal</th>
                <th className={th}>Payment</th>
                <th className={`${th} text-right`}>Gross</th>
                <th className={`${th} text-right`}>Your share</th>
                <th className={th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {[...owedNow, ...later].map((r) => (
                <tr key={r.id} className="border-b border-gray-100 dark:border-neutral-800">
                  <td className={td}>
                    {r.proj ? (
                      <Link href={`/projects/${r.proj.id}`} className="text-blue-600 dark:text-blue-400 hover:underline">
                        {r.proj.project_code}
                      </Link>
                    ) : "—"}
                  </td>
                  <td className={td}>{r.label}</td>
                  <td className={num}>{usd(r.amount)}</td>
                  <td className={num}>{usd(r.yours)}</td>
                  <td className={td}>
                    {r.isOwed ? (
                      <span className="text-red-600 dark:text-red-400">
                        Owed since {r.earned_date} · {daysSince(r.earned_date!, today)} days
                      </span>
                    ) : (
                      <span className="text-gray-500 dark:text-gray-400">
                        {r.earned_date ? `Earned ${r.earned_date}` : r.due_note ?? "Not yet earned"}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
