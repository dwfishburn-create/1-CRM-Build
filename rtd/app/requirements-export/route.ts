import type { NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { getMe } from "@/lib/supabase";
import { marketLabel } from "@/lib/search";
import { CONFIDENCE, REQ_STATUS } from "@/lib/rtd";
import { listRequirements, parseReqParams } from "@/lib/requirements";

export const dynamic = "force-dynamic";

// The Requirements list to Excel — same filters as the page, up to 5,000 rows.
export async function GET(request: NextRequest) {
  const me = await getMe();
  if (!me) return new Response("Not signed in to the RTD.", { status: 401 });
  const p = { ...parseReqParams(Object.fromEntries(request.nextUrl.searchParams.entries())), offset: 0 };
  const { rows, error } = await listRequirements(p, 5000);
  if (error) return new Response(`Export failed: ${error}`, { status: 500 });

  const wb = new ExcelJS.Workbook();
  wb.creator = `RTD — ${me.display_name}`;
  const ws = wb.addWorksheet("Requirements", { views: [{ state: "frozen", ySplit: 3 }] });
  ws.addRow([`RTD requirements — exported ${new Date().toLocaleDateString("en-US", { timeZone: "America/Chicago" })} by ${me.display_name} · ${rows.length} rows`]).font = { bold: true, size: 13 };
  ws.addRow([]);
  const head = ws.addRow([
    "For", "Code", "Property type", "Deal type", "Size min (SF)", "Size max (SF)", "Budget min", "Budget max",
    "Location", "Markets", "Timeline", "Status", "Confidence", "Heard on", "Re-confirm by", "Who to call", "Note", "Added by",
  ]);
  head.font = { bold: true, color: { argb: "FFFFFFFF" } };
  head.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F2A2E" } }; });
  for (const r of rows) {
    const row = ws.addRow([
      r.party, r.display_code, r.property_type ?? "", r.deal_type ?? "", r.size_min ?? null, r.size_max ?? null,
      r.budget_min ?? null, r.budget_max ?? null, r.target_location ?? "",
      r.target_markets.map(marketLabel).join(", "), r.timeline ?? "", REQ_STATUS[r.status] ?? r.status,
      r.confidence ? CONFIDENCE[r.confidence] : "", r.source_date ?? "", r.reconfirm_date ?? "",
      r.rtd_contact ?? "", r.rtd_note ?? "", r.added_by ?? "Dan's CRM",
    ]);
    row.alignment = { vertical: "top", wrapText: true };
  }
  [30, 11, 14, 12, 12, 12, 13, 13, 24, 24, 14, 10, 11, 12, 12, 26, 50, 14].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  [5, 6].forEach((i) => { ws.getColumn(i).numFmt = "#,##0"; });
  [7, 8].forEach((i) => { ws.getColumn(i).numFmt = "$#,##0"; });
  ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: 18 } };

  const buf = await wb.xlsx.writeBuffer();
  return new Response(buf as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="RTD_Requirements_${new Date().toISOString().slice(0, 10)}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
