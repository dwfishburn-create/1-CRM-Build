import Link from "next/link";
import { globalSearch, cleanQuery, MIN_QUERY } from "@/lib/globalSearch";

export const dynamic = "force-dynamic";

// Full results for the top-menu search box (10/10/2026). Enter in the box
// lands here; up to 25 per type. Same matcher as the dropdown.

export default async function SearchPage(props: PageProps<"/search">) {
  const sp = await props.searchParams;
  const raw = Array.isArray(sp?.q) ? sp.q[0] : sp?.q;
  const q = cleanQuery(raw);
  const results = q.length >= MIN_QUERY ? await globalSearch(q, 25) : null;
  const total = results ? results.groups.reduce((n, g) => n + g.total, 0) : 0;

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <h1 className="text-2xl font-semibold mb-1">Search</h1>

      <form action="/search" className="mb-6 flex gap-2">
        <input
          name="q"
          defaultValue={q}
          placeholder="Name, company, address, phone, email, parcel, deal…"
          className="flex-1 rounded-md border border-neutral-300 bg-white px-3 py-2 text-[15px] text-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
        />
        <button className="rounded-md bg-blue-600 px-4 py-2 text-white">Search</button>
      </form>

      {!results && (
        <p className="text-neutral-500 dark:text-neutral-400">
          Type at least {MIN_QUERY} characters. Press <kbd className="rounded border px-1">/</kbd> or{" "}
          <kbd className="rounded border px-1">Ctrl+K</kbd> on any page to search from the top menu.
        </p>
      )}

      {results && results.errors.length > 0 && (
        <p className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300">
          Some results couldn&apos;t load: {results.errors.join("; ")}
        </p>
      )}

      {results && results.groups.length === 0 && (
        <p className="text-neutral-500 dark:text-neutral-400">Nothing matches &ldquo;{q}&rdquo;.</p>
      )}

      {results && results.groups.length > 0 && (
        <p className="mb-6 text-sm text-neutral-500 dark:text-neutral-400">
          {total} match{total === 1 ? "" : "es"} for &ldquo;{q}&rdquo;
        </p>
      )}

      {results?.groups.map((g) => (
        <section key={g.kind} className="mb-8">
          <h2 className="mb-2 text-lg font-semibold">
            {g.label}{" "}
            <span className="text-sm font-normal text-neutral-500 dark:text-neutral-400">
              {g.total > g.hits.length ? `${g.hits.length} of ${g.total} — refine the search to narrow` : g.total}
            </span>
          </h2>
          <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
            {g.hits.map((h) => (
              <li key={h.id}>
                <Link
                  href={h.href}
                  className="block px-4 py-2.5 hover:bg-neutral-50 dark:hover:bg-neutral-900"
                >
                  <span className="text-[15px]">
                    {h.title}
                    {h.code && (
                      <span className="ml-2 text-[12px] text-neutral-500 dark:text-neutral-400">{h.code}</span>
                    )}
                  </span>
                  {h.context && (
                    <span className="block text-[13px] text-neutral-500 dark:text-neutral-400">{h.context}</span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
