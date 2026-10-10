import { supabase } from "@/lib/supabase";
import { contactOptions, todayCentral } from "@/lib/contactOptions";
import { ActionForm } from "@/app/_components/ActionForm";
import { contactHref, entityHref, personName } from "@/lib/records";
import {
  FEE_BASES,
  PARTICIPANT_ROLES,
  RESULTS,
  feeBasisLabel,
  missingFields,
  pct,
  resultLabel,
  roleLabel,
  usd,
} from "@/lib/pipeline";
import {
  addParticipantAction,
  addPaymentAction,
  receivePaymentAction,
  removeParticipantAction,
  removePaymentAction,
  savePipelineAction,
} from "./pipeline-actions";

// Pipeline on the deal page (Build #2, 10/10/2026).
//
// variant="prompt"  — the first-open setup card at the top of an active deal
//                     that hasn't been set up yet (10/6/2026: the app asks for
//                     your share, the other parties and their splits,
//                     probability and expected close the first time each
//                     active deal is opened). Renders nothing otherwise.
// variant="section" — the always-there Pipeline section further down: the
//                     numbers, Result, splits and commission payments.

type ProjectRow = {
  id: string;
  status: string;
  result: string;
  result_date: string | null;
  result_note: string | null;
  fee_basis: string | null;
  deal_price: number | null;
  commission_rate: number | null;
  deal_value: number | null;
  dan_share_pct: number | null;
  dan_share_value: number | null;
  probability_pct: number | null;
  expected_share_value: number | null;
  target_close_date: string | null;
  strategic_weight_note: string | null;
  pipeline_setup_at: string | null;
};

type Person = { id: string; first_name: string | null; last_name: string | null };
type Ent = { id: string; name: string };
type ParticipantRow = {
  id: string;
  party_name: string | null;
  role: string;
  split_pct: number | null;
  off_the_top: boolean;
  notes: string | null;
  contact: Person | Person[] | null;
  entity: Ent | Ent[] | null;
};
type PaymentRow = {
  id: string;
  label: string;
  amount: number | null;
  earned_date: string | null;
  due_note: string | null;
  invoiced_date: string | null;
  received_date: string | null;
  received_amount: number | null;
  notes: string | null;
};

function one<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  return Array.isArray(v) ? v[0] ?? null : v;
}

const input =
  "border border-gray-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 rounded px-3 py-2 w-full mt-1";
const btnSolid = "bg-blue-600 text-white rounded px-4 py-2 h-fit";
const btnPlain = "border border-gray-300 dark:border-neutral-700 rounded px-3 py-2 h-fit";
const cell = "py-2 pr-3";

export function needsSetup(p: Pick<ProjectRow, "status" | "result" | "pipeline_setup_at">): boolean {
  return p.status === "active" && p.result === "active" && !p.pipeline_setup_at;
}

async function load(projectId: string) {
  const [{ data: project }, { data: participants }, { data: payments }, { data: entities }, contacts] =
    await Promise.all([
      supabase
        .from("projects")
        .select(
          "id, status, result, result_date, result_note, fee_basis, deal_price, commission_rate, deal_value, dan_share_pct, dan_share_value, probability_pct, expected_share_value, target_close_date, strategic_weight_note, pipeline_setup_at"
        )
        .eq("id", projectId)
        .maybeSingle()
        .returns<ProjectRow | null>(),
      supabase
        .from("project_commission_participants")
        .select(
          "id, party_name, role, split_pct, off_the_top, notes, contact:contacts!contact_id(id, first_name, last_name), entity:entities!entity_id(id, name)"
        )
        .eq("project_id", projectId)
        .order("created_at", { ascending: true })
        .returns<ParticipantRow[]>(),
      supabase
        .from("commission_payments")
        .select("id, label, amount, earned_date, due_note, invoiced_date, received_date, received_amount, notes")
        .eq("project_id", projectId)
        .order("created_at", { ascending: true })
        .returns<PaymentRow[]>(),
      supabase.from("entities").select("id, name").order("name").limit(1000).returns<Ent[]>(),
      contactOptions(),
    ]);
  return { project, participants: participants ?? [], payments: payments ?? [], entities: entities ?? [], contacts };
}

