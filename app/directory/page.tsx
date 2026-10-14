import Link from "next/link";
import { entityHref } from "@/lib/records";
import {
  EXPANSION_STATUSES,
  FACILITY_TYPES,
  TARGET_MARKETS,
  choiceLabel,
  listBrands,
  listCategories,
  sizeRange,
  type BrandList,
} from "@/lib/retailBrands";

export const dynamic = "force-dynamic";

// Tenant Directory (10/13/2026, migration 026, build step 1 of 2). Retail,
// restaurant and service brands with what they need — the list Dan pulls
// prospects from for a vacancy. Reads view retail_brand_directory through
// listBrands() in lib/retailBrands.ts, the same function behind
// find_retail_brands, so the web filters and Claude's filters cannot disagree.
// Filters live in the querystring (a plain GET form), so a filtered list is a
// link that can be bookmarked or sent.
//
// Metro locations are derived from tenancies, never typed. A brand with no
// size on file passes a "fits SF" filter — unknown is not the same as
// doesn't fit.

const PAGE = 50;

const th = "py-2 pr-3 font-medium whitespace-nowrap";
const td = "py-2 pr-3";
const num = "py-2 pr-3 text-right tabular-nums whitespace-nowrap";
const control =
  "border border-gray-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 rounded px-2 py-1.5 text-sm";

function first(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v ?? "").trim();
}

