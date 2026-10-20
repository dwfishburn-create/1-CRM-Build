import { db } from "./supabase";
import { dbMessage, type Requirement } from "./rtd";

// The RTD's Requirements list (10/20/2026): only requirements shared to the
// RTD — every one entered here, plus CRM ones Dan pressed "Share to RTD" on.

export type ReqParams = {
  status: string;      // active (default) | on_hold | fulfilled | dead | all
  type: string;        // property type
  deal: string;
  market: string;
  size: number | null;
  q: string;
  offset: number;
};

function one(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

export function parseReqParams(sp: Record<string, string | string[] | undefined>): ReqParams {
  const rawSize = one(sp.size).replace(/[^0-9.]/g, "");
  const size = rawSize ? Number(rawSize) : null;
  return {
    status: one(sp.status) || "active",
    type: one(sp.type),
    deal: one(sp.deal),
    market: one(sp.market),
    size: size && size > 0 ? size : null,
    q: one(sp.q).trim(),
    offset: Math.max(0, Number(one(sp.offset)) || 0),
  };
}

export function reqQuery(p: ReqParams, overrides: Partial<ReqParams> = {}): string {
  const v = { ...p, ...overrides };
  const qs = new URLSearchParams();
  if (v.status && v.status !== "active") qs.set("status", v.status);
  if (v.type) qs.set("type", v.type);
  if (v.deal) qs.set("deal", v.deal);
  if (v.market) qs.set("market", v.market);
  if (v.size) qs.set("size", String(v.size));
  if (v.q) qs.set("q", v.q);
  if (v.offset) qs.set("offset", String(v.offset));
  return qs.toString();
}

export async function listRequirements(p: ReqParams, limit = 200): Promise<{ rows: Requirement[]; error?: string }> {
  const supabase = await db();
  const { data, error } = await supabase.rpc("rtd_requirements", {
    p_status: p.status === "all" ? "" : p.status,
    p_property_type: p.type || null,
    p_deal_type: p.deal || null,
    p_market: p.market || null,
    p_size: p.size,
    p_q: p.q || null,
    p_limit: limit,
    p_offset: p.offset,
  });
  if (error) return { rows: [], error: dbMessage(error.message) };
  return { rows: (data ?? []) as Requirement[] };
}

export async function requirementTypes(): Promise<{ property_types: string[]; deal_types: string[] }> {
  const supabase = await db();
  const { data } = await supabase.rpc("rtd_requirement_types");
  return (data ?? { property_types: [], deal_types: [] }) as { property_types: string[]; deal_types: string[] };
}

/** Re-confirm date passed on an active requirement. */
export function overdue(r: { status: string; reconfirm_date: string | null }, today: string): boolean {
  return r.status === "active" && !!r.reconfirm_date && r.reconfirm_date < today;
}
