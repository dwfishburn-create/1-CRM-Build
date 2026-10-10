// Pipeline (Build #2, 10/10/2026) — shared labels and helpers.
//
// Vocabulary (decisions log 9/22, 9/26, 10/6/2026):
//   gross            the whole fee: basis × rate, or the basis itself for a
//                    flat fee (projects.deal_value, generated)
//   Dan's share      after deal-level splits, before CBRE's internal payout
//                    (projects.dan_share_pct / dan_share_value)
//   expected         Dan's share × probability (projects.expected_share_value)
//   Result           active / inactive / won / lost / dropped — separate from
//                    status so a win rate is computable
//   receivable       a Won deal's unpaid commission_payments row — owed, not
//                    probability-weighted

export const FEE_BASES = [
  { value: "sale_price", label: "Sale price × %" },
  { value: "base_rent_term", label: "Base rent, primary term × %" },
  { value: "sublease_consideration", label: "Sublease consideration × %" },
  { value: "savings_buyout", label: "Savings / buyout × %" },
  { value: "flat_fee", label: "Flat fee" },
  { value: "other", label: "Other (see notes)" },
] as const;

export const RESULTS = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
  { value: "won", label: "Won" },
  { value: "lost", label: "Lost" },
  { value: "dropped", label: "Dropped" },
] as const;

export const PARTICIPANT_ROLES = [
  { value: "colleague", label: "Colleague (CBRE)" },
  { value: "co_broker", label: "Co-broker" },
  { value: "referral", label: "Referral (off the top)" },
  { value: "outside_broker", label: "Outside broker" },
  { value: "other", label: "Other" },
] as const;

export const PARTY_SIDES = [
  { value: "client", label: "Client side" },
  { value: "counterparty", label: "Counterparty" },
  { value: "other", label: "Third party" },
] as const;

export function feeBasisLabel(v: string | null | undefined): string {
  return FEE_BASES.find((f) => f.value === v)?.label ?? "—";
}
export function resultLabel(v: string | null | undefined): string {
  return RESULTS.find((r) => r.value === v)?.label ?? (v || "—");
}
export function roleLabel(v: string | null | undefined): string {
  return PARTICIPANT_ROLES.find((r) => r.value === v)?.label ?? (v || "—");
}

export function usd(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return "—";
  return "$" + Math.round(Number(n)).toLocaleString("en-US");
}
export function pct(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return "—";
  const v = Number(n);
  return (Number.isInteger(v) ? v.toString() : v.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")) + "%";
}

/**
 * What a deal still needs before its pipeline number means anything. Used to
 * flag rows on /pipeline and to word the first-open prompt.
 */
export function missingFields(p: {
  fee_basis: string | null;
  deal_price: number | null;
  commission_rate: number | null;
  dan_share_pct: number | null;
  probability_pct: number | null;
  target_close_date: string | null;
}): string[] {
  const out: string[] = [];
  if (!p.fee_basis) out.push("fee basis");
  if (p.deal_price == null) out.push(p.fee_basis === "flat_fee" ? "fee" : "basis amount");
  if (p.fee_basis !== "flat_fee" && p.commission_rate == null) out.push("rate");
  if (p.dan_share_pct == null) out.push("your share");
  if (p.probability_pct == null) out.push("probability");
  if (!p.target_close_date) out.push("expected close");
  return out;
}

/** Parse an optional number field: null when blank, NaN when not a number. */
export function numField(raw: FormDataEntryValue | null): number | null {
  const s = String(raw ?? "").replace(/[$,%\s]/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}
