"use server";

import ExcelJS from "exceljs";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/supabase";
import { dbMessage, type Match } from "@/lib/rtd";

export type DecideResult = {
  ok: boolean;
  status?: string;
  message?: string;
  matches?: Match[];
  at: number;
} | null;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Rpc = { status?: string; message?: string; matches?: Match[]; result_ref?: string };

async function review(type: string, id: string, decision: string, force: boolean, link: string | null): Promise<Rpc & { error?: string }> {
  const supabase = await db();
  const { data, error } = await supabase.rpc("rtd_review", {
    p_type: type, p_id: id, p_decision: decision, p_force: force, p_link_contact_id: link,
  });
  if (error) return { error: dbMessage(error.message) };
  return (data ?? {}) as Rpc;
}

function refresh() {
  revalidatePath("/review");
  revalidatePath("/new");
  revalidatePath("/", "layout");
}

/** One decision from the in-app queue. */
export async function decide(_p: DecideResult, fd: FormData): Promise<DecideResult> {
  const type = String(fd.get("type") ?? "");
  const id = String(fd.get("id") ?? "");
  const decision = String(fd.get("decision") ?? "");
  const link = String(fd.get("link_contact_id") ?? "");
  if (!UUID.test(id) || !["note", "change"].includes(type)) return { ok: false, message: "Missing item.", at: Date.now() };
  if (decision === "leave") return { ok: true, status: "left", message: "Left for later.", at: Date.now() };

  const r = await review(type, id, decision, fd.get("force") === "1", UUID.test(link) ? link : null);
  if (r.error) return { ok: false, message: r.error, at: Date.now() };
  if (r.status === "accepted" || r.status === "kept") {
    refresh();
    return { ok: true, status: r.status, at: Date.now() };
  }
  if (r.status === "gone") refresh();
  return { ok: false, status: r.status, message: r.message, matches: r.matches, at: Date.now() };
}

export type ImportResult = { ok: boolean; lines: string[]; error?: string; at: number } | null;

/** Decisions from the downloaded sheet (Decision column; "Add anyway" = Yes to override). Old sheets'
 *  Accept / Reject / Leave and "Accept anyway" still work. */
export async function importDecisions(_p: ImportResult, fd: FormData): Promise<ImportResult> {
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, lines: [], error: "Choose the review sheet first.", at: Date.now() };
  if (file.size > 5_000_000) return { ok: false, lines: [], error: "That file is too big to be a review sheet.", at: Date.now() };

  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(await file.arrayBuffer());
  } catch {
    return { ok: false, lines: [], error: "That isn't an Excel (.xlsx) file.", at: Date.now() };
  }
  const ws = wb.getWorksheet("Review");
  if (!ws) return { ok: false, lines: [], error: "No \"Review\" tab — use the sheet from Download for Excel.", at: Date.now() };

  // Find columns by header text so a moved column still works.
  let headerRow = 0;
  const col: Record<string, number> = {};
  ws.eachRow((row, n) => {
    if (headerRow) return;
    const vals = (row.values as unknown[]).map((v) => String(v ?? "").trim());
    if (vals.includes("Item ID") && vals.includes("Decision")) {
      headerRow = n;
      vals.forEach((v, i) => { if (v) col[v] = i; });
    }
  });
  if (!headerRow) return { ok: false, lines: [], error: "Couldn't find the header row (Item ID … Decision).", at: Date.now() };

  const counts = { accepted: 0, kept: 0, left: 0 };
  const lines: string[] = [];
  const rows: { n: number; type: string; id: string; decision: string; force: boolean; label: string }[] = [];
  ws.eachRow((row, n) => {
    if (n <= headerRow) return;
    const get = (h: string) => String(row.getCell(col[h] ?? 0).text ?? "").trim();
    const id = get("Item ID");
    if (!UUID.test(id)) return;
    rows.push({
      n, id,
      type: get("Type").toLowerCase(),
      decision: get("Decision").toLowerCase(),
      force: /^y/i.test(get("Add anyway") || get("Accept anyway")),
      label: `${get("Brand")} — ${get("What")}`,
    });
  });

  for (const r of rows) {
    const d = /^add|^accept/.test(r.decision) ? "accept" : /^keep|^reject/.test(r.decision) ? "keep" : /^later|^leave/.test(r.decision) || !r.decision ? "later" : "";
    if (d === "later") { counts.left++; continue; }
    if (!d) { lines.push(`Row ${r.n} (${r.label}): "${r.decision}" isn't Add to CRM, Keep in RTD only or Later — skipped.`); continue; }
    r.decision = d;
    const res = await review(r.type, r.id, r.decision, r.force, null);
    if (res.error) lines.push(`Row ${r.n} (${r.label}): ${res.error}`);
    else if (res.status === "accepted") counts.accepted++;
    else if (res.status === "kept") counts.kept++;
    else if (res.status === "gone") lines.push(`Row ${r.n} (${r.label}): already handled.`);
    else lines.push(`Row ${r.n} (${r.label}): not added — ${res.message ?? res.status}. Put Yes under "Add anyway" to override, or decide it in the app.`);
  }
  refresh();
  lines.unshift(`${counts.accepted} added to CRM · ${counts.kept} kept in RTD only · ${counts.left} left for later.`);
  return { ok: true, lines, at: Date.now() };
}
