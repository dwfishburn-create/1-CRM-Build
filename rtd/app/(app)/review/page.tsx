import Link from "next/link";
import { getMe } from "@/lib/supabase";
import { categoryMap, changeLines, changeTitle, FIELD_LABEL, reviewQueue, showValue, when } from "@/lib/rtd";
import { ImportForm, ReviewItem } from "./ReviewItem";

// Sync to CRM (Dan only, 10/22/2026): the team's RTD updates that aren't in
// Dan's CRM yet, oldest first. Everything here is already live in the RTD.
// Add to CRM writes it into the CRM (duplicate gate and conflict check
// included); Keep in RTD only leaves it in the RTD and out of the CRM; Later
// decides another time. The same list downloads as an Excel sheet.

export default async function Review() {
  const me = await getMe();
  if (!me?.is_admin) {
    return <div className="empty">This page is for syncing Dan&apos;s own CRM. Everything you save is already live in the RTD.</div>;
  }
  const [{ items, error }, cats] = await Promise.all([reviewQueue(), categoryMap()]);

  return (
    <>
      <header className="resultshead">
        <div className="stack" style={{ gap: 6 }}>
          <div className="eyebrow">Team updates not in your CRM yet</div>
          <h1>Sync to CRM</h1>
        </div>
        {items.length > 0 && (
          <a className="btn btn-outline" href="/review-export">Download for Excel</a>
        )}
      </header>

      {error && <p className="error">{error}</p>}
      {!error && items.length === 0 && <div className="empty">Your CRM is up to date with the RTD.</div>}

      {items.map((it) => {
        const conflicts = it.conflicts ?? [];
        return (
          <ReviewItem key={it.id} type={it.type} id={it.id} kind={it.kind} conflict={conflicts.length > 0}>
            <div className="qhead">
              <span className="pill pill-plain">{it.type === "note" ? "Intel note" : changeTitle(it)}</span>
              {it.entity_id ? <Link className="name" href={`/brands/${it.entity_id}`}>{it.brand}</Link> : <b>{it.brand}</b>}
              {it.requirement_code && <span className="muted-inline">{it.requirement_code}</span>}
              <span className="muted-inline">{it.author} · {when(it.created_at)}</span>
            </div>
            {it.type === "note" ? (
              <>
                {it.tags && it.tags.length > 0 && <div className="tags">{it.tags.map((t) => <span key={t} className="pill pill-tag">{t}</span>)}</div>}
                <p className="notebody">{it.body}</p>
                <p className="muted small">Add to CRM puts it in your CRM activity log, credited to {it.author}. Either way it stays in the RTD.</p>
              </>
            ) : (
              <>
                <ul className="changes">{changeLines(it, cats).map((l) => <li key={l}>{l}</li>)}</ul>
                {conflicts.length > 0 && (
                  <div className="conflict">
                    <b>Your CRM changed since {it.author} updated this:</b>
                    <ul>
                      {conflicts.map((k) => (
                        <li key={k}>{FIELD_LABEL[k] ?? k} is now {showValue(k, it.current?.[k], cats)} in your CRM (it was {showValue(k, it.old_value?.[k], cats)} when they edited)</li>
                      ))}
                    </ul>
                  </div>
                )}
                {it.matches && it.matches.length > 0 && (
                  <div className="conflict">
                    <b>Possible duplicates in the CRM:</b>
                    <ul>
                      {it.matches.map((m) => (
                        <li key={m.id}>{m.name}{m.display_code ? ` (${m.display_code})` : ""}{m.email ? ` · ${m.email}` : ""} — {m.reason} ({Math.round(m.score * 100)}%)</li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </ReviewItem>
        );
      })}

      {items.length > 0 && (
        <section className="card stack">
          <h2>Syncing in Excel?</h2>
          <p className="muted">Download the sheet, pick Add to CRM, Keep in RTD only or Later in the Decision column (Yes under &quot;Add anyway&quot; to override a conflict or duplicate), then upload it here.</p>
          <ImportForm />
        </section>
      )}
    </>
  );
}
