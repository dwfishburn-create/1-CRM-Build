import { MARKETS } from "@/lib/search";
import { CONFIDENCE, DEAL_TYPES, PROPERTY_TYPES, REQ_STATUS, todayCentral, type Requirement } from "@/lib/rtd";

// The requirement inputs shared by Add (/requirements/new) and Edit
// (/requirements/[id]). Property and deal type are free text with suggestions,
// like the CRM. No re-confirm date: the RTD never sets one (Dan, 10/20/2026).

export function RequirementFields({ r, showStatus }: { r?: Partial<Requirement>; showStatus?: boolean }) {
  const today = todayCentral();
  return (
    <>
      <label className="field">Property type
        <input name="property_type" list="rtd-property-types" required defaultValue={r?.property_type ?? ""} placeholder="Retail, Office, Industrial…" />
      </label>
      <datalist id="rtd-property-types">{PROPERTY_TYPES.map((t) => <option key={t} value={t} />)}</datalist>
      <label className="field">Deal type
        <input name="deal_type" list="rtd-deal-types" defaultValue={r?.deal_type ?? ""} placeholder="Lease, Buy…" />
      </label>
      <datalist id="rtd-deal-types">{DEAL_TYPES.map((t) => <option key={t} value={t} />)}</datalist>
      <label className="field">Size min (SF)<input name="size_min" inputMode="numeric" defaultValue={r?.size_min ?? ""} /></label>
      <label className="field">Size max (SF)<input name="size_max" inputMode="numeric" defaultValue={r?.size_max ?? ""} /></label>
      <label className="field">Budget min ($)<input name="budget_min" inputMode="numeric" defaultValue={r?.budget_min ?? ""} /></label>
      <label className="field">Budget max ($)<input name="budget_max" inputMode="numeric" defaultValue={r?.budget_max ?? ""} /></label>
      <label className="field span2">Location / submarket<input name="target_location" defaultValue={r?.target_location ?? ""} placeholder="West Omaha, Sarpy County, I-80 corridor…" /></label>
      <label className="field">Timeline<input name="timeline" defaultValue={r?.timeline ?? ""} placeholder="Q2 2027, ASAP…" /></label>
      <label className="field">Confidence
        <select name="confidence" defaultValue={r?.confidence ?? ""}>
          <option value="">Not sure</option>
          {Object.entries(CONFIDENCE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </label>
      <label className="field">Heard on<input name="source_date" type="date" max={today} defaultValue={r?.source_date ?? (r ? "" : today)} /></label>
      {showStatus && (
        <label className="field">Status
          <select name="status" defaultValue={r?.status ?? "active"}>
            {Object.entries(REQ_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
      )}
      <fieldset className="field span2 boxes">
        <legend>Markets</legend>
        <input type="hidden" name="target_markets__present" value="1" />
        {MARKETS.map((m) => (
          <label key={m.code} className="check"><input type="checkbox" name="target_markets" value={m.code} defaultChecked={(r?.target_markets ?? []).includes(m.code)} /> {m.label}</label>
        ))}
      </fieldset>
      <label className="field span2">Who to call<input name="rtd_contact" defaultValue={r?.rtd_contact ?? ""} placeholder="Jeff Hanson, 402-555-1212" /></label>
      <label className="field span2">Note (Jami, Trey and Dan all see this)
        <textarea name="rtd_note" rows={3} maxLength={2000} defaultValue={r?.rtd_note ?? ""} />
      </label>
    </>
  );
}
