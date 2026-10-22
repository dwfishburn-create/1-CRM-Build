import { listCategories, MARKETS, parseParams, searchBrands } from "@/lib/search";
import Link from "next/link";
import { db, getMe } from "@/lib/supabase";
import { claimsFor, shortDay } from "@/lib/rtd";
import { CrmMark } from "@/app/_components/Marks";
import { Results } from "../Results";

type NewBrand = { change_id: string; name: string; added_by: string; added_at: string; status: string; category_label: string | null };

export default async function AllBrands({ searchParams }: PageProps<"/brands">) {
  const params = { ...parseParams(await searchParams), size: null, site: "any", unsized: false, excludeCategories: [], excludeWords: [], showExcluded: false, saved: "" };
  const [categories, result] = await Promise.all([listCategories(), searchBrands(params)]);
  const claims = await claimsFor(result.rows.map((r) => r.entity_id));
  const supabase = await db();
  const [{ data: nb }, me] = await Promise.all([supabase.rpc("rtd_new_brands"), getMe()]);
  const q = params.q.toLowerCase();
  // Brands added in the RTD that don't have a CRM record yet (030).
  const newBrands = ((nb ?? []) as NewBrand[]).filter((b) => !q || b.name.toLowerCase().includes(q));

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
          <select name="category" defaultValue={params.categories[0] ?? ""}>
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

      {newBrands.length > 0 && params.offset === 0 && (
        <section className="stack">
          <h2>Just added</h2>
          <ul className="picklist newlist">
            {newBrands.map((b) => (
              <li key={b.change_id}>
                <Link href={`/brands/${b.change_id}`}>
                  <b>{b.name}</b>
                  <span>{b.category_label ?? "No category"} · added by {b.added_by}, {shortDay(b.added_at)}
                    {" "}<CrmMark isAdmin={!!me?.is_admin} status={b.status} /></span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {result.error ? (
        <p className="error">Search failed: {result.error}</p>
      ) : (
        <Results rows={result.rows} params={params} basePath="/brands" showFit={false} claims={claims} />
      )}
    </>
  );
}
