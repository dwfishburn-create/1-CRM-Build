import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { loadProspectChecklist } from "@/lib/prospectChecklist";

// GET /api/agent/prospect-checklist?project_id=...&prospect_no=19
// The Prospect Checklist for one listing (11/18/2026, migration 039): every
// buyer prospect with #, first contact, contact info, source, stage, last
// action, open task and campaign flags — the same rows as the web page and
// the .xlsx export. prospect_no narrows to one row, which is how "#19 talked,
// wants tour" is resolved to a contact before logging it.
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const projectId = (sp.get("project_id") ?? "").trim();
  if (!projectId) return NextResponse.json({ error: "project_id is required." }, { status: 400 });
  try {
    const checklist = await loadProspectChecklist(projectId);
    if (!checklist) return NextResponse.json({ error: "Project not found." }, { status: 404 });
    const no = sp.get("prospect_no");
    const stage = sp.get("stage");
    const notCalled = sp.get("not_called") === "true";
    let rows = checklist.rows;
    if (no) rows = rows.filter((r) => r.prospect_no === Number(no));
    if (stage) rows = rows.filter((r) => r.stage === stage);
    if (notCalled) rows = rows.filter((r) => !r.called_on);
    // milestone=ca|package|offer (migration 041): only prospects that reached it.
    const milestone = sp.get("milestone");
    if (milestone === "ca") rows = rows.filter((r) => !!r.ca_signed_on);
    if (milestone === "package") rows = rows.filter((r) => r.package_sent);
    if (milestone === "offer") rows = rows.filter((r) => r.offer_made);
    return NextResponse.json({ ...checklist, rows, total: checklist.rows.length });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