function PartyRows({
  count,
  contacts,
  entities,
}: {
  count: number;
  contacts: { id: string; label: string }[];
  entities: Ent[];
}) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="col-span-full grid grid-cols-1 md:grid-cols-12 gap-2 items-end">
          <label className="text-sm md:col-span-4">
            {i === 0 && "Party"}
            <select name={`party_${i}`} defaultValue="" className={input}>
              <option value="">— none / type a name →</option>
              <optgroup label="People">
                {contacts.map((c) => (
                  <option key={c.id} value={`c:${c.id}`}>
                    {c.label}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Companies">
                {entities.map((e) => (
                  <option key={e.id} value={`e:${e.id}`}>
                    {e.name}
                  </option>
                ))}
              </optgroup>
            </select>
          </label>
          <label className="text-sm md:col-span-3">
            {i === 0 && "…or name, if not on file"}
            <input name={`name_${i}`} className={input} placeholder="e.g. Lee & Associates" />
          </label>
          <label className="text-sm md:col-span-2">
            {i === 0 && "Role"}
            <select name={`role_${i}`} defaultValue="colleague" className={input}>
              {PARTICIPANT_ROLES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm md:col-span-2">
            {i === 0 && "Split (% of gross)"}
            <input name={`split_${i}`} inputMode="decimal" className={input} placeholder="e.g. 50" />
          </label>
          <label className="text-sm md:col-span-1 flex items-center gap-1 pb-2">
            <input type="checkbox" name={`top_${i}`} /> Off top
          </label>
        </div>
      ))}
    </>
  );
}

function NumberFields({ p }: { p: ProjectRow }) {
  return (
    <>
      <label className="text-sm md:col-span-2">
        Fee basis
        <select name="fee_basis" defaultValue={p.fee_basis ?? ""} className={input}>
          <option value="">Not set</option>
          {FEE_BASES.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm">
        Basis amount ($) — or the fee, if flat
        <input name="deal_price" inputMode="decimal" defaultValue={p.deal_price ?? ""} className={input} placeholder="Sale price, total base rent…" />
      </label>
      <label className="text-sm">
        Rate (%)
        <input name="commission_rate" inputMode="decimal" defaultValue={p.commission_rate ?? ""} className={input} placeholder="e.g. 6" />
      </label>
      <label className="text-sm">
        Your share (% of gross)
        <input name="dan_share_pct" inputMode="decimal" defaultValue={p.dan_share_pct ?? ""} className={input} placeholder="After splits, before CBRE payout" />
      </label>
      <label className="text-sm">
        Probability (%)
        <input name="probability_pct" inputMode="decimal" defaultValue={p.probability_pct ?? ""} className={input} placeholder="0–100" />
      </label>
      <label className="text-sm">
        Expected close
        <input name="target_close_date" type="date" defaultValue={p.target_close_date ?? ""} className={input} />
      </label>
    </>
  );
}

function Figures({ p }: { p: ProjectRow }) {
  const box = "border border-gray-200 dark:border-neutral-800 rounded-lg p-3";
  const k = "text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400";
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
      <div className={box}>
        <div className={k}>Gross fee</div>
        <div className="text-xl font-semibold">{usd(p.deal_value)}</div>
        <div className="text-xs text-gray-500 dark:text-gray-400">{feeBasisLabel(p.fee_basis)}</div>
      </div>
      <div className={box}>
        <div className={k}>Your share</div>
        <div className="text-xl font-semibold">{usd(p.dan_share_value)}</div>
        <div className="text-xs text-gray-500 dark:text-gray-400">{pct(p.dan_share_pct)} of gross</div>
      </div>
      <div className={box}>
        <div className={k}>Expected (× probability)</div>
        <div className="text-xl font-semibold">{usd(p.expected_share_value)}</div>
        <div className="text-xs text-gray-500 dark:text-gray-400">{pct(p.probability_pct)} probability</div>
      </div>
      <div className={box}>
        <div className={k}>Result</div>
        <div className="text-xl font-semibold">{resultLabel(p.result)}</div>
        <div className="text-xs text-gray-500 dark:text-gray-400">
          {p.result_date ? p.result_date : p.target_close_date ? `close ${p.target_close_date}` : "no close date"}
        </div>
      </div>
    </div>
  );
}

