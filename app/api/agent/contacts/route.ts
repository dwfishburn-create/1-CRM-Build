import { provenance } from "@/lib/provenance";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { supabase } from "@/lib/supabase";
import { nextDisplayCode } from "@/lib/displayCode";
import { parseListParams, resolveSelect, runSearch } from "@/lib/listQuery";
import {
  findNearMatches,
  blockingMatches,
  duplicateBlockResponse,
} from "@/lib/nearMatch";

// Columns a caller may name explicitly in ?fields=. search_text is
// deliberately absent — it is a derived concatenation with no value to a
// reader, and returning it would undo the response-size win it exists to buy.
const CONTACT_COLUMNS = [
  "id",
  "display_code",
  "first_name",
  "last_name",
  "email",
  "phone",
  "mobile_phone",
  "title",
  "entity_id",
  "notes",
  "needs_verification",
  "verification_note",
  "created_at",
  "updated_at",
] as const;

const ENTITY_EMBED = "entity:entities!entity_id(id, display_code, name)";

const CONTACT_SELECTS = {
  summary:
    "id, display_code, first_name, last_name, email, phone, mobile_phone, " +
    `title, entity_id, needs_verification, verification_note, ${ENTITY_EMBED}`,
  full: `*, ${ENTITY_EMBED}`,
};

// Fields that are booleans in the database and must not go through the
// String(...).trim() path the text fields use — String(false) is "false",
// a non-empty string, which is exactly how a "no" becomes a "yes".
const BOOLEAN_FIELDS = new Set(["needs_verification"]);

function coerceBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const s = String(value ?? "").trim().toLowerCase();
  return s === "true" || s === "1" || s === "yes";
}

// GET /api/agent/contacts — list or search contacts, most recent first.
//
// Query params:
//   search              free text, matched against the search_text column
//                       (first + last name, email, title). Whitespace-
//                       separated tokens are ANDed, so "richard secor"
//                       means both, not either.
//   needs_verification  "true" | "false" — filter to (un)verified records.
//   fields              "summary" (default) | "full" | explicit column list.
//   limit               default 25, max 100.
//   offset              for paging past the first page.
//
// Returns { contacts, count, limit, offset, has_more }. count is the total
// number of matching rows ignoring the page, so a caller can distinguish
// "no such contact" from "not on this page" — the ambiguity that made the
// old unfiltered endpoint unusable for deduplication.
//
// Rewritten 9/15/2026 for finding #1 in CRM_Findings_2026-09-15_BR-HyVee.md.
// Previously: no search, no offset, no field selection, limit default 50 /
// max 200, every column of every row. Two consecutive days of calls blew the
// MCP tool response cap (57,000 chars at 64 contacts on 9/14, ~63,000 on
// 9/15) and both times the workaround was dumping the whole table to a file
// and grepping it to answer a single existence question.
export async function GET(request: NextRequest) {
  const params = parseListParams(request.nextUrl.searchParams);

  const resolved = resolveSelect(params.fields, CONTACT_SELECTS, CONTACT_COLUMNS);
  if ("error" in resolved) {
    return NextResponse.json({ error: resolved.error }, { status: 400 });
  }

  const verificationParam = request.nextUrl.searchParams.get("needs_verification");
  const verificationFilter =
    verificationParam !== null && verificationParam !== ""
      ? coerceBoolean(verificationParam)
      : null;

  // Searching goes through search_contact_ids (migration 017), which
  // normalizes punctuation out of both the query and the name — so "obrien"
  // finds "O'Brien". needs_verification is passed into the function rather
  // than applied afterwards, so the count stays truthful.
  if (params.terms.length > 0) {
    const hits = await runSearch(
      (fn, args) => supabase.rpc(fn, args),
      "search_contact_ids",
      {
        p_q: request.nextUrl.searchParams.get("search") ?? "",
        p_limit: params.limit,
        p_offset: params.offset,
        p_needs_verification: verificationFilter,
      }
    );

    if ("error" in hits) {
      return NextResponse.json({ error: hits.error }, { status: 500 });
    }

    if (hits.ids.length === 0) {
      return NextResponse.json({
        contacts: [],
        count: hits.count,
        limit: params.limit,
        offset: params.offset,
        has_more: false,
      });
    }

    const { data: rows, error: rowError } = await supabase
      .from("contacts")
      .select(resolved.select)
      .in("id", hits.ids)
      .order("created_at", { ascending: false });

    if (rowError) {
      return NextResponse.json({ error: rowError.message }, { status: 500 });
    }

    return NextResponse.json({
      contacts: rows,
      count: hits.count,
      limit: params.limit,
      offset: params.offset,
      has_more: params.offset + (rows?.length ?? 0) < hits.count,
    });
  }

  let query = supabase
    .from("contacts")
    .select(resolved.select, { count: "exact" })
    .order("created_at", { ascending: false })
    .range(params.offset, params.offset + params.limit - 1);

  if (verificationFilter !== null) {
    query = query.eq("needs_verification", verificationFilter);
  }

  const { data, error, count } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    contacts: data,
    count: count ?? null,
    limit: params.limit,
    offset: params.offset,
    has_more: count === null ? false : params.offset + (data?.length ?? 0) < count,
  });
}

