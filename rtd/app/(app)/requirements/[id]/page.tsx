import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/supabase";
import { marketLabel, sizeRange } from "@/lib/search";
import {
  budgetRange, changeLines, CONFIDENCE, day, REQ_STATUS, todayCentral, updatedBy, when,
  type Change, type FieldUpdates, type Requirement,
} from "@/lib/rtd";
import { overdue } from "@/lib/requirements";
import { ActionForm } from "@/app/_components/ActionForm";
import { CrmMark, UpdatedBy } from "@/app/_components/Marks";
import { undoChange, updateRequirement } from "@/app/actions";
import { RequirementFields } from "../RequirementFields";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Detail = Requirement & {
  me: { is_admin: boolean };
  created_at: string;
  history: Change[];
  field_updates: FieldUpdates;
  can_undo?: boolean;
};

export default async function RequirementPage({ params }: PageProps<"/requirements/[id]">) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const supabase = await db();
  const { data, error } = await supabase.rpc("rtd_requirement", { p_id: id });
  if (error) return <p className="error">Couldn&apos;t load this requirement: {error.message}</p>;
  if (!data) notFound();
  const r = data as Detail;
  const isAdmin = r.me.is_admin;
  const late = overdue(r, todayCentral());
  const fu = r.field_updates ?? {};
  const origin = r.added_by ? `Added by ${r.added_by}` : "Shared from Dan's CRM";

  return (
    <>
      <Link href="/requirements" className="backlink">← Requirements</Link>
      <header className="brandhead">
        <div className="stack" style={{ gap: 6 }}>
          <div className="eyebrow">{r.rtd_only ? "New" : r.display_code} · {origin.toLowerCase()}</div>
          <h1>{r.party}</h1>
          <p className="muted">
            {[r.deal_type, r.property_type].filter(Boolean).join(" · ") || "Requirement"}
            {r.entity_id && r.is_brand && <> · <Link href={`/brands/${r.entity_id}`}>Brand page</Link></>}
          </p>
        </div>
        <span className={r.status === "active" ? "pill pill-fit big" : "pill pill-plain big"}>{REQ_STATUS[r.status] ?? r.status}</span>
      </header>

      <div className="facts">
        <div className="fact"><span className="k">Size</span><span className="v mono">{sizeRange(r.size_min, r.size_max)}{r.size_min != null || r.size_max != null ? " SF" : ""}</span>
          <UpdatedBy u={updatedBy(fu, ["size_min", "size_max"])} isAdmin={isAdmin} /></div>
        <div className="fact"><span className="k">Budget</span><span className="v">{budgetRange(r.budget_min, r.budget_max) || "Not set"}</span>
          <UpdatedBy u={updatedBy(fu, ["budget_min", "budget_max"])} isAdmin={isAdmin} /></div>
        <div className="fact">
          <span className="k">Where</span>
          <span className="v">{r.target_location || (r.target_markets.length ? r.target_markets.map(marketLabel).join(", ") : "Not set")}</span>
          {r.target_location && r.target_markets.length > 0 && <span className="s">{r.target_markets.map(marketLabel).join(", ")}</span>}
        </div>
        <div className={late ? "fact warn" : "fact"}>
          <span className="k">Heard</span>
          <span className="v">{day(r.source_date) || "—"}</span>
          <span className="s">
            {[r.confidence ? `${CONFIDENCE[r.confidence]} confidence` : null, r.timeline ? `Timeline: ${r.timeline}` : null].filter(Boolean).join(" · ")}
            {r.reconfirm_date && <><br />{late ? "Re-confirm overdue — " : "Re-confirm by "}{day(r.reconfirm_date)}</>}
          </span>
        </div>
      </div>

      <div className="cols">
        <section className="col-main">
          <h2>Note</h2>
          <div className="card stack">
            <p>{r.rtd_note || <span className="muted">No note yet.</span>}</p>
            {r.rtd_contact && <p><span className="muted">Who to call: </span>{r.rtd_contact}</p>}
            <UpdatedBy u={updatedBy(fu, ["rtd_note", "rtd_contact"])} isAdmin={isAdmin} />
          </div>

          <details className="card editbox">
            <summary>Update this requirement</summary>
            <p className="muted small">Everyone sees your changes right away.</p>
            <ActionForm action={updateRequirement} submitLabel="Save" className="aform grid2" resetOnOk={false}>
              <input type="hidden" name="requirement_id" value={r.id} />
              <RequirementFields r={r} showStatus />
            </ActionForm>
          </details>
        </section>

        <aside className="col-side">
          <h2>Recent updates</h2>
          <div className="card history">
            <div className="hrow">
              <div className="hhead">
                <b>{origin}</b>
                <span className="muted-inline">{when(r.shared_at ?? r.created_at)}</span>
                {isAdmin && r.not_in_crm && <span className="pill pill-crm">Not in CRM</span>}
                {r.rtd_only && r.can_undo && (
                  <ActionForm action={undoChange} submitLabel="Undo" submitClass="btn btn-quiet btn-xs" resetOnOk={false}
                    confirm="Take this requirement out of the RTD for everyone?">
                    <input type="hidden" name="change_id" value={r.id} />
                    <input type="hidden" name="back" value="/requirements" />
                  </ActionForm>
                )}
              </div>
            </div>
            {r.history.filter((h) => h.kind === "requirement_update").map((h, i) => (
              <div className="hrow" key={i}>
                <div className="hhead">
                  <b>{h.author}</b>
                  <span className="muted-inline">{when(h.at)}</span>
                  <CrmMark isAdmin={isAdmin} status={h.status} />
                  {h.can_undo && h.id && (
                    <ActionForm action={undoChange} submitLabel="Undo" submitClass="btn btn-quiet btn-xs" resetOnOk={false}
                      confirm="Undo this update for everyone?">
                      <input type="hidden" name="change_id" value={h.id} />
                    </ActionForm>
                  )}
                </div>
                <ul className="changes">{changeLines(h).map((l) => <li key={l}>{l}</li>)}</ul>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </>
  );
}
