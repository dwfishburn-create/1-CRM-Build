import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { supabase } from "@/lib/supabase";
import { CAMPAIGN_STATUSES } from "@/lib/prospectChecklist";

// Listing campaigns (11/18/2026, migration 039): a dated send to a listing's
// prospect list, shown as a column on the Prospect Checklist.
//
// GET  ?project_id=            — campaigns on a project, with recipient counts.
// POST { project_id, name, sent_on?, notes? }                    — create one.
// POST { campaign_id, status, note?, project_contact_id | prospect_no }
//      — set one prospect's status for a campaign (sent / told_other /
//        not_sent / bounced; empty status removes the flag). prospect_no is
//        resolved within the campaign's project.
export async function GET(request: NextRequest) {
  const projectId = (request.nextUrl.searchParams.get("project_id") ?? "").trim();
  if (!projectId) return NextResponse.json({ error: "project_id is required." }, { status: 400 });
  const { data, error } = await supabase
    .from("project_campaigns")
    .select("id, name, sent_on, notes, created_at, recipients:project_campaign_recipients(status)")
    .eq("project_id", projectId)
    .order("sent_on", { ascending: true, nullsFirst: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const campaigns = (data ?? []).map(({ recipients, ...c }) => {
    const counts: Record<string, number> = {};
    for (const r of (recipients ?? []) as { status: string }[]) counts[r.status] = (counts[r.status] ?? 0) + 1;
    return { ...c, recipient_counts: counts };
  });
  return NextResponse.json({ campaigns });
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const s = (k: string) => String(body[k] ?? "").trim();

  if (s("campaign_id")) {
    const campaign_id = s("campaign_id");
    const { data: camp, error: cErr } = await supabase
      .from("project_campaigns").select("id, project_id").eq("id", campaign_id).maybeSingle();
    if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });
    if (!camp) return NextResponse.json({ error: "Campaign not found." }, { status: 404 });

    let project_contact_id = s("project_contact_id");
    if (!project_contact_id && s("prospect_no")) {
      const { data: pc, error } = await supabase
        .from("project_contacts").select("id")
        .eq("project_id", camp.project_id).eq("prospect_no", Number(s("prospect_no"))).maybeSingle();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      if (!pc) return NextResponse.json({ error: `No prospect #${s("prospect_no")} on this listing.` }, { status: 404 });
      project_contact_id = pc.id;
    }
    if (!project_contact_id) {
      return NextResponse.json({ error: "project_contact_id or prospect_no is required." }, { status: 400 });
    }
    const status = s("status");
    if (!status) {
      const { error } = await supabase.from("project_campaign_recipients").delete()
        .eq("campaign_id", campaign_id).eq("project_contact_id", project_contact_id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ removed: true });
    }
    if (!CAMPAIGN_STATUSES.some((x) => x.value === status)) {
      return NextResponse.json({ error: "status must be sent, told_other, not_sent or bounced (or empty to clear)." }, { status: 400 });
    }
    const { data, error } = await supabase
      .from("project_campaign_recipients")
      .upsert(
        { campaign_id, project_contact_id, status, note: s("note") || null, updated_at: new Date().toISOString() },
        { onConflict: "campaign_id,project_contact_id" }
      )
      .select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ recipient: data }, { status: 201 });
  }

  const project_id = s("project_id");
  const name = s("name");
  if (!project_id || !name) {
    return NextResponse.json({ error: "project_id and name are required (or campaign_id to set a recipient)." }, { status: 400 });
  }
  const { data, error } = await supabase
    .from("project_campaigns")
    .insert({ project_id, name, sent_on: s("sent_on") || null, notes: s("notes") || null })
    .select().single();
  if (error) {
    const status = error.code === "23505" ? 409 : 500;
    return NextResponse.json({ error: status === 409 ? `A campaign named "${name}" already exists on this project.` : error.message }, { status });
  }
  return NextResponse.json({ campaign: data }, { status: 201 });
}