// POST /api/agent/contacts — create a contact.
// Body: { first_name?, last_name?, email?, phone?, mobile_phone?, title?,
//         entity_id?, company_name?, notes?, needs_verification?,
//         verification_note? }
// entity_id: link directly to an existing entities row when the caller
// already has its id (e.g. from a prior /api/agent/entities call) — this is
// the preferred way to link, and skips the lookup-or-create below entirely.
// company_name: fallback for callers that only know a name, not an id —
// looks up an existing entity by name (case-insensitive) or creates one.
// If both are provided, entity_id wins and company_name is ignored.
// Mirrors app/contacts/actions.ts:createContact field-for-field, plus
// entity_id which that form doesn't expose yet.
//
// Bug fixed 8/26/2026: previously this route silently ignored a bare
// entity_id in the body (only company_name was ever read), so a caller
// linking a contact by id got no error and no link — the row just saved
// with entity_id: null. See CRM_Requirements_and_Decisions_Log.md.
//
// needs_verification / verification_note added 9/15/2026 (finding #4): a
// record built from an inference — a last name guessed off an email handle,
// a person not yet identified behind a shared address — is now flagged as
// such in a queryable column instead of a sentence buried in notes.
//
// Duplicate check added 9/24/2026 (migration 016). Before inserting, this
// route runs find_similar_contacts and REFUSES with 409 if anything scores at
// or above the block threshold — same email, same first+last name, or same
// last name with the same first initial (the Mitch/Mitchell case that produced
// CON-0074). The response carries the candidates so the caller can link to the
// existing record instead. allow_duplicate: true overrides, for the genuine
// two-people-same-name case. See lib/nearMatch.ts for why this blocks rather
// than warns.
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
  const entity_id_input = String(body.entity_id || "").trim();
  const company_name = String(body.company_name || "").trim();
  const notes = String(body.notes || "").trim() || null;
  const needs_verification =
    "needs_verification" in body ? coerceBoolean(body.needs_verification) : false;
  const verification_note = String(body.verification_note || "").trim() || null;

  if (!first_name && !last_name) {
    return NextResponse.json(
      { error: "First or last name is required." },
      { status: 400 }
    );
  }

  const allow_duplicate = coerceBoolean(body.allow_duplicate);
  let possible_duplicates: unknown[] = [];
  let duplicate_check: string | null = null;

  const near = await findNearMatches("find_similar_contacts", {
    p_first: first_name || null,
    p_last: last_name || null,
    p_email: email,
    p_limit: 5,
  });

  if (!near.ok) {
    // A broken duplicate check must not take the create path down with it —
    // see lib/nearMatch.ts. Say so in the response instead of failing silently.
    duplicate_check = `not run: ${near.error}`;
  } else {
    possible_duplicates = near.candidates;
    const blocking = blockingMatches(near.candidates);
    if (blocking.length > 0 && !allow_duplicate) {
      return duplicateBlockResponse("contact", blocking);
    }
    if (blocking.length > 0) {
      duplicate_check = "overridden by allow_duplicate";
    }
  }

  let entity_id: string | null = null;
  if (entity_id_input) {
    entity_id = entity_id_input;
  } else if (company_name) {
    const { data: existing, error: lookupError } = await supabase
      .from("entities")
      .select("id")
      .ilike("name", company_name)
      .maybeSingle();
    if (lookupError) {
      return NextResponse.json({ error: lookupError.message }, { status: 500 });
    }

    if (existing) {
      entity_id = existing.id;
    } else {
      const entityCode = await nextDisplayCode("entities", "ENT");
      const { data: newEntity, error: entityError } = await supabase
        .from("entities")
        .insert({ name: company_name, display_code: entityCode })
        .select("id")
        .single();
      if (entityError) {
        return NextResponse.json(
          { error: entityError.message },
          { status: 500 }
        );
      }
      entity_id = newEntity.id;
    }
  }

  const display_code = await nextDisplayCode("contacts", "CON");

  const { data, error } = await supabase
    .from("contacts")
    .insert({
      ...provenance(body),
      display_code,
      first_name: first_name || null,
      last_name: last_name || null,
      email,
      phone,
      mobile_phone,
      title,
      entity_id,
      notes,
      needs_verification,
      verification_note,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Near misses below the block threshold are still reported on the way out —
  // the caller should see "there is a Mike Shindler on file" even when it let
  // a Michael Shindler through.
  return NextResponse.json(
    {
      contact: data,
      ...(possible_duplicates.length > 0 ? { possible_duplicates } : {}),
      ...(duplicate_check ? { duplicate_check } : {}),
    },
    { status: 201 }
  );
}

// PATCH /api/agent/contacts — update one or more fields on an existing
// contact. Body: { id, ...fields }. Only the fields actually present in the
// body are written — an omitted field is left untouched (partial update,
// not a full replace); passing a text field as an empty string clears it to
// null (e.g. entity_id: "" to unlink from its entity). Accepts the same
// field set POST does, minus display_code (never editable): first_name,
// last_name, email, phone, mobile_phone, title, entity_id, notes,
// needs_verification, verification_note. At least one field besides id is
// required.
//
// Added 9/1/2026 to close the gap flagged in
// CRM_Requirements_and_Decisions_Log.md ("Missing update_contact MCP
// tool") — until now contacts had no update/PATCH path at all, so
// correcting or filling in a field on an existing contact (e.g. adding a
// confirmed email after the fact) meant a manual Supabase SQL UPDATE, same
// as the Astlali spelling-fix workaround. Deliberately narrow — same
// pattern as the properties/tasks PATCH endpoints, not a general-purpose
// arbitrary-column update.
//
// 9/15/2026: needs_verification is handled separately from the text fields.
// The original loop ran every value through String(...).trim() || null,
// which turns a literal false into the string "false" — truthy — so clearing
// the flag would have set it. Booleans go through coerceBoolean instead.
export async function PATCH(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const id = String(body.id || "").trim();
  if (!id) {
    return NextResponse.json({ error: "id is required." }, { status: 400 });
  }

  const editableFields = [
    "first_name",
    "last_name",
    "email",
    "phone",
    "mobile_phone",
    "title",
    "entity_id",
    "notes",
    "needs_verification",
    "verification_note",
  ] as const;

  const updatePayload: Record<string, unknown> = {};
  for (const field of editableFields) {
    if (field in body) {
      if (BOOLEAN_FIELDS.has(field)) {
        updatePayload[field] = coerceBoolean(body[field]);
      } else {
        const value = String(body[field] ?? "").trim();
        updatePayload[field] = value || null;
      }
    }
  }

  if (Object.keys(updatePayload).length === 0) {
    return NextResponse.json(
      {
        error:
          "Provide at least one field to update: " + editableFields.join(", ") + ".",
      },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("contacts")
    .update(updatePayload)
    .eq("id", id)
    .select(`*, ${ENTITY_EMBED}`)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ contact: data });
}

// DELETE /api/agent/contacts?id=<uuid>&force=true — remove a contact.
//
// Added 9/15/2026 for finding #2. Refuses by default when anything still
// references the contact, and returns the breakdown of what does, because
// the overwhelmingly common case for wanting a contact gone is that it is a
// duplicate — and for a duplicate, merge_contacts is the correct operation:
// delete throws away the links (project_contacts and contact_entities
// cascade; activity_log, tasks and leases null out), merge keeps them.
//
// force=true deletes anyway, for the case delete is actually right: a row
// created in error with nothing attached, or one whose links are genuinely
// worthless.
//
// Two link types are refused even with force. leases and property_tenant
// each carry a check constraint requiring at least one of (entity, contact),
// and their contact FKs are ON DELETE SET NULL — so deleting the only party
// on such a row makes Postgres null the column and then fail the check. That
// would surface as an opaque constraint violation after the guard had
// already said yes; better to name it here and let the caller fix the row
// first.
export async function DELETE(request: NextRequest) {
  const id = (request.nextUrl.searchParams.get("id") || "").trim();
  if (!id) {
    return NextResponse.json(
      { error: "id is required, as a query parameter: ?id=<uuid>" },
      { status: 400 }
    );
  }

  const force = coerceBoolean(request.nextUrl.searchParams.get("force"));

  const { data: contact, error: findError } = await supabase
    .from("contacts")
    .select("id, display_code, first_name, last_name, email")
    .eq("id", id)
    .maybeSingle();

  if (findError) {
    return NextResponse.json({ error: findError.message }, { status: 500 });
  }
  if (!contact) {
    return NextResponse.json({ error: `No contact with id ${id}.` }, { status: 404 });
  }

  const { data: links, error: linkError } = await supabase.rpc("contact_link_counts", {
    p_id: id,
  });

  if (linkError) {
    return NextResponse.json({ error: linkError.message }, { status: 500 });
  }

  const counts = (links ?? {}) as Record<string, unknown>;
  const soleParty = (counts.sole_party_blocks ?? {}) as Record<string, number>;
  const linked = Object.entries(counts)
    .filter(([key, value]) => key !== "sole_party_blocks" && Number(value) > 0)
    .map(([key, value]) => `${key}: ${value}`);

  const hardBlocks = Object.entries(soleParty)
    .filter(([, value]) => Number(value) > 0)
    .map(([key, value]) => `${key}: ${value}`);

  if (hardBlocks.length > 0) {
    return NextResponse.json(
      {
        error:
          "Refused: this contact is the only party on a lease or tenancy row, " +
          "and those rows require at least one of (entity, contact). Deleting " +
          "would violate that constraint. Attach an entity to those rows, or " +
          "merge this contact into another, first.",
        blocking: hardBlocks,
        links: counts,
        contact,
      },
      { status: 409 }
    );
  }

  if (linked.length > 0 && !force) {
    return NextResponse.json(
      {
        error:
          `Refused: ${linked.length} table(s) still reference this contact. ` +
          "If this is a duplicate, use merge_contacts (POST /api/agent/contacts/merge) " +
          "so the links move to the surviving record instead of being destroyed. " +
          "If deletion really is right, repeat with force=true.",
        links: counts,
        contact,
      },
      { status: 409 }
    );
  }

  const { error: deleteError } = await supabase.from("contacts").delete().eq("id", id);

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  return NextResponse.json({
    deleted: true,
    contact,
    links_destroyed: linked.length > 0 ? counts : null,
  });
}
