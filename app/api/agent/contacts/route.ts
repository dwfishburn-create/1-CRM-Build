import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { supabase } from "@/lib/supabase";
import { nextDisplayCode } from "@/lib/displayCode";

// GET /api/agent/contacts?limit=50 — list contacts, most recent first.
export async function GET(request: NextRequest) {
  const limitParam = request.nextUrl.searchParams.get("limit");
  const limit = limitParam ? Math.min(Number(limitParam) || 50, 200) : 50;

  const { data, error } = await supabase
    .from("contacts")
    .select("*, company:companies(id, display_code, name)")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ contacts: data });
}

// POST /api/agent/contacts — create a contact.
// Body: { first_name?, last_name?, email?, phone?, mobile_phone?, title?,
//         company_name?, notes? }
// Mirrors app/contacts/actions.ts:createContact field-for-field.
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const first_name = String(body.first_name || "").trim();
  const last_name = String(body.last_name || "").trim();
  const email = String(body.email || "").trim() || null;
  const phone = String(body.phone || "").trim() || null;
  const mobile_phone = String(body.mobile_phone || "").trim() || null;
  const title = String(body.title || "").trim() || null;
  const company_name = String(body.company_name || "").trim();
  const notes = String(body.notes || "").trim() || null;

  if (!first_name && !last_name) {
    return NextResponse.json(
      { error: "First or last name is required." },
      { status: 400 }
    );
  }

  let company_id: string | null = null;
  if (company_name) {
    const { data: existing, error: lookupError } = await supabase
      .from("companies")
      .select("id")
      .ilike("name", company_name)
      .maybeSingle();
    if (lookupError) {
      return NextResponse.json({ error: lookupError.message }, { status: 500 });
    }

    if (existing) {
      company_id = existing.id;
    } else {
      const companyCode = await nextDisplayCode("companies", "CO");
      const { data: newCompany, error: companyError } = await supabase
        .from("companies")
        .insert({ name: company_name, display_code: companyCode })
        .select("id")
        .single();
      if (companyError) {
        return NextResponse.json(
          { error: companyError.message },
          { status: 500 }
        );
      }
      company_id = newCompany.id;
    }
  }

  const display_code = await nextDisplayCode("contacts", "CON");

  const { data, error } = await supabase
    .from("contacts")
    .insert({
      display_code,
      first_name: first_name || null,
      last_name: last_name || null,
      email,
      phone,
      mobile_phone,
      title,
      company_id,
      notes,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ contact: data }, { status: 201 });
}
