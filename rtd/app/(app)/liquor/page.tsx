import Link from "next/link";
import {
  liquorMeta, liquorQuery, listOperators, parseLiquorParams, phone, SALE_TYPES, saleLabel, searchLicenses,
  type LiquorParams,
} from "@/lib/liquor";

// Liquor licenses (10/26/2026, migration 032): the Nebraska Liquor Control
// Commission roster as a prospect source — who holds a license where, which
// operators run several (the multi-unit restaurant / bar / c-store groups),
// and which licenses came onto or dropped off the roster between pulls.
// Public record, read-only here; Dan loads each new roster in the CRM.

const PAGE = 50;

export default async function LiquorPage({ searchParams }: PageProps<"/liquor">) {
  const p = parseLiquorParams(await searchParams);
  const meta = await liquorMeta();
  const latest = meta?.snapshots?.[0];
  const tab = (view: LiquorParams["view"], label: string) => (
    <Link
      href={`/liquor?${liquorQuery(p, { view, offset: 0 })}`}
      className={`btn btn-sm ${p.view === view ? "btn-primary" : "btn-outline"}`}
      aria-current={p.view === view ? "page" : undefined}
    >
      {label}
    </Link>
  );

  return (
    <>
      <header className="stack" style={{ gap: 6 }}>
        <div className="eyebrow">Nebraska Liquor Control Commission roster</div>
        <h1>Liquor licenses</h1>
        <p className="muted">
          {meta?.latest_snapshot_date
            ? <>As of the <b>{meta.latest_snapshot_date}</b> roster · {Number(meta.active).toLocaleString("en-US")} active Nebraska licenses.</>
            : <>No roster loaded yet.</>}{" "}
          Public record and unverified — the phone and email are what the licensee filed, not necessarily a decision maker&apos;s.
        </p>
      </header>

      <div className="row" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {tab("licenses", "Licenses")}
        {tab("operators", "Multi-unit operators")}
        {tab("new", "New on the roster")}
        {tab("dropped", "Dropped off")}
      </div>

      <form className="searchform" method="get" action="/liquor">
        {p.view !== "licenses" && <input type="hidden" name="view" value={p.view} />}
        <label className="field wide">
          {p.view === "operators" ? "Licensee or trade name" : "Name, licensee, manager or street"}
          <input name="q" defaultValue={p.q} placeholder="Applebee's, GIPH, Dodge St…" />
        </label>
        <label className="field">
          City
          <input name="city" defaultValue={p.city} placeholder="Omaha" />
        </label>
        <label className="field">
          County
          <select name="county" defaultValue={p.county}>
            <option value="">Any county</option>
            {(meta?.counties ?? []).map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        {(p.view === "licenses" || p.view === "operators") && (
          <label className="field">
            {p.view === "operators" ? "At least" : "Operator holds"}
            <select name="min_operator" defaultValue={p.minOp || (p.view === "operators" ? "2" : "")}>
              {p.view === "licenses" && <option value="">Any number</option>}
              <option value="2">2+ licenses</option>
              <option value="3">3+ licenses</option>
              <option value="5">5+ licenses</option>
              <option value="10">10+ licenses</option>
            </select>
          </label>
        )}
        {p.view === "licenses" && (
          <label className="field">
            Sort
            <select name="sort" defaultValue={p.sort}>
              <option value="name">Name</option>
              <option value="operator">Biggest operators first</option>
              <option value="city">City</option>
            </select>
          </label>
        )}
        <button className="btn btn-primary">Search</button>
        <fieldset className="row boxes">
          <legend>Type</legend>
          {SALE_TYPES.map((s) => (
            <label key={s.code} className="check" title={s.long}>
              <input type="checkbox" name="sale" value={s.code} defaultChecked={p.sale.includes(s.code)} /> {s.label}
            </label>
          ))}
        </fieldset>
      </form>

      {p.view === "new" && latest && !latest.baseline && (
        <p className="muted small">Licenses that were not on the earlier roster — openings, new owners, new concepts.</p>
      )}
      {p.view === "new" && (!latest || latest.baseline) && (
        <p className="muted small">Only one roster is loaded so far; &quot;new&quot; starts with the next pull.</p>
      )}
      {p.view === "dropped" && (
        <p className="muted small">On an earlier roster, gone from the latest — closed, sold or not renewed. Worth a look as a coming vacancy.</p>
      )}

      {p.view === "operators" ? <Operators p={p} /> : <Licenses p={p} />}
    </>
  );
}

function Pager({ p, shown, total }: { p: LiquorParams; shown: number; total: number }) {
  if (total <= shown && p.offset === 0) return null;
  return (
    <div className="pager">
      <span>Showing {(p.offset + 1).toLocaleString("en-US")}–{(p.offset + shown).toLocaleString("en-US")} of {total.toLocaleString("en-US")}</span>
      <span style={{ display: "flex", gap: 10 }}>
        {p.offset > 0 && <Link className="btn btn-outline" href={`/liquor?${liquorQuery(p, { offset: Math.max(0, p.offset - PAGE) })}`}>Previous</Link>}
        {p.offset + shown < total && <Link className="btn btn-outline" href={`/liquor?${liquorQuery(p, { offset: p.offset + PAGE })}`}>Next {PAGE}</Link>}
      </span>
    </div>
  );
}

function ExportLink({ p }: { p: LiquorParams }) {
  return (
    <a className="btn btn-outline" href={`/liquor-export?${liquorQuery(p, { offset: 0 })}`}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M12 3v12m0 0l-4-4m4 4l4-4M4 19h16" />
      </svg>
      Export to Excel
    </a>
  );
}

async function Licenses({ p }: { p: LiquorParams }) {
  const { rows, total, error } = await searchLicenses(p, PAGE);
  if (error) return <p className="error">Search failed: {error}</p>;
  return (
    <section className="stack">
      <div className="resultshead">
        <h2>{total === 0 ? "No licenses match" : `${total.toLocaleString("en-US")} ${total === 1 ? "license" : "licenses"}`}</h2>
        {total > 0 && <ExportLink p={p} />}
      </div>
      {total > 0 && (
        <>
          <div className="tablebox">
            <table>
              <thead>
                <tr>
                  <th scope="col">Trade name</th>
                  <th scope="col">Premises</th>
                  <th scope="col">Type</th>
                  <th scope="col">Licensee</th>
                  <th scope="col">Manager · contact</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((l) => (
                  <tr key={l.license_number}>
                    <td>
                      {l.brand_entity_id ? (
                        <Link className="name" href={`/brands/${l.brand_entity_id}`}>{l.trade_name}</Link>
                      ) : (
                        <b>{l.trade_name}</b>
                      )}
                      {l.brand_name && <div className="sub">Directory brand: {l.brand_name}</div>}
                      {l.status === "dropped" && <span className="pill pill-x">Dropped {l.dropped_on}</span>}
                      {p.view === "new" && l.first_seen_on && <span className="pill pill-new">New {l.first_seen_on}</span>}
                    </td>
                    <td>
                      {l.premises_street}
                      <div className="sub">{[l.premises_city, l.county && `${l.county} Co.`].filter(Boolean).join(" · ")}</div>
                    </td>
                    <td title={l.class_label ?? ""}>
                      {saleLabel(l.sale_type)}
                      <div className="sub">Class {l.class}</div>
                    </td>
                    <td>
                      {l.licensee}
                      {l.operator_licenses > 1 && <div className="sub">{l.operator_licenses} licenses statewide</div>}
                    </td>
                    <td>
                      {l.manager_name ?? <span className="sub">No manager listed</span>}
                      <div className="sub">{[phone(l.phone), l.email].filter(Boolean).join(" · ")}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager p={p} shown={rows.length} total={total} />
        </>
      )}
    </section>
  );
}

async function Operators({ p }: { p: LiquorParams }) {
  const { rows, total, error } = await listOperators(p, PAGE);
  if (error) return <p className="error">Search failed: {error}</p>;
  const area = !!(p.city || p.county || p.sale.length);
  return (
    <section className="stack">
      <div className="resultshead">
        <h2>{total === 0 ? "No operators match" : `${total.toLocaleString("en-US")} operators with ${p.minOp || 2}+ licenses`}</h2>
        {total > 0 && <ExportLink p={p} />}
      </div>
      {area && <p className="muted small">Counting licenses inside your filter; the statewide count is beside it.</p>}
      {total > 0 && (
        <>
          <div className="tablebox">
            <table>
              <thead>
                <tr>
                  <th scope="col">Licensee</th>
                  <th scope="col">Licenses</th>
                  <th scope="col">Trade names</th>
                  <th scope="col">Cities</th>
                  <th scope="col">Contact (most used)</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((o) => (
                  <tr key={o.operator_key}>
                    <td>
                      <b>{o.licensee}</b>
                      {o.brand_names && <div className="sub">Brand: {o.brand_names}</div>}
                      <div className="sub">{o.corporate_address}</div>
                      <Link className="small" href={`/liquor?${liquorQuery({ ...p, view: "licenses", q: o.licensee, minOp: "", offset: 0 })}`}>See its licenses</Link>
                    </td>
                    <td className="mono">{area ? `${o.in_area_count} here · ${o.license_count} total` : o.license_count}</td>
                    <td className="sub" style={{ maxWidth: 320 }}>{o.trade_names}</td>
                    <td className="sub" style={{ maxWidth: 260 }}>{o.cities}</td>
                    <td className="sub">{[phone(o.sample_phone), o.sample_email].filter(Boolean).join(" · ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager p={p} shown={rows.length} total={total} />
        </>
      )}
    </section>
  );
}
