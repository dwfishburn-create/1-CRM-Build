"use client";

import { startTransition, useActionState, useState, type ReactNode } from "react";
import { decide, importDecisions, type DecideResult, type ImportResult } from "./actions";

// One Sync to CRM item's buttons: Add to CRM / Keep in RTD only / Later. When
// the database says "conflict" or "duplicate", the item stays and offers the
// override (Add anyway / link to the existing person or company / create new).

export function ReviewItem({
  type, id, kind, conflict, children,
}: {
  type: "note" | "change"; id: string; kind: string; conflict: boolean; children: ReactNode;
}) {
  const [state, act, pending] = useActionState<DecideResult, FormData>(decide, null);
  const [left, setLeft] = useState(false);

  function send(decision: string, extra: Record<string, string> = {}) {
    if (decision === "leave") { setLeft(true); return; }
    const fd = new FormData();
    fd.set("type", type);
    fd.set("id", id);
    fd.set("decision", decision);
    for (const [k, v] of Object.entries(extra)) fd.set(k, v);
    startTransition(() => act(fd));
  }

  if (state?.ok && state.status !== "left") return null; // added or kept — the page refreshes without it
  const dup = state?.status === "duplicate";
  const conf = conflict || state?.status === "conflict";

  return (
    <div className={left ? "card qitem left" : "card qitem"}>
      {children}
      {!pending && state && !state.ok && state.message && <p className="error" role="alert">{state.message}</p>}
      {dup && state?.matches && (
        <ul className="changes">
          {state.matches.map((m) => (
            <li key={m.id}>
              {m.name}{m.display_code ? ` (${m.display_code})` : ""}{m.email ? ` · ${m.email}` : ""} — {m.reason}
              {kind === "new_contact" && (
                <button className="btn btn-outline btn-sm" disabled={pending} onClick={() => send("accept", { link_contact_id: m.id })}>
                  Same person — link to this brand
                </button>
              )}
              {kind === "new_requirement" && (
                <button className="btn btn-outline btn-sm" disabled={pending} onClick={() => send("accept", { link_contact_id: m.id })}>
                  Same company — use it
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="qbuttons">
        {dup ? (
          <button className="btn btn-primary" disabled={pending} onClick={() => send("accept", { force: "1" })}>
            {kind === "new_contact" ? "Different person — create" : "Different company — create"}
          </button>
        ) : (
          <button className="btn btn-primary" disabled={pending} onClick={() => send("accept", conf ? { force: "1" } : {})}>
            {pending ? "Saving…" : conf ? "Add anyway" : "Add to CRM"}
          </button>
        )}
        <button className="btn btn-outline" disabled={pending} onClick={() => send("keep")}>Keep in RTD only</button>
        {!left && <button className="btn btn-quiet" disabled={pending} onClick={() => send("leave")}>Later</button>}
        {left && <span className="muted-inline">Left for later</span>}
      </div>
    </div>
  );
}

export function ImportForm() {
  const [state, act, pending] = useActionState<ImportResult, FormData>(importDecisions, null);
  return (
    <form
      className="importform"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        startTransition(() => act(fd));
      }}
    >
      <label className="field">Upload the filled-in sheet
        <input type="file" name="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required />
      </label>
      <button className="btn btn-outline" disabled={pending}>{pending ? "Applying…" : "Apply decisions"}</button>
      {state?.error && <p className="error" role="alert">{state.error}</p>}
      {state?.ok && <ul className="okmsg">{state.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>}
    </form>
  );
}