export default async function DirectoryPage(props: PageProps<"/directory">) {
  const sp = await props.searchParams;
  const q = first(sp.q);
  const category = first(sp.category);
  const market = first(sp.market);
  const expansion = first(sp.expansion_status);
  const fits = first(sp.fits_sf);
  const unverified = first(sp.unverified) === "1";
  const offsetRaw = Number(first(sp.offset));
  const offset = Number.isFinite(offsetRaw) && offsetRaw > 0 ? Math.floor(offsetRaw) : 0;

  let result: BrandList | null = null;
  let loadError: string | null = null;
  const [categories] = await Promise.all([listCategories().catch(() => [])]);
  try {
    result = await listBrands({
      q,
      category,
      market,
      expansion_status: expansion,
      fits_sf: fits,
      needs_verification: unverified ? true : null,
      limit: PAGE,
      offset,
    });
  } catch (e) {
    loadError = e instanceof Error ? e.message : String(e);
  }

  const rows = result?.brands ?? [];
  const total = result?.count ?? 0;
  const filtered = !!(q || category || market || expansion || fits || unverified);

  const pageHref = (o: number) => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (category) p.set("category", category);
    if (market) p.set("market", market);
    if (expansion) p.set("expansion_status", expansion);
    if (fits) p.set("fits_sf", fits);
    if (unverified) p.set("unverified", "1");
    if (o > 0) p.set("offset", String(o));
    const s = p.toString();
    return s ? `/directory?${s}` : "/directory";
  };

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <h1 className="text-2xl font-semibold mb-1">Tenant Directory</h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
        Retail, restaurant and service brands and what they look for. Filter by size and market to
        build a prospect list for a space. To add a brand, open its entity and use &quot;Add to Tenant
        Directory&quot;.
      </p>

      <form method="get" action="/directory" className="flex flex-wrap items-end gap-3 mb-6">
        <label className="text-xs text-gray-600 dark:text-gray-400">
          Brand
          <input name="q" defaultValue={q} placeholder="Name or d/b/a" className={`${control} block w-48`} />
        </label>
        <label className="text-xs text-gray-600 dark:text-gray-400">
          Category
          <select name="category" defaultValue={category} className={`${control} block w-56`}>
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.code} value={c.code}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-gray-600 dark:text-gray-400">
          Market
          <select name="market" defaultValue={market} className={`${control} block`}>
            <option value="">All markets</option>
            {TARGET_MARKETS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-gray-600 dark:text-gray-400">
          Expansion
          <select name="expansion_status" defaultValue={expansion} className={`${control} block`}>
            <option value="">Any</option>
            {EXPANSION_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-gray-600 dark:text-gray-400">
          Fits SF
          <input
            name="fits_sf"
            type="number"
            min={0}
            defaultValue={fits}
            placeholder="e.g. 2400"
            className={`${control} block w-28`}
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 pb-1.5">
          <input type="checkbox" name="unverified" value="1" defaultChecked={unverified} />
          Unverified only
        </label>
        <button type="submit" className="bg-blue-600 text-white rounded px-4 py-1.5 text-sm">
          Filter
        </button>
        {filtered && (
          <Link href="/directory" className="text-sm text-blue-600 dark:text-blue-400 hover:underline pb-1.5">
            Clear
          </Link>
        )}
      </form>

      {loadError && <p className="mb-4 text-sm text-red-600 dark:text-red-400">Couldn&apos;t load: {loadError}</p>}

      <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
        {total.toLocaleString()} brand{total === 1 ? "" : "s"}
        {filtered ? " match" : " in the directory"}
        {total > 0 && (
          <>
            {" "}
            · showing {offset + 1}–{offset + rows.length}
          </>
        )}
      </p>

      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-left border-b border-gray-300 dark:border-neutral-700">
              <th className={th}>Brand</th>
              <th className={th}>Category</th>
              <th className={th}>Size</th>
              <th className={th}>Facility</th>
              <th className={th}>Markets</th>
              <th className={th}>Expansion</th>
              <th className={`${th} text-right`}>Contacts</th>
              <th className={`${th} text-right`}>Metro locs</th>
              <th className={`${th} text-right`}>Active reqs</th>
              <th className={th}>Verified</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((b) => (
              <tr key={b.brand_id} className="border-b border-gray-100 dark:border-neutral-800 align-top">
                <td className={td}>
                  <Link href={entityHref(b.entity_id)} className="text-blue-600 dark:text-blue-400 hover:underline">
                    {b.trade_name || b.name}
                  </Link>
                  {b.trade_name && b.trade_name !== b.name && (
                    <div className="text-xs text-gray-500 dark:text-gray-400">{b.name}</div>
                  )}
                </td>
                <td className={td}>
                  {b.category_label ?? "—"}
                  {b.category_detail && (
                    <div className="text-xs text-gray-500 dark:text-gray-400">{b.category_detail}</div>
                  )}
                </td>
                <td className={`${td} whitespace-nowrap tabular-nums`}>{sizeRange(b.size_min_sf, b.size_max_sf)}</td>
                <td className={`${td} text-gray-600 dark:text-gray-400`}>
                  {(b.facility_types ?? []).length
                    ? b.facility_types.map((f) => choiceLabel(FACILITY_TYPES, f, true)).join(", ")
                    : "—"}
                </td>
                <td className={`${td} text-gray-600 dark:text-gray-400`}>
                  {(b.target_markets ?? []).length
                    ? b.target_markets.map((m) => choiceLabel(TARGET_MARKETS, m, true)).join(", ")
                    : "—"}
                </td>
                <td className={`${td} whitespace-nowrap`}>{choiceLabel(EXPANSION_STATUSES, b.expansion_status)}</td>
                <td className={num}>{Number(b.current_contacts) || "—"}</td>
                <td className={num}>{Number(b.metro_locations) || "—"}</td>
                <td className={num}>
                  {Number(b.active_requirements) || "—"}
                  {b.next_reconfirm && (
                    <div className="text-xs text-gray-500 dark:text-gray-400">re-confirm {b.next_reconfirm}</div>
                  )}
                </td>
                <td className={`${td} whitespace-nowrap`}>
                  {b.needs_verification ? (
                    <span className="rounded border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950 px-1.5 py-0.5 text-xs text-amber-800 dark:text-amber-300">
                      unverified
                    </span>
                  ) : (
                    b.last_verified_on ?? "verified"
                  )}
                </td>
              </tr>
            ))}
            {!loadError && rows.length === 0 && (
              <tr>
                <td colSpan={10} className="py-4 text-gray-500 dark:text-gray-400">
                  {filtered ? "No brands match these filters." : "No brands in the directory yet."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {(offset > 0 || result?.has_more) && (
        <div className="flex gap-4 mt-4 text-sm">
          {offset > 0 && (
            <Link href={pageHref(Math.max(0, offset - PAGE))} className="text-blue-600 dark:text-blue-400 hover:underline">
              ← Previous {PAGE}
            </Link>
          )}
          {result?.has_more && (
            <Link href={pageHref(offset + PAGE)} className="text-blue-600 dark:text-blue-400 hover:underline">
              Next {PAGE} →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
