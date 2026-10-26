import type { NextRequest } from "next/server";
import ExcelJS from "exceljs";
import {
  CHANGE_TYPES,
  listChanges,
  listOperators,
  liquorMeta,
  saleTypeLabel,
  searchAllLicenses,
} from "@/lib/liquorLicenses";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /liquor-licenses/export — the current Liquor Licenses view (licenses,
// operators or changes) with the same filters, as an Excel sheet. Behind the
// CRM sign-in (proxy.ts). Up to 10,000 rows.

function list(v: string | null): string[] {
  return (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}
function multi(sp: URLSearchParams, k: string): string[] {
  return sp.getAll(k).flatMap((v) => list(v));
}

const HEAD = { argb: "FF1F3A5F" };

function sheet(wb: ExcelJS.Workbook, name: string, title: string, sub: string, headers: string[], widths: number[]) {
  const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 4 }] });
  ws.addRow([title]).font = { bold: true, size: 13 };
  ws.addRow([sub]);
  ws.addRow([]);
  const h = ws.addRow(headers);
  h.font = { bold: true, color: { argb: "FFFFFFFF" } };
  h.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: HEAD }; });
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: headers.length } };
  return ws;
}

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const view = sp.get("view") ?? "licenses";
  const meta = await liquorMeta().catch(() => null);
  const asOf = meta?.latest_snapshot_date ? `NLCC roster of ${meta.latest_snapshot_date}` : "NLCC roster";
  const criteria = [
    sp.get("q") && `"${sp.get("q")}"`,
    sp.get("city"), sp.get("county") && `${sp.get("county")} County`,
    multi(sp, "sale").map((s) => saleTypeLabel(s)).join(" / "),
    sp.get("min_operator") && `operator ${sp.get("min_operator")}+ licenses`,
    sp.get("status") && sp.get("status") !== "active" && sp.get("status"),
  ].filter(Boolean).join(" · ");
  const stamp = new Date().toISOString().slice(0, 10);
  const wb = new ExcelJS.Workbook();
  wb.creator = "CRM - Dan Fishburn";
  let file = `Liquor_Licenses_${stamp}.xlsx`;

  try {
    if (view === "operators") {
      const operators = [];
      for (let offset = 0; offset < 10000; offset += 1000) {
        const r = await listOperators({
          q: sp.get("q"), city: sp.get("city"), county: sp.get("county"), sale_types: multi(sp, "sale"),
          min_licenses: sp.get("min_operator") || 2, limit: 1000, offset,
        });
        operators.push(...r.operators);
        if (!r.has_more) break;
      }
      const ws = sheet(wb, "Operators", `Multi-unit liquor license operators${criteria ? ` — ${criteria}` : ""}`,
        `${asOf} · ${operators.length} operators · exported ${stamp}`,
        ["Licensee", "Licenses statewide", "In filter", "Trade names", "Cities", "Brand", "Email", "Phone", "Corporate address", "CRM company"],
        [36, 12, 10, 60, 50, 22, 32, 14, 44, 14]);
      for (const o of operators) {
        ws.addRow([o.licensee, o.license_count, o.in_area_count, o.trade_names, o.cities, o.brand_names ?? "",
          o.sample_email ?? "", o.sample_phone ?? "", o.corporate_address ?? "", o.licensee_entity_code ?? ""]);
      }
      file = `Liquor_Operators_${stamp}.xlsx`;
    } else if (view === "changes") {
      const changes = [];
      for (let offset = 0; offset < 10000; offset += 1000) {
        const r = await listChanges({
          city: sp.get("city"), county: sp.get("county"), sale_types: multi(sp, "sale"),
          since: sp.get("since") || null, types: multi(sp, "types"), limit: 1000, offset,
        });
        changes.push(...r.changes);
        if (!r.has_more) break;
      }
      const label = Object.fromEntries(CHANGE_TYPES.map((c) => [c.value, c.label]));
      const ws = sheet(wb, "Changes", `Liquor license changes between rosters${criteria ? ` — ${criteria}` : ""}`,
        `${changes.length} changes · exported ${stamp}`,
        ["Roster", "Change", "Was", "Now", "License #", "Trade name", "Type", "Street", "City", "County", "Licensee", "Manager", "Phone", "Email"],
        [11, 26, 30, 30, 10, 32, 10, 30, 16, 12, 32, 22, 14, 30]);
      for (const c of changes) {
        ws.addRow([c.snapshot_date, label[c.change_type] ?? c.change_type,
          c.change_type === "new" || c.change_type === "dropped" ? "" : c.old_value ?? "",
          c.change_type === "new" || c.change_type === "dropped" ? "" : c.new_value ?? "",
          c.license_number, c.trade_name ?? "", saleTypeLabel(c.sale_type), c.premises_street ?? "", c.premises_city ?? "",
          c.county ?? "", c.licensee ?? "", c.manager_name ?? "", c.phone ?? "", c.email ?? ""]);
      }
      file = `Liquor_Changes_${stamp}.xlsx`;
    } else {
      const rows = await searchAllLicenses({
        q: sp.get("q"), city: sp.get("city"), county: sp.get("county"), sale_types: multi(sp, "sale"),
        status: sp.get("status"), min_operator: sp.get("min_operator"), brand: sp.get("brand"), sort: sp.get("sort"),
      });
      const ws = sheet(wb, "Licenses", `Liquor licenses${criteria ? ` — ${criteria}` : ""}`,
        `${asOf} · ${rows.length} licenses · exported ${stamp} · public record, unverified`,
        ["Trade name", "Street", "City", "Zip", "County", "Type", "Class", "Licensee", "Operator licenses", "Manager",
          "Phone", "Email", "Corporate address", "Brand", "CRM company", "CRM property", "Status", "First on roster", "License #"],
        [32, 30, 16, 11, 12, 10, 7, 34, 10, 24, 14, 32, 40, 22, 12, 12, 10, 12, 10]);
      for (const l of rows) {
        ws.addRow([l.trade_name ?? "", l.premises_street ?? "", l.premises_city ?? "", l.premises_zip ?? "", l.county ?? "",
          saleTypeLabel(l.sale_type), l.class ?? "", l.licensee ?? "", l.operator_licenses, l.manager_name ?? "",
          l.phone ?? "", l.email ?? "", l.corporate_address ?? "", l.brand_name ?? "", l.licensee_entity_code ?? "",
          l.property_code ?? "", l.status === "active" ? "Active" : `Dropped ${l.dropped_on ?? ""}`, l.first_seen_on ?? "",
          l.license_number]);
      }
    }
  } catch (e) {
    return new Response(`Export failed: ${e instanceof Error ? e.message : String(e)}`, { status: 500 });
  }

  const buf = await wb.xlsx.writeBuffer();
  return new Response(buf as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${file}"`,
      "Cache-Control": "no-store",
    },
  });
}
