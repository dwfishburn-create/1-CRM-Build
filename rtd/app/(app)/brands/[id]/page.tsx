import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/supabase";
import { EXPANSION, FACILITY, marketLabel, sf, sizeRange } from "@/lib/search";

type Contact = {
  contact_id: string; name: string; title: string | null; email: string | null;
  phone: string | null; mobile: string | null; role: string | null; is_current: boolean; ended_on: string | null;
};
type Requirement = {
  display_code: string; deal_type: string | null; property_type: string | null;
  size_min: number | null; size_max: number | null; target_markets: string[] | null; timeline: string | null;
  status: string; confidence: string | null; source_date: string | null; reconfirm_date: string | null;
};
type Brand = {
  entity_id: string; display_code: string; name: string; trade_name: string | null; website: string | null;
  category_label: string | null; category_detail: string | null;
  size_min_sf: number | null; size_max_sf: number | null; frontage_min_ft: number | null;
  drive_thru: string | null; facility_types: string[]; site_criteria: string | null;
  operating_model: string | null; expansion_status: string; target_markets: string[];
  needs_verification: boolean; last_verified_on: string | null; verification_note: string | null;
  profile_notes: string | null; source_system: string | null; metro_locations: number;
  contacts: Contact[]; requirements: Requirement[];
};

function date(d: string | null): string {
  return d ? new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function BrandPage({ params }: PageProps<"/brands/[id]">) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const supabase = await db();
  const { data, error } = await supabase.rpc("rtd_brand", { p_entity_id: id });
  if (error) return <p className="error">Couldn&apos;t load this brand: {error.message}</p>;
  if (!data) notFound();
  const b = data as Brand;
  const current = b.contacts.filter((c) => c.is_current);
  const former = b.contacts.filter((c) => !c.is_current);
  const website = b.website ? (b.website.startsWith("http") ? b.website : `https://${b.website}`) : null;

  return (
    <>
      <Link href="/" style={{ fontSize: 14, textDecoration: "none" }}>← Back to search</Link>

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
      </header>

      <div className="facts">
        <div className="fact"><span className="k">Size</span><span className="v mono">{sizeRange(b.size_min_sf, b.size_max_sf)}{b.size_min_sf != null || b.size_max_sf != null ? " SF" : ""}</span></div>
        <div className="fact"><span className="k">Expansion</span><span className="v">{EXPANSION[b.expansion_status] ?? b.expansion_status}</span></div>
        <div className="fact"><span className="k">Target markets</span><span className="v">{b.target_markets.length ? b.target_markets.map(marketLabel).join(", ") : "Not set"}</span></div>
        <div className={b.needs_verification ? "fact warn" : "fact"}>
          <span className="k">Freshness</span>
          <span className="v">{b.needs_verification ? (b.last_verified_on ? "Unverified" : "Never verified") : "Verified"}</span>
          <span className="s">
            {b.last_verified_on ? `Last checked ${date(b.last_verified_on)}` : b.source_system === "realnex" ? "From RealNex, 10/13/2026" : ""}
          </span>
        </div>
      </div>

      <div className="cols">
        <section className="col-main">
          <h2>Site profile</h2>
          <div className="card stack">
            <div className="tags">
              {b.category_detail && <span className="pill pill-plain">{b.category_detail}</span>}
              {b.drive_thru && <span className="pill pill-plain">Drive-thru: {b.drive_thru}</span>}
              {b.frontage_min_ft != null && <span className="pill pill-plain">Frontage {sf(b.frontage_min_ft)} ft+</span>}
              {b.operating_model && <span className="pill pill-plain">{b.operating_model === "both" ? "Corporate + franchise" : b.operating_model}</span>}
              {b.facility_types.map((f) => <span key={f} className="pill pill-plain">{FACILITY[f] ?? f}</span>)}
            </div>
            <p>{b.site_criteria || <span className="muted">No site criteria on file.</span>}</p>
          </div>

          <h2>Requirements</h2>
          {b.requirements.length === 0 ? (
            <div className="empty">No requirements on file for this brand.</div>
          ) : (
            b.requirements.map((r) => (
              <div className="card" key={r.display_code}>
                <b>{r.display_code}</b> · {r.status}{r.confidence ? ` · ${r.confidence} confidence` : ""}
                <div className="muted">
                  {sizeRange(r.size_min, r.size_max)} SF
                  {r.target_markets?.length ? ` · ${r.target_markets.map(marketLabel).join(", ")}` : ""}
                  {r.timeline ? ` · ${r.timeline}` : ""}
                </div>
                <div className="muted">Source {date(r.source_date)} · re-confirm {date(r.reconfirm_date)}</div>
              </div>
            ))
          )}

          {b.profile_notes && (
            <>
              <h2>Profile notes</h2>
              <div className="card"><p>{b.profile_notes}</p></div>
            </>
          )}

          <div className="soon">Intel notes, Claim and edits arrive in the next RTD build.</div>
        </section>

        <aside className="col-side">
          <h2>Contacts</h2>
          <div className="card">
            {current.length === 0 && former.length === 0 && <p className="muted">No contacts on file.</p>}
            {current.map((c) => (
              <div className="person" key={c.contact_id + "c"}>
                <b>{c.name || "(no name)"}</b>
                <span className="muted">{[c.title, c.role && c.role !== c.title ? c.role : null].filter(Boolean).join(" · ") || "Current"}</span>
                {c.email && <a href={`mailto:${c.email}`}>{c.email}</a>}
                {(c.phone || c.mobile) && <a href={`tel:${(c.mobile || c.phone || "").replace(/[^0-9+]/g, "")}`}>{c.mobile || c.phone}</a>}
              </div>
            ))}
            {former.map((c) => (
              <div className="person former" key={c.contact_id + "f"}>
                <b>{c.name}</b>
                <span>{c.title ? `${c.title} · ` : ""}former{c.ended_on ? `, left ${date(c.ended_on)}` : ""}</span>
              </div>
            ))}
          </div>
          <div className="card">
            <span className="muted">Locations in Dan&apos;s markets on file: </span><b>{b.metro_locations}</b>
          </div>
        </aside>
      </div>
    </>
  );
}
