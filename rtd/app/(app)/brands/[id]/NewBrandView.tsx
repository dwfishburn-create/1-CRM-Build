import Link from "next/link";
import { getMe } from "@/lib/supabase";
import { EXPANSION, FACILITY, marketLabel, sizeRange } from "@/lib/search";
import { DRIVE_THRU, shortDay } from "@/lib/rtd";
import { ActionForm } from "@/app/_components/ActionForm";
import { CrmMark } from "@/app/_components/Marks";
import { undoChange } from "@/app/actions";

// A brand someone added in the RTD that isn't in Dan's CRM yet (030). It's in
// the directory for everyone; notes, contacts and claims open once it has a CRM
// record, because those all hang off that record.

type NewBrand = {
  change_id: string; name: string; added_by: string; added_at: string; status: string; can_undo: boolean;
  category_label: string | null; size_min_sf: number | null; size_max_sf: number | null;
  expansion_status?: string; target_markets?: string[]; drive_thru?: string | null;
  facility_types?: string[]; site_criteria?: string | null; website?: string | null;
};

export async function NewBrandView({ b }: { b: NewBrand }) {
  const me = await getMe();
  const isAdmin = !!me?.is_admin;
  const markets = b.target_markets ?? [];
  return (
    <>
      <Link href="/brands" className="backlink">← All brands</Link>
      <header className="brandhead">
        <div className="stack" style={{ gap: 6 }}>
          <div className="eyebrow">New · {b.category_label ?? "No category"}</div>
          <h1>{b.name}</h1>
          <p className="muted">Added by {b.added_by}, {shortDay(b.added_at)} <CrmMark isAdmin={isAdmin} status={b.status} /></p>
        </div>
        {b.can_undo && (
          <ActionForm action={undoChange} submitLabel="Undo — take it out" submitClass="btn btn-quiet" resetOnOk={false}
            confirm={`Take ${b.name} out of the directory for everyone?`}>
            <input type="hidden" name="change_id" value={b.change_id} />
            <input type="hidden" name="back" value="/brands" />
          </ActionForm>
        )}
      </header>
      <div className="facts">
        <div className="fact"><span className="k">Size</span><span className="v mono">{sizeRange(b.size_min_sf, b.size_max_sf)}{b.size_min_sf != null || b.size_max_sf != null ? " SF" : ""}</span></div>
        <div className="fact"><span className="k">Expansion</span><span className="v">{EXPANSION[b.expansion_status ?? "unknown"] ?? b.expansion_status}</span></div>
        <div className="fact"><span className="k">Target markets</span><span className="v">{markets.length ? markets.map(marketLabel).join(", ") : "Not set"}</span></div>
      </div>
      <div className="card stack">
        <div className="tags">
          {b.drive_thru && <span className="pill pill-plain">Drive-thru: {DRIVE_THRU[b.drive_thru] ?? b.drive_thru}</span>}
          {(b.facility_types ?? []).map((f) => <span key={f} className="pill pill-plain">{FACILITY[f] ?? f}</span>)}
        </div>
        <p>{b.site_criteria || <span className="muted">No site criteria yet.</span>}</p>
        {b.website && <p className="muted">{b.website}</p>}
      </div>
      <p className="muted small">
        Notes, contacts and claims for {b.name} open once it has its CRM record{isAdmin ? " — add it from Sync to CRM." : "."}
      </p>
    </>
  );
}
