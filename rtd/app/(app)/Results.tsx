import Link from "next/link";
import { freshness, marketLabel, sizeRange, toQuery, type BrandRow, type SearchParams } from "@/lib/search";
import type { Claim } from "@/lib/rtd";

const PAGE = 100;

function Fit({ r }: { r: BrandRow }) {
  if (r.fit === "fits") return <span className="pill pill-fit">Fits</span>;
  if (r.fit === "close") {
    const d = r.fit_delta_pct ?? 0;
    return <span className="pill pill-close">Close ({d > 0 ? "+" : "−"}{Math.abs(d)}%)</span>;
  }
  if (r.fit === "unknown") return <span className="pill pill-plain">Size not on file</span>;
  return null;
}

export function isNewer(at: string | null | undefined, since: string | null | undefined): boolean {
  if (!at || !since) return false;
  return new Date(at).getTime() > new Date(since).getTime();
}

export function Results({ rows, params, basePath, showFit, claims, newSince = null }: {
  rows: BrandRow[]; params: SearchParams; basePath: string; showFit: boolean; claims: Map<string, Claim>;
  newSince?: string | null;   // a saved search: mark brands changed since this person last looked
}) {
  const excluded = rows[0]?.excluded_count ?? 0;
  const total = rows[0]?.total_count ?? 0;
  const fits = rows.filter((r) => r.fit === "fits").length;
  const close = rows.filter((r) => r.fit === "close").length;
  const unsized = rows.filter((r) => r.fit === "unknown").length;
  const exportHref = `/export?${toQuery(params, { offset: 0 })}`;
  const from = params.offset + 1;
  const to = params.offset + rows.length;

  return (
    <section className="stack">
      <div className="resultshead">
        <h2>
          {total === 0
            ? "No brands match"
            : showFit && params.offset === 0 && total <= PAGE
              ? `${fits} ${fits === 1 ? "brand fits" : "brands fit"}${close ? ` · ${close} close` : ""}${unsized ? ` · ${unsized} size not on file` : ""}`
              : `${total.toLocaleString("en-US")} ${total === 1 ? "brand" : "brands"}`}
        </h2>
        {total > 0 && (
          <a className="btn btn-outline" href={exportHref}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M12 3v12m0 0l-4-4m4 4l4-4M4 19h16" />
            </svg>
            Export to Excel
          </a>
        )}
      </div>

      {excluded > 0 && (
        <p className="muted small">
          {excluded.toLocaleString("en-US")} {excluded === 1 ? "brand" : "brands"} left out by the exclusives ·{" "}
          <Link href={`${basePath}?${toQuery(params, { offset: 0, showExcluded: !params.showExcluded })}`}>
            {params.showExcluded ? "Hide them" : "Show them, marked"}
          </Link>
        </p>
      )}

      {total === 0 ? (
        <div className="empty">Nothing matches. Try a wider size, another category, or include close fits.</div>
      ) : (
        <>
          <div className="tablebox">
            <table>
              <thead>
                <tr>
                  <th scope="col">Brand</th>
                  <th scope="col">Size range (SF)</th>
                  {showFit && <th scope="col">Fit</th>}
                  <th scope="col">Contact</th>
                  <th scope="col">Last confirmed</th>
                  <th scope="col">Markets</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.entity_id} className={r.excluded_by ? "excluded" : undefined}>
                    <td>
                      <Link className="name" href={`/brands/${r.entity_id}`}>{r.name}</Link>
                      {isNewer(r.changed_at, newSince) && <span className="pill pill-new">New</span>}
                      {r.excluded_by && <span className="pill pill-x">Excluded — {r.excluded_by}</span>}
                      <div className="sub">{r.category_label ?? "No category"}</div>
                      {claims.has(r.entity_id) && (
                        <span className="pill pill-claim">Client — {claims.get(r.entity_id)!.holder_is_me ? "you" : claims.get(r.entity_id)!.holder}</span>
                      )}
                    </td>
                    <td className="mono">{sizeRange(r.size_min_sf, r.size_max_sf)}</td>
                    {showFit && <td><Fit r={r} /></td>}
                    <td>
                      {r.contact_name ?? <span className="sub">None on file</span>}
                      {r.contact_name && r.contact_title && <div className="sub">{r.contact_title}</div>}
                      {r.contact_count > 1 && <div className="sub">+{r.contact_count - 1} more</div>}
                    </td>
                    <td>
                      <span className={r.needs_verification ? "unverified" : "verified"}>
                        {freshness(r.needs_verification, r.last_verified_on)}
                      </span>
                    </td>
                    <td className="sub">{r.market_set ? r.target_markets.map(marketLabel).join(", ") : "Not set"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {total > rows.length && (
            <div className="pager">
              <span>Showing {from.toLocaleString("en-US")}–{to.toLocaleString("en-US")} of {total.toLocaleString("en-US")}</span>
              <span style={{ display: "flex", gap: 10 }}>
                {params.offset > 0 && (
                  <Link className="btn btn-outline" href={`${basePath}?${toQuery(params, { offset: Math.max(0, params.offset - PAGE) })}`}>Previous</Link>
                )}
                {to < total && (
                  <Link className="btn btn-outline" href={`${basePath}?${toQuery(params, { offset: params.offset + PAGE })}`}>Next {PAGE}</Link>
                )}
              </span>
            </div>
          )}
        </>
      )}
    </section>
  );
}
