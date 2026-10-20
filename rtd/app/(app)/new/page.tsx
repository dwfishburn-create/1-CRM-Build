import Link from "next/link";
import { db } from "@/lib/supabase";
import { dbMessage, KIND_LABEL, when } from "@/lib/rtd";

// What's new across the directory: intel notes, brands now expanding, new
// requirements, contacts added or gone, brands confirmed current, claims.

type Row = { at: string; kind: string; entity_id: string | null; brand: string; who: string | null; detail: string; status: string; requirement_id: string | null };

const RANGES = [7, 30, 90];
const GROUPS: { code: string; label: string; kinds: string[] }[] = [
  { code: "", label: "Everything", kinds: [] },
  { code: "intel", label: "Intel notes", kinds: ["note"] },
  { code: "moves", label: "Expansion & requirements", kinds: ["expanding", "requirement", "requirement_edit", "new_brand"] },
  { code: "people", label: "Contacts", kinds: ["new_contact", "contact_update", "contact_left"] },
  { code: "fresh", label: "Confirmed & edited", kinds: ["verified", "edit"] },
  { code: "claims", label: "Claims", kinds: ["claim", "release"] },
];

export default async function WhatsNew({ searchParams }: PageProps<"/new">) {
  const sp = await searchParams;
  const days = RANGES.includes(Number(sp.days)) ? Number(sp.days) : 30;
  const group = GROUPS.find((g) => g.code === sp.show) ?? GROUPS[0];
  const supabase = await db();
  const { data, error } = await supabase.rpc("rtd_whats_new", { p_days: days });
  const rows = ((data ?? []) as Row[]).filter((r) => group.kinds.length === 0 || group.kinds.includes(r.kind));

  const href = (d: number, s: string) => `/new?${new URLSearchParams({ ...(d !== 30 ? { days: String(d) } : {}), ...(s ? { show: s } : {}) })}`;

  return (
    <>
      <header className="stack" style={{ gap: 6 }}>
        <div className="eyebrow">Across the directory</div>
        <h1>What&apos;s new</h1>
      </header>

      <div className="filterbar">
        <div className="seg" role="group" aria-label="Period">
          {RANGES.map((d) => (
            <Link key={d} href={href(d, group.code)} aria-current={d === days ? "true" : undefined}>Last {d} days</Link>
          ))}
        </div>
        <div className="seg" role="group" aria-label="Show">
          {GROUPS.map((g) => (
            <Link key={g.code} href={href(days, g.code)} aria-current={g.code === group.code ? "true" : undefined}>{g.label}</Link>
          ))}
        </div>
      </div>

      {error && <p className="error">Couldn&apos;t load: {dbMessage(error.message)}</p>}
      {!error && rows.length === 0 && <div className="empty">Nothing in the last {days} days.</div>}
      {rows.length > 0 && (
        <ul className="feed">
          {rows.map((r, i) => (
            <li key={i} className={`feeditem k-${r.kind}`}>
              <span className="feedkind">{KIND_LABEL[r.kind] ?? r.kind}</span>
              <div className="feedbody">
                <div>
                  {r.requirement_id && r.status !== "pending"
                    ? <Link className="name" href={`/requirements/${r.requirement_id}`}>{r.brand}</Link>
                    : r.entity_id ? <Link className="name" href={`/brands/${r.entity_id}`}>{r.brand}</Link> : <b>{r.brand}</b>}
                  {r.status === "pending" && <span className="pill pill-plain">Waiting for Dan</span>}
                </div>
                <p>{r.detail}</p>
                <span className="muted-inline">{r.who ?? "CRM"} · {when(r.at)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
