import Link from "next/link";
import { getMe } from "@/lib/supabase";
import { MARKETS, marketLabel, sizeRange } from "@/lib/search";
import { budgetRange, CONFIDENCE, day, REQ_STATUS, todayCentral } from "@/lib/rtd";
import { listRequirements, overdue, parseReqParams, reqQuery, requirementTypes } from "@/lib/requirements";

const PAGE = 200;

export default async function Requirements({ searchParams }: PageProps<"/requirements">) {
  const p = parseReqParams(await searchParams);
  const [{ rows, error }, types, me] = await Promise.all([
    listRequirements(p, PAGE),
    requirementTypes(),
    getMe(),
  ]);
  const isAdmin = !!me?.is_admin;
  const total = rows[0]?.total_count ?? 0;
  const today = todayCentral();

  return (
    <>
      <header className="resultshead">
        <div className="stack" style={{ gap: 6 }}>
          <div className="eyebrow">Who&apos;s looking for space</div>
          <h1>Requirements</h1>
        </div>
        <Link className="btn btn-primary" href="/requirements/new">Add a requirement</Link>
      </header>

      <form className="searchform" method="get" action="/requirements">
        <label className="field wide">Company or location<input name="q" defaultValue={p.q} placeholder="Ace, Sarpy County…" /></label>
        <label className="field">Property type
          <select name="type" defaultValue={p.type}>
            <option value="">Any type</option>
            {types.property_types.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label className="field">Deal type
          <select name="deal" defaultValue={p.deal}>
            <option value="">Any deal</option>
            {types.deal_types.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label className="field">Market
          <select name="market" defaultValue={p.market}>
            <option value="">Any market</option>
            {MARKETS.map((m) => <option key={m.code} value={m.code}>{m.label}</option>)}
          </select>
        </label>
        <label className="field">Fits size (SF)<input name="size" inputMode="numeric" defaultValue={p.size ? p.size.toLocaleString("en-US") : ""} placeholder="2,400" /></label>
        <label className="field">Status
          <select name="status" defaultValue={p.status}>
            {Object.entries(REQ_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            <option value="all">Any status</option>
          </select>
        </label>
        <button className="btn btn-primary">Search</button>
      </form>

      <section className="stack">
        <div className="resultshead">
          <h2>{total === 0 ? "No requirements match" : `${total.toLocaleString("en-US")} ${total === 1 ? "requirement" : "requirements"}`}</h2>
          {total > 0 && (
            <a className="btn btn-outline" href={`/requirements-export?${reqQuery(p, { offset: 0 })}`}>Export to Excel</a>
          )}
        </div>
        {error && <p className="error">{error}</p>}
        {!error && total === 0 && (
          <div className="empty">Nothing here yet. Add what you hear about; Dan shares requirements from his CRM one at a time.</div>
        )}
        {total > 0 && (
          <div className="tablebox">
            <table>
              <thead>
                <tr>
                  <th scope="col">For</th>
                  <th scope="col">Looking for</th>
                  <th scope="col">Size (SF)</th>
                  <th scope="col">Where</th>
                  <th scope="col">Heard</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link className="name" href={`/requirements/${r.id}`}>{r.party}</Link>
                      <div className="sub">{r.rtd_only ? "New" : r.display_code}{r.added_by ? ` · added by ${r.added_by}` : " · from Dan's CRM"}</div>
                      {isAdmin && r.not_in_crm && <span className="pill pill-crm">Not in CRM</span>}
                    </td>
                    <td>
                      {[r.deal_type, r.property_type].filter(Boolean).join(" · ") || "—"}
                      {budgetRange(r.budget_min, r.budget_max) && <div className="sub">{budgetRange(r.budget_min, r.budget_max)}</div>}
                      {r.timeline && <div className="sub">{r.timeline}</div>}
                    </td>
                    <td className="mono">{sizeRange(r.size_min, r.size_max)}</td>
                    <td className="sub">
                      {[r.target_location, r.target_markets.length ? r.target_markets.map(marketLabel).join(", ") : null].filter(Boolean).join(" · ") || "Not set"}
                    </td>
                    <td className="sub">
                      {day(r.source_date) || "—"}
                      {r.confidence && <div>{CONFIDENCE[r.confidence]} confidence</div>}
                    </td>
                    <td>
                      <span className={r.status === "active" ? "pill pill-fit" : "pill pill-plain"}>{REQ_STATUS[r.status] ?? r.status}</span>
                      {overdue(r, today) && <div className="unverified">Re-confirm overdue</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {total > rows.length && (
          <div className="pager">
            <span>Showing {p.offset + 1}–{p.offset + rows.length} of {total}</span>
            <span style={{ display: "flex", gap: 10 }}>
              {p.offset > 0 && <Link className="btn btn-outline" href={`/requirements?${reqQuery(p, { offset: Math.max(0, p.offset - PAGE) })}`}>Previous</Link>}
              {p.offset + rows.length < total && <Link className="btn btn-outline" href={`/requirements?${reqQuery(p, { offset: p.offset + PAGE })}`}>Next {PAGE}</Link>}
            </span>
          </div>
        )}
      </section>
    </>
  );
}
