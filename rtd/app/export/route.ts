import type { NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { getMe } from "@/lib/supabase";
import { EXPANSION, MARKETS, marketLabel, parseParams, searchBrands } from "@/lib/search";
import { claimsFor } from "@/lib/rtd";

export const dynamic = "force-dynamic";

// Prospect list to Excel — the same search as the page, up to 5,000 rows.
export async function GET(request: NextRequest) {
  const me = await getMe();
  if (!me) return new Response("Not signed in to the RTD.", { status: 401 });

  const sp = Object.fromEntries(request.nextUrl.searchParams.entries());
  const params = { ...parseParams(sp), offset: 0 };
  const { rows, error } = await searchBrands(params, 5000);
  if (error) return new Response(`Export failed: ${error}`, { status: 500 });
  const claims = await claimsFor(rows.map((r) => r.entity_id));

  const wb = new ExcelJS.Workbook();
  wb.creator = `RTD — ${me.display_name}`;
  const ws = wb.addWorksheet("Prospects", { views: [{ state: "frozen", ySplit: 4 }] });

  const criteria = [
    params.size ? `${params.size.toLocaleString("en-US")} SF` : "Any size",
    params.market ? MARKETS.find((m) => m.code === params.market)?.label ?? params.market : "Any market",
    params.category || "Any category",
    params.q ? `name contains "${params.q}"` : "",
  ].filter(Boolean).join(" · ");
  ws.addRow([`RTD prospect list — ${criteria}`]).font = { bold: true, size: 13 };
  ws.addRow([`Exported ${new Date().toLocaleDateString("en-US", { timeZone: "America/Chicago" })} by ${me.display_name} · ${rows.length} brands`]);
  ws.addRow([]);

  const header = ws.addRow([
    "Brand", "Code", "Category", "Size min (SF)", "Size max (SF)", "Fit", "Expansion",
    "Target markets", "Verified", "Last verified", "Contact", "Title", "Email", "Phone",
    "Contacts on file", "Active requirements", "Claimed by",
  ]);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F2A2E" } }; });

  for (const r of rows) {
    ws.addRow([
      r.name, r.display_code, r.category_label ?? "", r.size_min_sf ?? null, r.size_max_sf ?? null,
      r.fit === "fits" ? "Fits" : r.fit === "close" ? `Close (${(r.fit_delta_pct ?? 0) > 0 ? "+" : "-"}${Math.abs(r.fit_delta_pct ?? 0)}%)` : "",
      EXPANSION[r.expansion_status] ?? r.expansion_status,
      r.target_markets.length ? r.target_markets.map(marketLabel).join(", ") : "Not set",
      r.needs_verification ? "No" : "Yes",
      r.last_verified_on ?? "",
      r.contact_name ?? "", r.contact_title ?? "", r.contact_email ?? "", r.contact_phone ?? "",
      r.contact_count, r.active_requirements,
      claims.get(r.entity_id)?.holder ?? "",
    ]);
  }

  const widths = [34, 11, 30, 13, 13, 13, 14, 26, 9, 13, 24, 28, 32, 16, 10, 12, 18];
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  [4, 5].forEach((i) => { ws.getColumn(i).numFmt = "#,##0"; });
  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: widths.length } };

  const buf = await wb.xlsx.writeBuffer();
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(buf as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="RTD_Prospects_${stamp}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
