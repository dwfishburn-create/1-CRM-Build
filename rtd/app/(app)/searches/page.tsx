import Link from "next/link";
import { describeExclusions, describeSearch, fromSaved, listCategories, listSavedSearches, type SavedSearch } from "@/lib/search";
import { shortDay } from "@/lib/rtd";
import { ActionForm } from "@/app/_components/ActionForm";
import { deleteSearch } from "./actions";

// Everyone's saved searches (031) — nothing here is private. Grouped by
// listing, so a center's bays sit together.
export default async function SavedSearches() {
  const [{ rows, error }, categories] = await Promise.all([listSavedSearches(), listCategories()]);
  const groups = new Map<string, SavedSearch[]>();
  for (const s of rows) {
    const k = s.listing ?? "";
    groups.set(k, [...(groups.get(k) ?? []), s]);
  }
  const keys = [...groups.keys()].sort((a, b) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)));

  return (
    <>
      <header className="resultshead">
        <div className="stack" style={{ gap: 6 }}>
          <div className="eyebrow">Run them again any time</div>
          <h1>Saved searches</h1>
        </div>
        <Link className="btn btn-primary" href="/">New search</Link>
      </header>
      <p className="muted">Everyone&apos;s saved searches, with what&apos;s new since you last opened each one. Whoever saved a search, or Dan, can update or delete it; anyone can save a copy.</p>

      {error && <p className="error">{error}</p>}
      {!error && rows.length === 0 && (
        <div className="empty">No saved searches yet. Run a search on Fits this space, then use Save this search under the results.</div>
      )}

      {keys.map((k) => (
        <section key={k || "_none"} className="stack">
          <h2>{k || "Other searches"}</h2>
          <ul className="savedlist">
            {groups.get(k)!.map((s) => {
              const p = fromSaved(s.params, s.id);
              const x = describeExclusions(p, categories);
              return (
                <li key={s.id} className="card">
                  <div className="stack" style={{ gap: 4 }}>
                    <Link className="name" href={`/?saved=${s.id}`}>{s.name}</Link>
                    <span className="sub">{describeSearch(p, categories)}</span>
                    {x && <span className="sub">{x}</span>}
                    <span className="sub">Saved by {s.created_by}, {shortDay(s.created_at)}{s.last_viewed_at ? ` · you last looked ${shortDay(s.last_viewed_at)}` : ""}</span>
                  </div>
                  <div className="savedmeta">
                    {s.total != null && <span className="sub">{s.total.toLocaleString("en-US")} brands</span>}
                    {!!s.new_count && <span className="pill pill-new">{s.new_count} new</span>}
                    <Link className="btn btn-outline btn-sm" href={`/?saved=${s.id}`}>Run</Link>
                    {s.can_edit && (
                      <ActionForm action={deleteSearch} submitLabel="Delete" submitClass="btn btn-quiet btn-xs" resetOnOk={false}
                        confirm={`Delete the saved search "${s.name}" for everyone?`}>
                        <input type="hidden" name="id" value={s.id} />
                      </ActionForm>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </>
  );
}
