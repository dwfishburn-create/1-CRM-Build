import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/supabase";
import { EXPANSION, FACILITY, MARKETS, marketLabel, sf, sizeRange } from "@/lib/search";
import {
  categoryMap, changeLines, changeTitle, day, DRIVE_THRU, NOTE_TAGS, OPERATING, REQ_STATUS, when, type BrandActivity,
} from "@/lib/rtd";
import { ActionForm } from "@/app/_components/ActionForm";
import {
  addContact, addNote, claimBrand, contactLeft, markVerified, proposeEdit, releaseBrand, updateContact,
} from "@/app/actions";

type Contact = {
  contact_id: string; name: string; title: string | null; email: string | null;
  phone: string | null; mobile: string | null; role: string | null; is_current: boolean; ended_on: string | null;
};
type Requirement = {
  id: string; display_code: string; deal_type: string | null; property_type: string | null;
  size_min: number | null; size_max: number | null; target_markets: string[] | null; timeline: string | null;
  status: string; confidence: string | null; source_date: string | null; reconfirm_date: string | null;
};
type Brand = {
  entity_id: string; display_code: string; name: string; trade_name: string | null; website: string | null;
  category: string | null; category_label: string | null; category_detail: string | null;
  size_min_sf: number | null; size_max_sf: number | null; frontage_min_ft: number | null;
  drive_thru: string | null; facility_types: string[]; site_criteria: string | null;
  operating_model: string | null; expansion_status: string; target_markets: string[];
  needs_verification: boolean; last_verified_on: string | null; verification_note: string | null;
  profile_notes: string | null; source_system: string | null; metro_locations: number;
  contacts: Contact[]; requirements: Requirement[];
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function BrandPage({ params }: PageProps<"/brands/[id]">) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const supabase = await db();
  const [{ data, error }, act, cats] = await Promise.all([
    supabase.rpc("rtd_brand", { p_entity_id: id }),
    supabase.rpc("rtd_brand_activity", { p_entity_id: id }),
    categoryMap(),
  ]);
  if (error) return <p className="error">Couldn&apos;t load this brand: {error.message}</p>;
  if (!data) notFound();
  const b = data as Brand;
  const a = (act.data ?? { me: { is_admin: false, display_name: "" }, claim: null, notes: [], pending: [], history: [], verified_by: null }) as BrandActivity;
  const isAdmin = a.me.is_admin;
  const current = b.contacts.filter((c) => c.is_current);
  const former = b.contacts.filter((c) => !c.is_current);
  const website = b.website ? (b.website.startsWith("http") ? b.website : `https://${b.website}`) : null;
  const claim = a.claim;
  const goesWhere = isAdmin ? "Saves straight to the CRM." : "Goes to Dan for review; everyone sees it here as proposed until then.";

  return (
    <>
      <Link href="/" className="backlink">← Back to search</Link>

      <header className="brandhead">
        <div className="stack" style={{ gap: 6 }}>
          <div className="eyebrow">{b.display_code} · {b.category_label ?? "No category"}</div>
          <h1>{b.name}</h1>
          {(b.trade_name || website) && (
            <div className="muted">
              {b.trade_name && <>d/b/a {b.trade_name}{website ? " · " : ""}</>}
              {website && <a href={website} target="_blank" rel="noopener noreferrer">{b.website}</a>}
            </div>
          )}
        </div>

        <div className={claim ? "claimcard claimed" : "claimcard"}>
          {claim ? (
            <>
              <span className="k">Client</span>
              <b>{claim.holder}{claim.holder_is_me ? " (you)" : ""}</b>
              <span className="s">since {day(claim.since)}{claim.auto ? " · active CRM project" : ""}</span>
              {!claim.auto && (claim.holder_is_me || isAdmin) && (
                <ActionForm action={releaseBrand} submitLabel="Release claim" submitClass="btn btn-quiet" resetOnOk={false}
                  confirm={`Release ${b.name}? It will no longer show as ${claim.holder_is_me ? "your" : `${claim.holder}'s`} client.`}>
                  <input type="hidden" name="entity_id" value={b.entity_id} />
                </ActionForm>
              )}
            </>
          ) : (
            <>
              <span className="k">Not claimed</span>
              <ActionForm action={claimBrand} submitLabel="Claim as my client" submitClass="btn btn-amber" resetOnOk={false}>
                <input type="hidden" name="entity_id" value={b.entity_id} />
              </ActionForm>
              <span className="s">Honor system — a label, not a lock.</span>
            </>
          )}
        </div>
      </header>

      <div className="facts">
        <div className="fact"><span className="k">Size</span><span className="v mono">{sizeRange(b.size_min_sf, b.size_max_sf)}{b.size_min_sf != null || b.size_max_sf != null ? " SF" : ""}</span></div>
        <div className="fact"><span className="k">Expansion</span><span className="v">{EXPANSION[b.expansion_status] ?? b.expansion_status}</span></div>
        <div className="fact"><span className="k">Target markets</span><span className="v">{b.target_markets.length ? b.target_markets.map(marketLabel).join(", ") : "Not set"}</span></div>
        <div className={b.needs_verification ? "fact warn" : "fact"}>
          <span className="k">Freshness</span>
          <span className="v">{b.needs_verification ? (b.last_verified_on ? "Unverified" : "Never verified") : "Verified"}</span>
          <span className="s">
            {b.last_verified_on
              ? `Last checked ${day(b.last_verified_on)}${a.verified_by ? ` by ${a.verified_by}` : ""}`
              : b.source_system === "realnex" ? "From RealNex, 10/13/2026" : ""}
          </span>
          <details className="inline">
            <summary>Still current?</summary>
            <ActionForm action={markVerified} submitLabel="Yes — mark it current" submitClass="btn btn-outline btn-sm">
              <input type="hidden" name="entity_id" value={b.entity_id} />
              <label className="field">How do you know? (optional)
                <input name="note" placeholder="Talked to Jeff 10/19" maxLength={500} />
              </label>
            </ActionForm>
          </details>
        </div>
      </div>

      {a.pending.length > 0 && (
        <section className="stack">
          <h2>Proposed — waiting for Dan</h2>
          {a.pending.map((c) => (
            <div className="card proposed" key={c.id}>
              <div><b>{changeTitle(c)}</b> <span className="muted-inline">· {c.author}, {when(c.created_at)}</span></div>
              <ul className="changes">{changeLines(c, cats).map((l) => <li key={l}>{l}</li>)}</ul>
            </div>
          ))}
        </section>
      )}

      <div className="cols">
        <section className="col-main">
          <h2>Intel notes</h2>
          <div className="card">
            <ActionForm action={addNote} submitLabel="Save note" className="aform">
              <input type="hidden" name="entity_id" value={b.entity_id} />
              <div className="chips" role="group" aria-label="Tags">
                {NOTE_TAGS.map((t) => (
                  <label key={t} className="chip"><input type="checkbox" name="tags" value={t} /><span>{t}</span></label>
                ))}
              </div>
              <label className="field">What did you hear?
                <textarea name="body" rows={3} required maxLength={4000} placeholder="Met their RE manager at ICSC — looking for 2 more Omaha stores, 2,000–2,400 SF, endcaps with drive-thru." />
              </label>
            </ActionForm>
          </div>
          {a.notes.length === 0 ? (
            <div className="empty">No intel notes yet.</div>
          ) : (
            a.notes.map((n) => (
              <div className="card note" key={n.id}>
                <div className="notehead">
                  <b>{n.author}</b>
                  <span className="muted-inline">{when(n.created_at)}</span>
                  {n.status === "accepted" && <span className="pill pill-fit">In CRM</span>}
                  {n.status === "pending" && <span className="pill pill-plain">Waiting for Dan</span>}
                  {n.status === "rejected" && <span className="pill pill-plain">RTD only</span>}
                </div>
                {n.tags.length > 0 && <div className="tags">{n.tags.map((t) => <span key={t} className="pill pill-tag">{t}</span>)}</div>}
                <p>{n.body}</p>
              </div>
            ))
          )}

          <h2>Site profile</h2>
          <div className="card stack">
            <div className="tags">
              {b.category_detail && <span className="pill pill-plain">{b.category_detail}</span>}
              {b.drive_thru && <span className="pill pill-plain">Drive-thru: {DRIVE_THRU[b.drive_thru] ?? b.drive_thru}</span>}
              {b.frontage_min_ft != null && <span className="pill pill-plain">Frontage {sf(b.frontage_min_ft)} ft+</span>}
              {b.operating_model && <span className="pill pill-plain">{OPERATING[b.operating_model] ?? b.operating_model}</span>}
              {b.facility_types.map((f) => <span key={f} className="pill pill-plain">{FACILITY[f] ?? f}</span>)}
            </div>
            <p>{b.site_criteria || <span className="muted">No site criteria on file.</span>}</p>
            <details className="editbox">
              <summary>Edit the profile</summary>
              <p className="muted small">{goesWhere}</p>
              <ActionForm action={proposeEdit} submitLabel={isAdmin ? "Save changes" : "Send to Dan"} className="aform grid2" resetOnOk={false}>
                <input type="hidden" name="entity_id" value={b.entity_id} />
                <label className="field">Size min (SF)<input name="size_min_sf" inputMode="numeric" defaultValue={b.size_min_sf ?? ""} /></label>
                <label className="field">Size max (SF)<input name="size_max_sf" inputMode="numeric" defaultValue={b.size_max_sf ?? ""} /></label>
                <label className="field">Expansion
                  <select name="expansion_status" defaultValue={b.expansion_status}>
                    {Object.entries(EXPANSION).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </label>
                <label className="field">Category
                  <select name="category" defaultValue={b.category ?? ""}>
                    <option value="">No category</option>
                    {[...cats.entries()].map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </label>
                <label className="field">Category detail<input name="category_detail" defaultValue={b.category_detail ?? ""} /></label>
                <label className="field">Drive-thru
                  <select name="drive_thru" defaultValue={b.drive_thru ?? ""}>
                    <option value="">Not on file</option>
                    {Object.entries(DRIVE_THRU).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </label>
                <label className="field">Frontage min (ft)<input name="frontage_min_ft" inputMode="numeric" defaultValue={b.frontage_min_ft ?? ""} /></label>
                <label className="field">Operating model
                  <select name="operating_model" defaultValue={b.operating_model ?? ""}>
                    <option value="">Not on file</option>
                    {Object.entries(OPERATING).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </label>
                <label className="field span2">Website<input name="website" defaultValue={b.website ?? ""} /></label>
                <fieldset className="field span2 boxes">
                  <legend>Target markets</legend>
                  <input type="hidden" name="target_markets__present" value="1" />
                  {MARKETS.map((m) => (
                    <label key={m.code} className="check"><input type="checkbox" name="target_markets" value={m.code} defaultChecked={b.target_markets.includes(m.code)} /> {m.label}</label>
                  ))}
                </fieldset>
                <fieldset className="field span2 boxes">
                  <legend>Facility types</legend>
                  <input type="hidden" name="facility_types__present" value="1" />
                  {Object.entries(FACILITY).map(([k, v]) => (
                    <label key={k} className="check"><input type="checkbox" name="facility_types" value={k} defaultChecked={b.facility_types.includes(k)} /> {v}</label>
                  ))}
                </fieldset>
                <label className="field span2">Site criteria<textarea name="site_criteria" rows={4} defaultValue={b.site_criteria ?? ""} /></label>
              </ActionForm>
            </details>
          </div>

          <div className="resultshead">
            <h2>Requirements</h2>
            <Link className="btn btn-outline btn-sm" href={`/requirements/new?brand=${b.entity_id}`}>Add a requirement</Link>
          </div>
          {b.requirements.length === 0 ? (
            <div className="empty">No requirements shared for this brand.</div>
          ) : (
            b.requirements.map((r) => (
              <div className="card" key={r.id}>
                <Link className="name" href={`/requirements/${r.id}`}><b>{r.display_code}</b></Link>
                {" "}· {[r.deal_type, r.property_type].filter(Boolean).join(" ")} · {REQ_STATUS[r.status] ?? r.status}{r.confidence ? ` · ${r.confidence} confidence` : ""}
                <div className="muted">
                  {sizeRange(r.size_min, r.size_max)} SF
                  {r.target_markets?.length ? ` · ${r.target_markets.map(marketLabel).join(", ")}` : ""}
                  {r.timeline ? ` · ${r.timeline}` : ""}
                </div>
                <div className="muted">Heard {day(r.source_date) || "—"}{r.reconfirm_date ? ` · re-confirm ${day(r.reconfirm_date)}` : ""}</div>
              </div>
            ))
          )}

          {b.profile_notes && (
            <>
              <h2>Profile notes</h2>
              <div className="card"><p>{b.profile_notes}</p></div>
            </>
          )}

          {a.history.length > 0 && (
            <>
              <h2>History</h2>
              <div className="card history">
                {a.history.map((h, i) => (
                  <div className="hrow" key={i}>
                    <div>
                      <b>{changeTitle(h)}</b>
                      {h.status === "rejected" && <span className="pill pill-plain">Not accepted</span>}
                      <span className="muted-inline"> · {h.author}, {when(h.at)}
                        {h.reviewed_by && h.reviewed_by !== h.author ? ` · accepted by ${h.reviewed_by}` : ""}
                        {h.result_ref ? ` · ${h.result_ref}` : ""}</span>
                    </div>
                    {changeLines(h, cats).length > 0 && (
                      <ul className="changes">{changeLines(h, cats).map((l) => <li key={l}>{l}</li>)}</ul>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </section>

        <aside className="col-side">
          <h2>Contacts</h2>
          <div className="card">
            {current.length === 0 && former.length === 0 && <p className="muted">No contacts on file.</p>}
            {current.map((c) => {
              return (
                <div className="person" key={c.contact_id + "c"}>
                  <b>{c.name || "(no name)"}</b>
                  <span className="muted">{[c.title, c.role && c.role !== c.title ? c.role : null].filter(Boolean).join(" · ") || "Current"}</span>
                  {c.email && <a href={`mailto:${c.email}`}>{c.email}</a>}
                  {(c.phone || c.mobile) && <a href={`tel:${(c.mobile || c.phone || "").replace(/[^0-9+]/g, "")}`}>{c.mobile || c.phone}</a>}
                  <details className="inline">
                    <summary>Update or mark gone</summary>
                    <ActionForm action={updateContact} submitLabel={isAdmin ? "Save" : "Send to Dan"} submitClass="btn btn-outline btn-sm" resetOnOk={false}>
                      <input type="hidden" name="entity_id" value={b.entity_id} />
                      <input type="hidden" name="contact_id" value={c.contact_id} />
                      <label className="field">Title<input name="title" defaultValue={c.title ?? ""} /></label>
                      <label className="field">Email<input name="email" type="email" defaultValue={c.email ?? ""} /></label>
                      <label className="field">Phone<input name="phone" type="tel" defaultValue={c.phone ?? ""} /></label>
                      <label className="field">Mobile<input name="mobile_phone" type="tel" defaultValue={c.mobile ?? ""} /></label>
                    </ActionForm>
                    <ActionForm action={contactLeft} submitLabel="No longer there" submitClass="btn btn-quiet btn-sm"
                      confirm={`Mark ${c.name} as no longer at ${b.name}?`}>
                      <input type="hidden" name="entity_id" value={b.entity_id} />
                      <input type="hidden" name="contact_id" value={c.contact_id} />
                      <label className="field">Where did they go? (optional)<input name="note" maxLength={500} /></label>
                    </ActionForm>
                  </details>
                </div>
              );
            })}
            {former.map((c) => (
              <div className="person former" key={c.contact_id + "f"}>
                <b>{c.name}</b>
                <span>{c.title ? `${c.title} · ` : ""}former{c.ended_on ? `, left ${day(c.ended_on)}` : ""}</span>
              </div>
            ))}
          </div>
          <details className="card editbox">
            <summary>Add a contact</summary>
            <p className="muted small">{goesWhere}</p>
            <ActionForm action={addContact} submitLabel={isAdmin ? "Add contact" : "Send to Dan"}>
              <input type="hidden" name="entity_id" value={b.entity_id} />
              <label className="field">First name<input name="first_name" autoComplete="off" /></label>
              <label className="field">Last name<input name="last_name" autoComplete="off" /></label>
              <label className="field">Title<input name="title" placeholder="Director of Real Estate" /></label>
              <label className="field">Email<input name="email" type="email" /></label>
              <label className="field">Phone<input name="phone" type="tel" /></label>
              <label className="field">Mobile<input name="mobile_phone" type="tel" /></label>
              <label className="field">Role
                <select name="role" defaultValue="">
                  <option value="">Brand employee</option>
                  <option value="Tenant Rep Broker">Tenant rep broker</option>
                  <option value="Franchisee">Franchisee</option>
                </select>
              </label>
            </ActionForm>
          </details>
          <div className="card">
            <span className="muted">Locations in Dan&apos;s markets on file: </span><b>{b.metro_locations}</b>
          </div>
        </aside>
      </div>
    </>
  );
}
