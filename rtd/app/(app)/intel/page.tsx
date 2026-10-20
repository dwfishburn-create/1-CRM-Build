import Link from "next/link";
import { db } from "@/lib/supabase";
import { parseParams, searchBrands } from "@/lib/search";
import { NOTE_TAGS } from "@/lib/rtd";
import { ActionForm } from "@/app/_components/ActionForm";
import { addNote } from "@/app/actions";

// Quick note — built for a phone in a parking lot: find the brand, tap it,
// type what you heard, save. Two screens, big targets, nothing else.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function QuickNote({ searchParams }: PageProps<"/intel">) {
  const sp = await searchParams;
  const brandId = typeof sp.brand === "string" && UUID.test(sp.brand) ? sp.brand : null;
  const q = typeof sp.q === "string" ? sp.q.trim() : "";

  if (brandId) {
    const supabase = await db();
    const { data } = await supabase.rpc("rtd_brand", { p_entity_id: brandId });
    const b = data as { entity_id: string; name: string; category_label: string | null } | null;
    if (!b) return <div className="empty">That brand isn&apos;t in the directory. <Link href="/intel">Pick another</Link>.</div>;
    return (
      <div className="phone stack">
        <Link href="/intel" className="backlink">← Different brand</Link>
        <header className="stack" style={{ gap: 4 }}>
          <div className="eyebrow">Quick note</div>
          <h1>{b.name}</h1>
          {b.category_label && <p className="muted">{b.category_label}</p>}
        </header>
        <div className="card">
          <ActionForm action={addNote} submitLabel="Save note" submitClass="btn btn-primary btn-block">
            <input type="hidden" name="entity_id" value={b.entity_id} />
            <label className="field">What did you hear?
              <textarea name="body" rows={5} required maxLength={4000} autoFocus placeholder="Looking for 2 more Omaha stores, 2,000–2,400 SF…" />
            </label>
            <div className="chips" role="group" aria-label="Tags">
              {NOTE_TAGS.map((t) => (
                <label key={t} className="chip"><input type="checkbox" name="tags" value={t} /><span>{t}</span></label>
              ))}
            </div>
          </ActionForm>
        </div>
        <Link href={`/brands/${b.entity_id}`} className="btn btn-outline btn-block">Open the brand page</Link>
      </div>
    );
  }

  // Best name matches first: starts with what was typed, then a word starting with it, then the rest.
  const found = q ? await searchBrands({ ...parseParams({}), q, close: true }, 60) : null;
  const ql = q.toLowerCase();
  const rank = (n: string) => {
    const l = n.toLowerCase();
    return l.startsWith(ql) ? 0 : l.split(/[^a-z0-9]+/).some((w) => w.startsWith(ql)) ? 1 : 2;
  };
  const result = found && { ...found, rows: [...found.rows].sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name)).slice(0, 12) };

  return (
    <div className="phone stack">
      <header className="stack" style={{ gap: 4 }}>
        <div className="eyebrow">Heard something?</div>
        <h1>Quick note</h1>
      </header>
      <form method="get" action="/intel" className="stack">
        <label className="field">Which brand?
          <input name="q" defaultValue={q} placeholder="Start typing a brand name" autoFocus={!q} autoComplete="off" enterKeyHint="search" />
        </label>
        <button className="btn btn-primary btn-block">Find</button>
      </form>
      {result?.error && <p className="error">Search failed: {result.error}</p>}
      {result && !result.error && (
        result.rows.length === 0 ? (
          <div className="empty">No brand by that name. <Link href={`/add-brand?name=${encodeURIComponent(q)}`}>Add {q} as a new brand</Link>.</div>
        ) : (
          <ul className="picklist">
            {result.rows.map((r) => (
              <li key={r.entity_id}>
                <Link href={`/intel?brand=${r.entity_id}`}>
                  <b>{r.name}</b>
                  <span>{r.category_label ?? "No category"}</span>
                </Link>
              </li>
            ))}
          </ul>
        )
      )}
    </div>
  );
}
