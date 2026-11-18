import type { NextRequest } from "next/server";
import ExcelJS from "exceljs";
import {
  campaignStatusLabel,
  loadProspectChecklist,
  sourceLabel,
  stageLabel,
} from "@/lib/prospectChecklist";
import { todayCentral } from "@/lib/centralDate";

export const dynamic = "force-dynamic";

// GET /projects/[id]/prospects/export — the Prospect Checklist as .xlsx
// (11/18/2026). Sheet 1 has the page's columns. Sheet 2 is the clean
// Existing Prospects list a listing agreement asks for at expiration (for
// CS-3167 Joliet Ave, LA §10(b), due 12/30/26): number, name, company,
// contact info and first contact date only — no stages, notes or call history.
// Behind the CRM sign-in (proxy.ts).

const HEAD = { argb: "FF1F3A5F" };

function toDate(d: string | null): Date | null {
  return d ? new Date(`${d}T12:00:00Z`) : null;
}

function header(ws: ExcelJS.Worksheet, title: string, sub: string, headers: string[], widths: number[]) {
  ws.addRow([title]).font = { bold: true, size: 13 };
  ws.addRow([sub]);
  ws.addRow([]);
  const h = ws.addRow(headers);
  h.font = { bold: true, color: { argb: "FFFFFFFF" } };
  h.eachCell((c) => {
    c.fill = { type: "pattern", pattern: "solid", fgColor: HEAD };
  });
  widths.forEach((w, i) => {
    ws.getColumn(i + 1).width = w;
  });
  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: headers.length } };
}

export async function GET(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const checklist = await loadProspectChecklist(id);
  if (!checklist) return new Response("Project not found", { status: 404 });
  const { project, rows, campaigns, called_since } = checklist;
  const stamp = todayCentral();

  const wb = new ExcelJS.Workbook();
  wb.creator = "CRM - Dan Fishburn";

  // Sheet 1 — the checklist
  const ws = wb.addWorksheet("Prospect Checklist", { views: [{ state: "frozen", ySplit: 4, xSplit: 3 }] });
  const headers = [
    "#", "First Contact", "Name", "Company / Entity", "Email", "Phone", "Source", "Stage", "Signed CA",
    "Last Action (Date)", "Last Action", called_since ? `Called since ${called_since}` : "Called",
    "Open Task Due", "Open Task",
    ...campaigns.map((c) => (c.sent_on ? `${c.name} (${c.sent_on})` : c.name)),
  ];
  header(
    ws,
    `${project.project_code} — Prospect Checklist (oldest first contact at top)`,
    `${project.client_name} · ${rows.length} buyer prospects · exported ${stamp} from CRM - Dan Fishburn`,
    headers,
    [5, 12, 24, 32, 30, 16, 15, 15, 12, 12, 50, 12, 12, 40, ...campaigns.map(() => 18)]
  );
  for (const r of rows) {
    const row = ws.addRow([
      r.prospect_no,
      toDate(r.first_contact_date),
      r.name,
      r.company ?? "",
      r.email ?? "NOT ON FILE",
      r.phone ?? "NOT ON FILE",
      sourceLabel(r.source),
      stageLabel(r.stage),
      toDate(r.ca_signed_on),
      toDate(r.last_action_date),
      [r.last_action_type, r.last_action_summary].filter(Boolean).join(" — "),
      r.called_on ? toDate(r.called_on) : "No",
      r.open_task ? toDate(r.open_task.due_date) : null,
      r.open_task ? `${r.open_task.description}${r.open_task_overdue ? " (OVERDUE)" : ""}` : "",
      ...campaigns.map((c) => {
        const x = r.campaigns[c.id];
        return x ? `${campaignStatusLabel(x.status)}${x.note ? ` – ${x.note}` : ""}` : "";
      }),
    ]);
    for (const col of [2, 9, 10, 12, 13]) row.getCell(col).numFmt = "m/d/yy";
    row.getCell(11).alignment = { wrapText: true, vertical: "top" };
    row.getCell(14).alignment = { wrapText: true, vertical: "top" };
    if (!r.phone) row.getCell(6).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFDE2E2" } };
    if (!r.email) row.getCell(5).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF3C4" } };
    if (r.ca_signed_on) row.getCell(9).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFCCFBF1" } };
    if (r.open_task_overdue) row.getCell(13).font = { color: { argb: "FFC00000" }, bold: true };
    if (r.stage === "passed") row.font = { color: { argb: "FF888888" } };
  }

  // Sheet 2 — Existing Prospects list for the listing agreement
  const ep = wb.addWorksheet("Existing Prospects", { views: [{ state: "frozen", ySplit: 4 }] });
  header(
    ep,
    `Existing Prospects — ${project.project_code}`,
    `Prospects introduced to the property during the listing term, as of ${stamp}. Seller: ${project.client_name}.`,
    ["#", "Name", "Company / Entity", "Email", "Phone", "First Contact", "Source"],
    [5, 26, 36, 32, 18, 13, 16]
  );
  for (const r of [...rows].sort((a, b) => (a.prospect_no ?? 1e9) - (b.prospect_no ?? 1e9))) {
    const row = ep.addRow([
      r.prospect_no,
      r.name,
      r.company ?? "",
      r.email ?? "",
      r.phone ?? "",
      toDate(r.first_contact_date),
      sourceLabel(r.source),
    ]);
    row.getCell(6).numFmt = "m/d/yy";
  }

  const buf = await wb.xlsx.writeBuffer();
  const safe = project.project_code.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "");
  return new Response(buf as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${safe}_Prospect_Checklist_${stamp}.xlsx"`,
    },
  });
}
