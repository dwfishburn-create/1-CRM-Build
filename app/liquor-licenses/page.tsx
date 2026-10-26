import Link from "next/link";
import { entityHref, propertyHref } from "@/lib/records";
import {
  CHANGE_TYPES,
  SALE_TYPES,
  listChanges,
  listOperators,
  liquorMeta,
  fmtPhone,
  saleTypeLabel,
  searchLicenses,
  type LiquorMeta,
} from "@/lib/liquorLicenses";

export const dynamic = "force-dynamic";

// Nebraska liquor licenses (10/26/2026, migration 032). The NLCC roster as a
// prospecting tool: who holds a license where, which operators run several,
// and what changed between roster pulls (openings, closures, sales). It is a
// reference dataset — rows become CRM companies / contacts only when Dan
// promotes one from its license page. Filters live in the querystring so a
// filtered list is a link; the Export link carries the same filters.

const PAGE = 50;
const th = "py-2 pr-3 font-medium whitespace-nowrap";
const td = "py-2 pr-3";
const num = "py-2 pr-3 text-right tabular-nums whitespace-nowrap";
const control =
  "border border-gray-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 rounded px-2 py-1.5 text-sm";
const link = "text-blue-600 dark:text-blue-400 hover:underline";

function first(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v ?? "").trim();
}
function all(v: string | string[] | undefined): string[] {
  return (Array.isArray(v) ? v : v ? v.split(",") : []).map((s) => s.trim()).filter(Boolean);
}

type View = "licenses" | "operators" | "changes";

