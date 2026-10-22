import ExcelJS from "exceljs";
import { getMe } from "@/lib/supabase";
import { categoryMap, changeLines, changeTitle, FIELD_LABEL, reviewQueue, showValue } from "@/lib/rtd";

export const dynamic = "force-dynamic";

// Sync to CRM as a sheet. Pick a Decision (Add to CRM / Keep in RTD only /
// Later), optionally Yes under "Add anyway", and upload it on Sync to CRM.
export async function GET() {
  const me = await getMe();
  if (!me?.is_admin) return new Response("Only Dan reviews proposals.", { status: 403 });
  const [{ items, error }, cats] = await Promise.all([reviewQueue(), categoryMap()]);
  if (error) return new Response(`Export failed: ${error}`, { status: 500 });

  const wb = new ExcelJS.Workbook();
  wb.creator = "RTD";
  const ws = wb.addWorksheet("Review", { views: [{ state: "frozen", ySplit: 3 }] });
  ws.addRow([`RTD Sync to CRM — ${items.length} items, downloaded ${new Date().toLocaleString("en-US", { timeZone: "America/Chicago" })}`]).font = { bold: true, size: 13 };
  ws.addRow(["Decision: Add to CRM, Keep in RTD only or Later (blank = Later). \"Add anyway\" = Yes overrides a CRM conflict or a likely duplicate. Don't edit the Item ID or Type columns."]);

  const headers = ["Decision", "Add anyway", "Brand", "What", "From", "Date", "Details", "Flags", "Type", "Item ID"];
  const head = ws.addRow(headers);
  head.font = { bold: true, color: { argb: "FFFFFFFF" } };
  head.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F2A2E" } }; });

  for (const it of items) {
    const details = it.type === "note"
      ? `${it.tags?.length ? `[${it.tags.join(", ")}] ` : ""}${it.body ?? ""}`
      : changeLines(it, cats).join("\n");
    const flags = [
      ...(it.conflicts ?? []).map((k) => `CRM changed: ${FIELD_LABEL[k] ?? k} is now ${showValue(k, it.current?.[k], cats)}`),
      ...(it.matches ?? []).map((m) => `Possible duplicate: ${m.name}${m.display_code ? ` (${m.display_code})` : ""} ${Math.round(m.score * 100)}%`),
    ].join("\n");
    const row = ws.addRow([
      "", "", it.brand, it.type === "note" ? "Intel note" : changeTitle(it), it.author,
      new Date(it.created_at).toLocaleDateString("en-US", { timeZone: "America/Chicago" }),
      details, flags, it.type, it.id,
    ]);
    row.alignment = { vertical: "top", wrapText: true };
    row.getCell(1).dataValidation = { type: "list", allowBlank: true, formulae: ['"Add to CRM,Keep in RTD only,Later"'] };
    row.getCell(2).dataValidation = { type: "list", allowBlank: true, formulae: ['"Yes"'] };
    row.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF4F9DF" } };
  }

  [12, 10, 28, 30, 16, 12, 60, 40, 9, 38].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  const buf = await wb.xlsx.writeBuffer();
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(buf as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="RTD_Sync_${stamp}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
