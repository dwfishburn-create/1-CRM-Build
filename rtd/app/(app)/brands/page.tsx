import { listCategories, MARKETS, parseParams, searchBrands } from "@/lib/search";
import { Results } from "../Results";

export default async function AllBrands({ searchParams }: PageProps<"/brands">) {
  const params = { ...parseParams(await searchParams), size: null, site: "any" };
  const [categories, result] = await Promise.all([listCategories(), searchBrands(params)]);

  return (
    <>
      <header className="stack" style={{ gap: 6 }}>
        <div className="eyebrow">The whole directory</div>
        <h1>All brands</h1>
      </header>

      <form className="searchform" method="get" action="/brands">
        <label className="field wide">
          Brand name
          <input name="q" defaultValue={params.q} placeholder="Ace, Scooter's…" />
        </label>
        <label className="field">
          Category
          <select name="category" defaultValue={params.category}>
            <option value="">Any category</option>
            {categories.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
          </select>
        </label>
        <label className="field">
          Market
          <select name="market" defaultValue={params.market}>
            <option value="">Any market</option>
            {MARKETS.map((m) => <option key={m.code} value={m.code}>{m.label}</option>)}
          </select>
        </label>
        <button className="btn btn-primary">Search</button>
        <div className="row">
          <label className="check">
            <input type="checkbox" name="unverified" value="1" defaultChecked={params.unverified} /> Unverified only
          </label>
        </div>
      </form>

      {result.error ? (
        <p className="error">Search failed: {result.error}</p>
      ) : (
        <Results rows={result.rows} params={params} basePath="/brands" showFit={false} />
      )}
    </>
  );
}