export default async function LiquorLicensesPage(props: PageProps<"/liquor-licenses">) {
  const sp = await props.searchParams;
  const view: View = (["operators", "changes"].includes(first(sp.view)) ? first(sp.view) : "licenses") as View;
  const q = first(sp.q);
  const city = first(sp.city);
  const county = first(sp.county);
  const sale = all(sp.sale);
  const status = first(sp.status) || "active";
  const minOp = first(sp.min_operator);
  const since = first(sp.since);
  const types = all(sp.types);
  const brand = first(sp.brand) || "any";
  const sort = first(sp.sort) || "name";
  const offsetRaw = Number(first(sp.offset));
  const offset = Number.isFinite(offsetRaw) && offsetRaw > 0 ? Math.floor(offsetRaw) : 0;

  let meta: LiquorMeta | null = null;
  let loadError: string | null = null;
  try {
    meta = await liquorMeta();
  } catch (e) {
    loadError = e instanceof Error ? e.message : String(e);
  }

  const params = (extra: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams();
    const base: Record<string, string> = {
      view, q, city, county, sale: sale.join(","), status: status === "active" ? "" : status,
      min_operator: minOp, since, types: types.join(","), brand: brand === "any" ? "" : brand,
      sort: sort === "name" ? "" : sort,
    };
    for (const [k, v] of Object.entries({ ...base, ...extra })) {
      if (v !== undefined && v !== "" && !(k === "view" && v === "licenses")) p.set(k, String(v));
    }
    return p.toString();
  };
  const href = (extra: Record<string, string | number | undefined>) => {
    const s = params(extra);
    return s ? `/liquor-licenses?${s}` : "/liquor-licenses";
  };

  const tab = (v: View, label: string) => (
    <Link
      href={href({ view: v, offset: undefined })}
      className={`px-3 py-1.5 rounded text-sm ${view === v ? "bg-blue-600 text-white" : "text-blue-600 dark:text-blue-400 hover:underline"}`}
    >
      {label}
    </Link>
  );

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-baseline justify-between gap-3 mb-1">
        <h1 className="text-2xl font-semibold">Liquor Licenses</h1>
        <Link href="/liquor-licenses/import" className={`text-sm ${link}`}>
          Import a roster →
        </Link>
      </div>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
        Nebraska Liquor Control Commission roster — retail and misc licenses with a Nebraska premises.
        {meta?.latest_snapshot_date ? (
          <>
            {" "}
            As of the <b>{meta.latest_snapshot_date}</b> roster · {Number(meta.active).toLocaleString()} active
            {" · "}
            {Number(meta.with_brand).toLocaleString()} linked to a directory brand ·{" "}
            {Number(meta.with_licensee_company).toLocaleString()} to a CRM company ·{" "}
            {Number(meta.with_property).toLocaleString()} to a CRM property.
          </>
        ) : (
          <> No roster imported yet.</>
        )}{" "}
        Public record, unverified — confirm before relying on a contact.
      </p>

      {loadError && <p className="mb-4 text-sm text-red-600 dark:text-red-400">Couldn&apos;t load: {loadError}</p>}

      <div className="flex gap-1 mb-4">
        {tab("licenses", "Licenses")}
        {tab("operators", "Multi-unit operators")}
        {tab("changes", "Changes between rosters")}
      </div>

      <form method="get" action="/liquor-licenses" className="flex flex-wrap items-end gap-3 mb-6">
        {view !== "licenses" && <input type="hidden" name="view" value={view} />}
        <label className="text-xs text-gray-600 dark:text-gray-400">
          {view === "operators" ? "Licensee / trade name" : "Search"}
          <input
            name="q"
            defaultValue={q}
            placeholder={view === "changes" ? "" : "Name, licensee, manager, street…"}
            className={`${control} block w-56`}
            disabled={view === "changes"}
          />
        </label>
        <label className="text-xs text-gray-600 dark:text-gray-400">
          City
          <input name="city" defaultValue={city} placeholder="e.g. Omaha" className={`${control} block w-32`} />
        </label>
        <label className="text-xs text-gray-600 dark:text-gray-400">
          County
          <select name="county" defaultValue={county} className={`${control} block w-36`}>
            <option value="">All counties</option>
            {(meta?.counties ?? []).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="text-xs text-gray-600 dark:text-gray-400">
          <legend>Type</legend>
          <div className="flex flex-wrap gap-x-3 gap-y-1 pt-1">
            {SALE_TYPES.map((s) => (
              <label key={s.value} className="flex items-center gap-1 text-sm text-gray-700 dark:text-gray-300" title={s.label}>
                <input type="checkbox" name="sale" value={s.value} defaultChecked={sale.includes(s.value)} />
                {s.short}
              </label>
            ))}
          </div>
        </fieldset>
        {view === "licenses" && (
          <>
            <label className="text-xs text-gray-600 dark:text-gray-400">
              Operator holds
              <select name="min_operator" defaultValue={minOp} className={`${control} block`}>
                <option value="">Any</option>
                <option value="2">2+ licenses</option>
                <option value="3">3+</option>
                <option value="5">5+</option>
                <option value="10">10+</option>
              </select>
            </label>
            <label className="text-xs text-gray-600 dark:text-gray-400">
              Status
              <select name="status" defaultValue={status} className={`${control} block`}>
                <option value="active">Active</option>
                <option value="dropped">Dropped</option>
                <option value="all">All</option>
              </select>
            </label>
            <label className="text-xs text-gray-600 dark:text-gray-400">
              Brand link
              <select name="brand" defaultValue={brand} className={`${control} block`}>
                <option value="any">Any</option>
                <option value="linked">Linked to a brand</option>
                <option value="unlinked">Not linked</option>
              </select>
            </label>
            <label className="text-xs text-gray-600 dark:text-gray-400">
              Sort
              <select name="sort" defaultValue={sort} className={`${control} block`}>
                <option value="name">Name</option>
                <option value="operator">Biggest operators first</option>
                <option value="city">City</option>
                <option value="newest">Newest on roster</option>
              </select>
            </label>
          </>
        )}
        {view === "operators" && (
          <label className="text-xs text-gray-600 dark:text-gray-400">
            At least
            <select name="min_operator" defaultValue={minOp || "2"} className={`${control} block`}>
              <option value="2">2 licenses</option>
              <option value="3">3</option>
              <option value="5">5</option>
              <option value="10">10</option>
            </select>
          </label>
        )}
        {view === "changes" && (
          <>
            <label className="text-xs text-gray-600 dark:text-gray-400">
              Roster on/after
              <input type="date" name="since" defaultValue={since} className={`${control} block`} />
            </label>
            <fieldset className="text-xs text-gray-600 dark:text-gray-400">
              <legend>Change</legend>
              <div className="flex flex-wrap gap-x-3 gap-y-1 pt-1">
                {CHANGE_TYPES.map((c) => (
                  <label key={c.value} className="flex items-center gap-1 text-sm text-gray-700 dark:text-gray-300" title={c.label}>
                    <input type="checkbox" name="types" value={c.value} defaultChecked={types.includes(c.value)} />
                    {c.value.replace("_", " ")}
                  </label>
                ))}
              </div>
            </fieldset>
          </>
        )}
        <button type="submit" className="bg-blue-600 text-white rounded px-4 py-1.5 text-sm">
          Filter
        </button>
        <Link href={href({ q: "", city: "", county: "", sale: "", status: "", min_operator: "", since: "", types: "", brand: "", sort: "" })} className={`text-sm pb-1.5 ${link}`}>
          Clear
        </Link>
        <a href={`/liquor-licenses/export?${params({ offset: undefined })}`} className={`text-sm pb-1.5 ml-auto ${link}`}>
          Export to Excel
        </a>
      </form>

      {view === "licenses" && <Licenses {...{ q, city, county, sale, status, minOp, brand, sort, offset, href }} />}
      {view === "operators" && <Operators {...{ q, city, county, sale, minOp, offset, href }} />}
      {view === "changes" && <Changes {...{ city, county, sale, since, types, offset, href }} />}
    </div>
  );
}

