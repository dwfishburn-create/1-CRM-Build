import type { NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { getMe } from "@/lib/supabase";
import { allLicenses, listOperators, liquorMeta, parseLiquorParams, saleLabel } from "@/lib/liquor";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// The Liquor licenses page to Excel — the same search, up to 10,000 rows
// (operators: up to 1,000).
export async function GET(request: NextRequest) {
  const me = await getMe();
  if (!me) return new Response("Not signed in to the RTD.", { status: 401 });
  const p = parseLiquorParams(Object.fromEntries(request.nextUrl.searchParams.entries()));
  const meta = await liquorMeta();
  const asOf = meta?.latest_snapshot_date ? `NLCC roster of ${meta.latest_snapshot_date}` : "NLCC roster";
  const criteria = [p.q && `"${p.q}"`, p.city, p.county && `${p.county} County`, p.sale.map(saleLabel).join(" / "),
    p.minOp && `${p.minOp}+ licenses`].filter(Boolean).join(" · ");
  const stamp = new Date().toISOString().slice(0, 10);

  const wb = new ExcelJS.Workbook();
  wb.creator = `RTD — ${me.display_name}`;
  const title = { licenses: "Liquor licenses", operators: "Multi-unit liquor license operators", new: "New liquor licenses", dropped: "Dropped liquor licenses" }[p.view];
  const ws = wb.addWorksheet(p.view === "operators" ? "Operators" : "Licenses", { views: [{ state: "frozen", ySplit: 4 }] });
  ws.addRow([`${title}${criteria ? ` — ${criteria}` : ""}`]).font = { bold: true, size: 13 };

  let headers: string[]; let widths: number[]; let count = 0;
  if (p.view === "operators") {
    const r = await listOperators(p, 1000, 0);
    if (r.error) return new Response(`Export failed: ${r.error}`, { status: 500 });
    headers = ["Licensee", "Licenses statewide", "In filter", "Trade names", "Cities", "Brand", "Email", "Phone", "Corporate address"];
    widths = [36, 12, 10, 60, 50, 22, 32, 14, 44];
    ws.addRow([`${asOf} · exported ${new Date().toLocaleDateString("en-US", { timeZone: "America/Chicago" })} by ${me.display_name} · ${r.rows.length} operators`]);
    ws.addRow([]);
    addHeader(ws, headers);
    for (const o of r.rows) {
      ws.addRow([o.licensee, o.license_count, o.in_area_count, o.trade_names ?? "", o.cities ?? "", o.brand_names ?? "",
        o.sample_email ?? "", o.sample_phone ?? "", o.corporate_address ?? ""]);
    }
    count = r.rows.length;
  } else {
    const r = await allLicenses(p);
    if (r.error) return new Response(`Export failed: ${r.error}`, { status: 500 });
    headers = ["Trade name", "Street", "City", "Zip", "County", "Type", "Class", "Licensee", "Licensee's licenses",
      "Manager", "Phone", "Email", "Corporate address", "Directory brand", p.view === "dropped" ? "Dropped" : "First on roster", "License #"];
    widths = [32, 30, 16, 11, 12, 16, 7, 34, 12, 24, 14, 32, 40, 22, 13, 10];
    ws.addRow([`${asOf} · exported ${new Date().toLocaleDateString("en-US", { timeZone: "America/Chicago" })} by ${me.display_name} · ${r.rows.length} licenses · public record, unverified`]);
    ws.addRow([]);
    addHeader(ws, headers);
    for (const l of r.rows) {
      ws.addRow([l.trade_name ?? "", l.premises_street ?? "", l.premises_city ?? "", l.premises_zip ?? "", l.county ?? "",
        saleLabel(l.sale_type), l.class ?? "", l.licensee ?? "", l.operator_licenses, l.manager_name ?? "", l.phone ?? "",
        l.email ?? "", l.corporate_address ?? "", l.brand_name ?? "", (p.view === "dropped" ? l.dropped_on : l.first_seen_on) ?? "",
        l.license_number]);
    }
    count = r.rows.length;
  }
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: headers.length } };

  const buf = await wb.xlsx.writeBuffer();
  const name = `RTD_Liquor_${p.view === "licenses" ? "Licenses" : p.view[0].toUpperCase() + p.view.slice(1)}_${stamp}.xlsx`;
  return new Response(buf as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
      "X-Row-Count": String(count),
    },
  });
}

function addHeader(ws: ExcelJS.Worksheet, headers: string[]) {
  const h = ws.addRow(headers);
  h.font = { bold: true, color: { argb: "FFFFFFFF" } };
  h.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F2A2E" } }; });
}
