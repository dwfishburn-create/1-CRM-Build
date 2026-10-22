import Link from "next/link";
import {
  describeExclusions, describeSearch, fromSaved, getSavedSearch, listCategories, listSavedSearches,
  markSearchViewed, MARKETS, parseParams, sameSearch, searchBrands, SITES, toSaved,
} from "@/lib/search";
import { claimsFor, shortDay } from "@/lib/rtd";
import { ActionForm } from "@/app/_components/ActionForm";
import { deleteSearch, saveSearch, updateSearch } from "./searches/actions";
import { isNewer, Results } from "./Results";

export default async function FitsThisSpace({ searchParams }: PageProps<"/">) {
  const sp = await searchParams;
  let params = parseParams(sp);
  const saved = params.saved ? await getSavedSearch(params.saved) : null;
  // "/?saved=<id>" alone = run the saved search as saved.
  if (saved && !params.size) params = fromSaved(saved.params, saved.id);
  if (!saved) params = { ...params, saved: "" };

  const [categories, result, all] = await Promise.all([
    listCategories(),
    params.size ? searchBrands(params) : Promise.resolve(null),
    listSavedSearches(),
  ]);
  const claims = await claimsFor(result?.rows.map((r) => r.entity_id) ?? []);
  // Opening a saved search resets this person's "new since" mark — after the
  // page has used the old one to mark what's new.
  if (saved) await markSearchViewed(saved.id);

  const savedParams = saved ? fromSaved(saved.params, saved.id) : null;
  const changed = !!(saved && savedParams && !sameSearch(params, savedParams));
  const listings = [...new Set(all.rows.map((s) => s.listing).filter((x): x is string => !!x))].sort();
  const newCount = saved && result ? result.rows.filter((r) => isNewer(r.changed_at, saved.new_since)).length : 0;
  const exclusions = describeExclusions(params, categories);
  const payload = JSON.stringify(toSaved(params));

  return (
    <>
      <header className="stack" style={{ gap: 6 }}>
        <div className="eyebrow">Who would take this space?</div>
        <h1>Fits this space</h1>
      </header>

      {saved && (
        <section className="card savedbar">
          <div className="stack" style={{ gap: 4 }}>
            <div className="eyebrow">Saved search{saved.listing ? ` · ${saved.listing}` : ""}</div>
            <h2>{saved.name}</h2>
            <p className="muted small">
              Saved by {saved.created_by}, {shortDay(saved.created_at)}
              {saved.updated_by && saved.updated_at !== saved.created_at ? ` · updated by ${saved.updated_by}, ${shortDay(saved.updated_at)}` : ""}
              {saved.last_viewed_at ? ` · you last looked ${shortDay(saved.last_viewed_at)}` : ""}
            </p>
            {result && !changed && (
              <p className={newCount ? "newnote" : "muted small"}>
                {newCount ? `${newCount} new or updated since you last looked — marked New below.` : "Nothing new since you last looked."}
              </p>
            )}
            {changed && <p className="muted small">You&apos;ve changed the filters — {saved.can_edit ? "update the saved search or save" : "save"} these as a new one below.</p>}
          </div>
          <div className="savedactions">
            <Link className="btn btn-outline btn-sm" href="/searches">All saved searches</Link>
            {saved.can_edit && (
              <ActionForm action={deleteSearch} submitLabel="Delete" submitClass="btn btn-quiet btn-sm" resetOnOk={false}
                confirm={`Delete the saved search "${saved.name}" for everyone?`}>
                <input type="hidden" name="id" value={saved.id} />
              </ActionForm>
            )}
          </div>
        </section>
      )}

      <form className="searchform" method="get" action="/">
        {params.saved && <input type="hidden" name="saved" value={params.saved} />}
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
          Site
          <select name="site" defaultValue={params.site}>
            {SITES.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
          </select>
        </label>
        <button className="btn btn-primary">Find brands</button>

        <details className="pickbox" open={params.categories.length > 0}>
          <summary>
            Categories{" "}
            <span className="muted-inline">{params.categories.length ? `${params.categories.length} picked` : "any category"}</span>
          </summary>
          <div className="chips">
            {categories.map((c) => (
              <label key={c.code} className="chip chip-sm">
                <input type="checkbox" name="category" value={c.code} defaultChecked={params.categories.includes(c.code)} />
                <span>{c.label}</span>
              </label>
            ))}
          </div>
        </details>

        <details className="pickbox" open={params.excludeCategories.length + params.excludeWords.length > 0}>
          <summary>
            Exclusives at this property{" "}
            <span className="muted-inline">{exclusions || "none"}</span>
          </summary>
          <p className="muted small">Leave out brands an existing tenant&apos;s exclusive rules out.</p>
          <div className="chips">
            {categories.map((c) => (
              <label key={c.code} className="chip chip-sm chip-x">
                <input type="checkbox" name="xcat" value={c.code} defaultChecked={params.excludeCategories.includes(c.code)} />
                <span>{c.label}</span>
              </label>
            ))}
          </div>
          <label className="field">
            Exclude brands whose name or type mentions
            <input name="xwords" defaultValue={params.excludeWords.join(", ")} placeholder="pizza, pizzeria, hair" />
            <span className="muted small">Separate with commas. Checks the brand name and its category detail (e.g. &quot;Restaurant-Pizza&quot;, &quot;Hair Care&quot;). Use words for a narrow exclusive (hair salons only); a whole category for a broad one.</span>
          </label>
        </details>

        <div className="row">
          <label className="check">
            <input type="checkbox" name="close" value="0" defaultChecked={!params.close} /> Exact fits only (hide close)
          </label>
          <label className="check">
            <input type="checkbox" name="unsized" value="1" defaultChecked={params.unsized} /> Include brands with no size on file
          </label>
          <label className="check">
            <input type="checkbox" name="unverified" value="1" defaultChecked={params.unverified} /> Unverified only
          </label>
        </div>
      </form>

      {result?.error && <p className="error">Search failed: {result.error}</p>}
      {result && !result.error && (
        <>
          <p className="muted small">{describeSearch(params, categories)}{exclusions ? ` · ${exclusions}` : ""}</p>
          <Results rows={result.rows} params={params} basePath="/" showFit claims={claims}
            newSince={saved && !changed ? saved.new_since : null} />
        </>
      )}
      {!result && (
        <div className="empty">
          Enter the space&apos;s size to see which brands fit. Brands with no target markets on file yet still show for any
          market — every RealNex brand starts that way until someone verifies it.
          {all.rows.length > 0 && <> Or open a <Link href="/searches">saved search</Link>.</>}
        </div>
      )}

      {result && !result.error && (
        <section className="card stack">
          {saved && changed && saved.can_edit && (
            <ActionForm action={updateSearch} submitLabel={`Update "${saved.name}"`} className="aform inlineform" resetOnOk={false}>
              <input type="hidden" name="id" value={saved.id} />
              <input type="hidden" name="params" value={payload} />
              <span className="muted small">Replace the saved filters with these.</span>
            </ActionForm>
          )}
          {(!saved || changed) && (
            <>
              <h2>{saved ? "Save as a new search" : "Save this search"}</h2>
              <p className="muted small">Jami, Trey and Dan all see saved searches. One per bay works well — same listing name, different size.</p>
              <ActionForm action={saveSearch} submitLabel="Save search" className="aform grid2" resetOnOk={false}>
                <input type="hidden" name="params" value={payload} />
                <label className="field">Name
                  <input name="name" required maxLength={120} placeholder="Bay A – 1,500 SF" />
                </label>
                <label className="field">Listing <span className="muted-inline">(optional — groups a center&apos;s bays)</span>
                  <input name="listing" maxLength={120} list="rtd-listings" defaultValue={saved?.listing ?? ""} placeholder="Westgate Plaza" />
                  <datalist id="rtd-listings">{listings.map((l) => <option key={l} value={l} />)}</datalist>
                </label>
              </ActionForm>
            </>
          )}
          {saved && !changed && (
            <p className="muted small">Change any filter above and search again to update this saved search or save a variation.</p>
          )}
        </section>
      )}
    </>
  );
}