export default async function PipelineSection({
  projectId,
  variant,
}: {
  projectId: string;
  variant: "prompt" | "section";
}) {
  const { project: p, participants, payments, entities, contacts } = await load(projectId);
  if (!p) return null;

  if (variant === "prompt") {
    if (!needsSetup(p)) return null;
    const missing = missingFields(p);
    return (
      <section className="mb-8 rounded-xl border-2 border-blue-500 bg-blue-50 dark:bg-blue-950/40 p-5">
        <h2 className="text-lg font-semibold mb-1">Set this deal up for the pipeline</h2>
        <p className="text-sm text-gray-700 dark:text-gray-300 mb-4">
          One time per deal. What&apos;s already on file is filled in
          {missing.length > 0 ? <> — still needed: {missing.join(", ")}</> : null}. Leave anything
          you don&apos;t know blank; you can change all of it later in the Pipeline section below.
        </p>
        <ActionForm action={savePipelineAction} className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <input type="hidden" name="project_id" value={p.id} />
          <input type="hidden" name="mode" value="setup" />
          <NumberFields p={p} />
          <div className="col-span-full mt-2">
            <h3 className="font-medium">Who else shares the fee?</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Colleagues, co-brokers, referral sources, outside brokers — one per row. Leave the rows
              empty if it&apos;s yours alone.
              {participants.length > 0 && <> Already on file: {participants.length} (see the Pipeline section).</>}
            </p>
          </div>
          <PartyRows count={3} contacts={contacts} entities={entities} />
          <div className="col-span-full">
            <button type="submit" className={btnSolid}>
              Save — done setting up
            </button>
          </div>
        </ActionForm>
      </section>
    );
  }

  // ---- variant === "section" ----------------------------------------------
  const splitTotal = participants.reduce((n, x) => n + (Number(x.split_pct) || 0), 0);
  const today = todayCentral();
  return (
    <section className="mb-10">
      <h2 className="text-lg font-semibold mb-1">Pipeline</h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
        Gross is the whole fee. Your share is after deal-level splits and before CBRE&apos;s payout;
        expected is your share × probability.
        {needsSetup(p) && <> This deal hasn&apos;t been set up yet — use the card at the top of the page.</>}
      </p>

      <Figures p={p} />

      <details className="mb-6 border border-gray-200 dark:border-neutral-800 rounded-lg">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium">Edit numbers and result</summary>
        <ActionForm action={savePipelineAction} className="grid grid-cols-1 md:grid-cols-4 gap-3 p-4 pt-0">
          <input type="hidden" name="project_id" value={p.id} />
          <NumberFields p={p} />
          <label className="text-sm">
            Result
            <select name="result" defaultValue={p.result} className={input}>
              {RESULTS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Result date
            <input name="result_date" type="date" defaultValue={p.result_date ?? ""} className={input} />
          </label>
          <label className="text-sm md:col-span-2">
            Result note (why it was lost or dropped)
            <input name="result_note" defaultValue={p.result_note ?? ""} className={input} />
          </label>
          <label className="text-sm col-span-full">
            Strategic weight (a note, not a score)
            <textarea name="strategic_weight_note" rows={2} defaultValue={p.strategic_weight_note ?? ""} className={input} />
          </label>
          <div className="col-span-full">
            <button type="submit" className={btnSolid}>
              Save
            </button>
          </div>
        </ActionForm>
      </details>

      <h3 className="font-medium mb-2">
        Splits{" "}
        <span className="text-sm font-normal text-gray-500 dark:text-gray-400">
          {participants.length === 0
            ? "— yours alone, or not entered"
            : `— others total ${pct(splitTotal)}${p.dan_share_pct != null ? `; with your ${pct(p.dan_share_pct)} that's ${pct(splitTotal + Number(p.dan_share_pct))} of gross` : ""}`}
        </span>
      </h3>
      {participants.length > 0 && (
        <table className="w-full text-sm border-collapse mb-3">
          <thead>
            <tr className="text-left border-b border-gray-300 dark:border-neutral-700">
              <th className={cell}>Party</th>
              <th className={cell}>Role</th>
              <th className={cell}>Split</th>
              <th className={cell}></th>
            </tr>
          </thead>
          <tbody>
            {participants.map((x) => {
              const c = one(x.contact);
              const e = one(x.entity);
              return (
                <tr key={x.id} className="border-b border-gray-100 dark:border-neutral-800">
                  <td className={cell}>
                    {c ? (
                      <a href={contactHref(c.id)} className="text-blue-600 dark:text-blue-400 underline">{personName(c)}</a>
                    ) : e ? (
                      <a href={entityHref(e.id)} className="text-blue-600 dark:text-blue-400 underline">{e.name}</a>
                    ) : (
                      x.party_name
                    )}
                  </td>
                  <td className={cell}>
                    {roleLabel(x.role)}
                    {x.off_the_top && " · off the top"}
                  </td>
                  <td className={cell}>{pct(x.split_pct)}</td>
                  <td className={cell}>
                    <form action={removeParticipantAction}>
                      <input type="hidden" name="id" value={x.id} />
                      <input type="hidden" name="project_id" value={p.id} />
                      <button type="submit" className="text-sm text-gray-500 hover:text-red-600">Remove</button>
                    </form>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <details className="mb-6 border border-gray-200 dark:border-neutral-800 rounded-lg">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium">Add a party who shares the fee</summary>
        <ActionForm action={addParticipantAction} className="grid grid-cols-1 md:grid-cols-4 gap-3 p-4 pt-0">
          <input type="hidden" name="project_id" value={p.id} />
          <PartyRows count={1} contacts={contacts} entities={entities} />
          <div className="col-span-full">
            <button type="submit" className={btnPlain}>Add</button>
          </div>
        </ActionForm>
      </details>

      <h3 className="font-medium mb-2">Commission payments</h3>
      {payments.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
          None yet. Leases usually pay in two installments; sales pay in full at closing.
        </p>
      ) : (
        <table className="w-full text-sm border-collapse mb-3">
          <thead>
            <tr className="text-left border-b border-gray-300 dark:border-neutral-700">
              <th className={cell}>Payment</th>
              <th className={cell}>Gross</th>
              <th className={cell}>Your share</th>
              <th className={cell}>Earned</th>
              <th className={cell}>Status</th>
              <th className={cell}></th>
            </tr>
          </thead>
          <tbody>
            {payments.map((x) => {
              const share = x.amount != null && p.dan_share_pct != null ? (x.amount * p.dan_share_pct) / 100 : null;
              const owed = !x.received_date && x.earned_date && x.earned_date <= today;
              return (
                <tr key={x.id} className="border-b border-gray-100 dark:border-neutral-800 align-top">
                  <td className={cell}>
                    {x.label}
                    {x.notes && <div className="text-xs text-gray-500 dark:text-gray-400">{x.notes}</div>}
                  </td>
                  <td className={cell}>{usd(x.amount)}</td>
                  <td className={cell}>{usd(share)}</td>
                  <td className={cell}>{x.earned_date ?? x.due_note ?? "—"}</td>
                  <td className={cell}>
                    {x.received_date ? (
                      <span className="text-green-700 dark:text-green-400">
                        Received {x.received_date}
                        {x.received_amount != null && x.received_amount !== x.amount && <> ({usd(x.received_amount)})</>}
                      </span>
                    ) : owed ? (
                      <ActionForm action={receivePaymentAction} className="flex flex-wrap items-center gap-2">
                        <input type="hidden" name="id" value={x.id} />
                        <input type="hidden" name="project_id" value={p.id} />
                        <span className="text-red-600 dark:text-red-400">Owed</span>
                        <input name="received_date" type="date" defaultValue={today} aria-label="Date received" className="border border-gray-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 rounded px-2 py-1" />
                        <button type="submit" className={btnPlain}>Mark received</button>
                      </ActionForm>
                    ) : (
                      <span className="text-gray-500 dark:text-gray-400">Not yet earned</span>
                    )}
                  </td>
                  <td className={cell}>
                    <form action={removePaymentAction}>
                      <input type="hidden" name="id" value={x.id} />
                      <input type="hidden" name="project_id" value={p.id} />
                      <button type="submit" className="text-sm text-gray-500 hover:text-red-600">Remove</button>
                    </form>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <details className="border border-gray-200 dark:border-neutral-800 rounded-lg">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium">Add a commission payment</summary>
        <ActionForm action={addPaymentAction} className="grid grid-cols-1 md:grid-cols-4 gap-3 p-4 pt-0">
          <input type="hidden" name="project_id" value={p.id} />
          <label className="text-sm">
            Name
            <input name="label" className={input} placeholder="Payment 1" />
          </label>
          <label className="text-sm">
            Gross amount ($)
            <input name="amount" inputMode="decimal" className={input} />
          </label>
          <label className="text-sm">
            Earned on
            <input name="earned_date" type="date" className={input} />
          </label>
          <label className="text-sm">
            …or when it comes due
            <input name="due_note" className={input} placeholder="e.g. Lease Year 6" />
          </label>
          <label className="text-sm col-span-full">
            Note
            <input name="notes" className={input} />
          </label>
          <div className="col-span-full">
            <button type="submit" className={btnPlain}>Add payment</button>
          </div>
        </ActionForm>
      </details>
    </section>
  );
}
