import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { importRoster, LiquorError } from "@/lib/liquorLicenses";
import { parseRoster, RosterError } from "@/lib/liquorRoster";

// POST /liquor-licenses/import/upload — the roster upload (a plain form post
// from /liquor-licenses/import). Behind the CRM sign-in like every page
// (proxy.ts). Parses the NLCC workbook, keeps Nebraska retail + misc
// licenses, stages them in 1,000-row chunks and imports the snapshot; the
// diff and the auto-linking run in SQL (migration 032). Redirects back to the
// import page with the result in the querystring.

export const maxDuration = 60;

function back(request: NextRequest, params: Record<string, string | number>) {
  const url = new URL("/liquor-licenses/import", request.url);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  return NextResponse.redirect(url, 303);
}

export async function POST(request: NextRequest) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return back(request, { error: "Couldn't read the upload." });
  }
  const file = form.get("file");
  const date = String(form.get("snapshot_date") || "").trim();
  if (!(file instanceof File) || file.size === 0) return back(request, { error: "Choose the roster .xlsx file." });
  if (!/\.xlsx$/i.test(file.name)) return back(request, { error: "The roster must be an .xlsx file." });

  try {
    const parsed = await parseRoster(Buffer.from(await file.arrayBuffer()), file.name);
    if (parsed.date_from_name && parsed.date_from_name !== date && form.get("date_ok") !== "yes") {
      return back(request, {
        error: `The file name says ${parsed.date_from_name} but the roster date entered is ${date || "blank"}. Fix the date, or tick "the date is right" and upload again.`,
      });
    }
    const r = await importRoster(parsed, date, file.name);
    return back(request, {
      done: r.batch_id,
      rows: r.rows,
      baseline: r.baseline ? 1 : 0,
      new: r.new,
      dropped: r.dropped,
      returned: r.returned,
      changed: r.changed,
      skipped: parsed.skipped_out_of_state + parsed.skipped_shipper,
      brand: r.links.active_with_brand,
      company: r.links.active_with_licensee_company,
      property: r.links.active_with_property,
    });
  } catch (e) {
    const msg = e instanceof RosterError || e instanceof LiquorError || e instanceof Error ? e.message : String(e);
    return back(request, { error: msg });
  }
}
