import { listCategories, MARKETS, parseParams, searchBrands, SITES } from "@/lib/search";
import { claimsFor } from "@/lib/rtd";
import { Results } from "./Results";

export default async function FitsThisSpace({ searchParams }: PageProps<"/">) {
  const params = parseParams(await searchParams);
  const [categories, result] = await Promise.all([
    listCategories(),
    params.size ? searchBrands(params) : Promise.resolve(null),
  ]);
  const claims = await claimsFor(result?.rows.map((r) => r.entity_id) ?? []);

  return (
    <>
      <header className="stack" style={{ gap: 6 }}>
        <div className="eyebrow">Who would take this space?</div>
        <h1>Fits this space</h1>
      </header>

      <form className="searchform" method="get" action="/">
        <label className="field">
          Size (SF)
          <input name="size" inputMode="numeric" required defaultValue={params.size ? params.size.toLocaleString("en-US") : ""} placeholder="2,400" />
        </label>
        <label className="field">
          Market
          <select name="market" defaultValue={params.market}>
            <option value="">Any market</option>
            {MARKETS.map((m) => <option key={m.code} value={m.code}>{m.label}</option>)}
          </select>
        </label>
        <label className="field">
          Category
          <select name="category" defaultValue={params.category}>
            <option value="">Any category</option>
            {categories.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
          </select>
        </label>
        <label className="field">
          Site
          <select name="site" defaultValue={params.site}>
            {SITES.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
          </select>
        </label>
        <button className="btn btn-primary">Find brands</button>
        <div className="row">
          <label className="check">
            <input type="checkbox" name="close" value="0" defaultChecked={!params.close} /> Exact fits only (hide close)
          </label>
          <label className="check">
            <input type="checkbox" name="unverified" value="1" defaultChecked={params.unverified} /> Unverified only
          </label>
        </div>
      </form>

      {result?.error && <p className="error">Search failed: {result.error}</p>}
      {result && !result.error && <Results rows={result.rows} params={params} basePath="/" showFit claims={claims} />}
      {!result && (
        <div className="empty">
          Enter the space&apos;s size to see which brands fit. Brands with no target markets on file yet still show for any
          market — every RealNex brand starts that way until someone verifies it.
        </div>
      )}
    </>
  );
}
