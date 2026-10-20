import Link from "next/link";
import { getMe } from "@/lib/supabase";
import { categoryMap, changeLines, changeTitle, FIELD_LABEL, reviewQueue, showValue, when } from "@/lib/rtd";
import { ImportForm, ReviewItem } from "./ReviewItem";

// Dan's review queue: everything Jami and Trey proposed, oldest first.
// Accept writes it into the CRM (duplicate gate included); Reject keeps it
// out; Leave decides later. Same queue downloads as an Excel sheet.

export default async function Review() {
  const me = await getMe();
  if (!me?.is_admin) {
    return <div className="empty">Only Dan reviews proposals. Your notes and edits show on each brand page right away.</div>;
  }
  const [{ items, error }, cats] = await Promise.all([reviewQueue(), categoryMap()]);

  return (
    <>
      <header className="resultshead">
        <div className="stack" style={{ gap: 6 }}>
          <div className="eyebrow">From Jami and Trey</div>
          <h1>Review</h1>
        </div>
        {items.length > 0 && (
          <a className="btn btn-outline" href="/review-export">Download for Excel</a>
        )}
      </header>

      {error && <p className="error">{error}</p>}
      {!error && items.length === 0 && <div className="empty">Nothing waiting. New notes and edits from Jami and Trey land here.</div>}

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
                <p className="muted small">Accept adds it to the CRM activity log, credited to {it.author}. Reject keeps it in the RTD only.</p>
              </>
            ) : (
              <>
                <ul className="changes">{changeLines(it, cats).map((l) => <li key={l}>{l}</li>)}</ul>
                {conflicts.length > 0 && (
                  <div className="conflict">
                    <b>Changed in the CRM since this was proposed:</b>
                    <ul>
                      {conflicts.map((k) => (
                        <li key={k}>{FIELD_LABEL[k] ?? k} is now {showValue(k, it.current?.[k], cats)} (they saw {showValue(k, it.old_value?.[k], cats)})</li>
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
          <h2>Reviewing in Excel?</h2>
          <p className="muted">Download the sheet, type Accept, Reject or Leave in the Decision column (Yes under &quot;Accept anyway&quot; to override a conflict or duplicate), then upload it here.</p>
          <ImportForm />
        </section>
      )}
    </>
  );
}