function Pager({ offset, shown, total, href }: {
  offset: number; shown: number; total: number; href: (x: Record<string, string | number | undefined>) => string;
}) {
  if (total <= PAGE) return null;
  return (
    <div className="flex gap-4 mt-4 text-sm">
      {offset > 0 && <Link className={link} href={href({ offset: Math.max(0, offset - PAGE) || undefined })}>← Previous</Link>}
      {offset + shown < total && <Link className={link} href={href({ offset: offset + PAGE })}>Next →</Link>}
    </div>
  );
}

async function Licenses(p: {
  q: string; city: string; county: string; sale: string[]; status: string; minOp: string; brand: string; sort: string;
  offset: number; href: (x: Record<string, string | number | undefined>) => string;
}) {
  let r: Awaited<ReturnType<typeof searchLicenses>> | null = null;
  let err: string | null = null;
  try {
    r = await searchLicenses({
      q: p.q, city: p.city, county: p.county, sale_types: p.sale, status: p.status, min_operator: p.minOp,
      brand: p.brand, sort: p.sort, limit: PAGE, offset: p.offset,
    });
  } catch (e) {
    err = e instanceof Error ? e.message : String(e);
  }
  if (err) return <p className="text-sm text-red-600">Couldn&apos;t search: {err}</p>;
  const rows = r?.licenses ?? [];
  const total = r?.count ?? 0;
  return (
    <>
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
        {total.toLocaleString()} license{total === 1 ? "" : "s"}
        {total > 0 && <> · showing {p.offset + 1}–{p.offset + rows.length}</>}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-left border-b border-gray-300 dark:border-neutral-700">
              <th className={th}>Trade name</th>
              <th className={th}>Premises</th>
              <th className={th}>Type</th>
              <th className={th}>Licensee</th>
              <th className={`${th} text-right`} title="Active licenses this operator holds statewide">Op. licenses</th>
              <th className={th}>Manager</th>
              <th className={th}>Phone / email</th>
              <th className={th}>Links</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l) => (
              <tr key={l.id} className="border-b border-gray-100 dark:border-neutral-800 align-top">
                <td className={td}>
                  <Link href={`/liquor-licenses/${l.license_number}`} className={link}>
                    {l.trade_name ?? l.license_number}
                  </Link>
                  {l.status === "dropped" && (
                    <span className="ml-1 text-xs text-amber-700 dark:text-amber-400">dropped {l.dropped_on}</span>
                  )}
                </td>
                <td className={td}>
                  {l.premises_street}
                  <div className="text-xs text-gray-500">{[l.premises_city, l.county].filter(Boolean).join(" · ")}</div>
                </td>
                <td className={td} title={l.class_label ?? ""}>
                  {saleTypeLabel(l.sale_type)} <span className="text-xs text-gray-500">({l.class})</span>
                </td>
                <td className={td}>
                  {l.licensee_entity_id ? (
                    <Link href={entityHref(l.licensee_entity_id)} className={link}>{l.licensee}</Link>
                  ) : (
                    l.licensee
                  )}
                </td>
                <td className={num}>{l.operator_licenses}</td>
                <td className={td}>{l.manager_name ?? "—"}</td>
                <td className={td}>
                  <div className="whitespace-nowrap">{fmtPhone(l.phone)}</div>
                  <div className="text-xs text-gray-500 break-all">{l.email}</div>
                </td>
                <td className={td}>
                  {l.brand_entity_id && (
                    <Link href={entityHref(l.brand_entity_id)} className={`${link} block`}>{l.brand_name}</Link>
                  )}
                  {l.property_id && (
                    <Link href={propertyHref(l.property_id)} className={`${link} block text-xs`}>{l.property_code}</Link>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager offset={p.offset} shown={rows.length} total={total} href={p.href} />
    </>
  );
}

async function Operators(p: {
  q: string; city: string; county: string; sale: string[]; minOp: string; offset: number;
  href: (x: Record<string, string | number | undefined>) => string;
}) {
  let r: Awaited<ReturnType<typeof listOperators>> | null = null;
  let err: string | null = null;
  try {
    r = await listOperators({ q: p.q, city: p.city, county: p.county, sale_types: p.sale, min_licenses: p.minOp || 2, limit: PAGE, offset: p.offset });
  } catch (e) {
    err = e instanceof Error ? e.message : String(e);
  }
  if (err) return <p className="text-sm text-red-600">Couldn&apos;t load operators: {err}</p>;
  const rows = r?.operators ?? [];
  const total = r?.count ?? 0;
  const area = p.city || p.county || p.sale.length;
  return (
    <>
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
        {total.toLocaleString()} operator{total === 1 ? "" : "s"} with {p.minOp || 2}+ active licenses
        {area ? " and at least one in the filter" : ""}. Sorted by licenses {area ? "in the filter" : "statewide"}.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-left border-b border-gray-300 dark:border-neutral-700">
              <th className={th}>Licensee</th>
              <th className={`${th} text-right`}>Statewide</th>
              {area ? <th className={`${th} text-right`}>In filter</th> : null}
              <th className={th}>Trade names</th>
              <th className={th}>Cities</th>
              <th className={th}>Brand</th>
              <th className={th}>Contact (most common)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => (
              <tr key={o.operator_key} className="border-b border-gray-100 dark:border-neutral-800 align-top">
                <td className={td}>
                  {o.licensee_entity_id ? (
                    <Link href={entityHref(o.licensee_entity_id)} className={link}>{o.licensee}</Link>
                  ) : (
                    o.licensee
                  )}
                  <div className="text-xs text-gray-500">{o.corporate_address}</div>
                  <Link href={`/liquor-licenses?q=${encodeURIComponent(o.licensee)}&sort=city`} className={`text-xs ${link}`}>
                    See licenses
                  </Link>
                </td>
                <td className={num}>{o.license_count}</td>
                {area ? <td className={num}>{o.in_area_count}</td> : null}
                <td className={`${td} max-w-xs`}>
                  <span className="line-clamp-3">{o.trade_names}</span>
                </td>
                <td className={`${td} max-w-xs`}>
                  <span className="line-clamp-3">{o.cities}</span>
                </td>
                <td className={td}>{o.brand_names ?? "—"}</td>
                <td className={td}>
                  <div className="whitespace-nowrap">{fmtPhone(o.sample_phone)}</div>
                  <div className="text-xs text-gray-500 break-all">{o.sample_email}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager offset={p.offset} shown={rows.length} total={total} href={p.href} />
    </>
  );
}

async function Changes(p: {
  city: string; county: string; sale: string[]; since: string; types: string[]; offset: number;
  href: (x: Record<string, string | number | undefined>) => string;
}) {
  let r: Awaited<ReturnType<typeof listChanges>> | null = null;
  let err: string | null = null;
  try {
    r = await listChanges({ city: p.city, county: p.county, sale_types: p.sale, since: p.since || null, types: p.types, limit: PAGE, offset: p.offset });
  } catch (e) {
    err = e instanceof Error ? e.message : String(e);
  }
  if (err) return <p className="text-sm text-red-600">Couldn&apos;t load changes: {err}</p>;
  const rows = r?.changes ?? [];
  const total = r?.count ?? 0;
  const label = Object.fromEntries(CHANGE_TYPES.map((c) => [c.value, c.label]));
  return (
    <>
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
        {total.toLocaleString()} change{total === 1 ? "" : "s"}. &quot;Dropped&quot; = on the previous roster, gone from
        this one (closed, sold or not renewed) — a likely vacancy. The first roster loaded is the baseline.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-left border-b border-gray-300 dark:border-neutral-700">
              <th className={th}>Roster</th>
              <th className={th}>Change</th>
              <th className={th}>Trade name</th>
              <th className={th}>Premises</th>
              <th className={th}>Was → now</th>
              <th className={th}>Licensee / contact</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.change_id} className="border-b border-gray-100 dark:border-neutral-800 align-top">
                <td className={`${td} whitespace-nowrap`}>{c.snapshot_date}</td>
                <td className={td}>{label[c.change_type] ?? c.change_type}</td>
                <td className={td}>
                  <Link href={`/liquor-licenses/${c.license_number}`} className={link}>{c.trade_name ?? c.license_number}</Link>
                  <div className="text-xs text-gray-500">{saleTypeLabel(c.sale_type)}</div>
                </td>
                <td className={td}>
                  {c.premises_street}
                  <div className="text-xs text-gray-500">{[c.premises_city, c.county].filter(Boolean).join(" · ")}</div>
                </td>
                <td className={`${td} text-xs`}>
                  {c.change_type === "new" || c.change_type === "dropped" ? "" : <>{c.old_value ?? "—"} → {c.new_value ?? "—"}</>}
                </td>
                <td className={td}>
                  {c.licensee}
                  <div className="text-xs text-gray-500">
                    {[c.manager_name, fmtPhone(c.phone), c.email].filter(Boolean).join(" · ")}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager offset={p.offset} shown={rows.length} total={total} href={p.href} />
    </>
  );
}
