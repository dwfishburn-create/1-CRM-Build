import { createMcpHandler, withMcpAuth } from "mcp-handler";
import type { AuthInfo } from "@modelcontextprotocol/server";
import { z } from "zod";
import {
  agentApiGet,
  agentApiPost,
  agentApiPatch,
  agentApiDelete,
  type AgentApiResult,
} from "@/lib/agentApiClient";
import { getSopChecklist } from "@/lib/sopMatrix";

// MCP connector for the CRM's Agent API — added 8/27/2026 (see
// CRM_Requirements_and_Decisions_Log.md, "standing MCP connector" entry).
//
// Why this file exists: every prior session that wanted to write to the CRM
// needed Dan to paste a fresh AGENT_API_TOKEN into the conversation, because
// that token is a write-only Vercel Secret with no durable way for a Claude
// session to hold it across conversations. This route lets Dan instead add
// ONE custom connector in Claude's own settings (Customize -> Connectors ->
// Add custom connector), using Claude's Static API Key auth mode: a header
// value entered once there, then attached automatically by Claude on every
// future request, from any session. That header is checked below against
// MCP_API_TOKEN — a separate secret from AGENT_API_TOKEN, so this connector
// can be rotated or revoked independently of direct Agent API/curl access.
//
// Every tool here is a thin pass-through to the matching existing
// /api/agent/* Route Handler (see lib/agentApiClient.ts) rather than a
// second copy of its insert/validation logic — deliberately, so there is
// exactly one place each table's field handling lives.
//
// Scope (v1): the eight resources actually used for "get a new listing/deal
// into the CRM" (entities, contacts, properties, projects, and the four
// link/log tables) — the workflow this was built to remove the token-paste
// step from. tasks/sale-comps/lease-comps are not yet wrapped; add them
// here the same way, if/when a session needs to write to them without a
// pasted token.
//
// contact_entities added 8/31/2026 (migration 009) — a contact<->entity
// many-to-many link, for when one person is a principal of more than one
// company. See the "Contact<->Entity relationship is 1:1" decision in
// CRM_Requirements_and_Decisions_Log.md.
//
// requirements/requirement_parties added 9/3/2026 — the `requirements` and
// `requirement_parties` tables and their /api/agent/* routes already
// existed (built 8/25/2026, see CRM_Requirements_and_Decisions_Log.md) but
// were never wrapped as MCP tools, so every requirement had to go in via
// the web form. Wrapped the same way as everything else here: a thin
// pass-through to the existing routes, no new insert/validation logic.
//
// spaces/leases added 9/8/2026 — the Space/Lease data model (migration 011,
// Phase 1) was built the same day but shipped schema-only, with the first
// real data (The Shoppes at Lexington rent roll) loaded directly via the
// Supabase REST API rather than through any Agent API route or MCP tool.
// This closes that gap — see CRM_Requirements_and_Decisions_Log.md.
//
// lease-events/property-expenses added — Phase 2 of the Space/Lease data
// model (migration 012), closing the two items deliberately parked at
// Phase 1 (9/8/2026) until that core was proven against real rent-roll
// data. Same thin-pass-through convention as everything else here.
//
// update_requirement added 9/13/2026 — the 9/3/2026 Requirements build
// shipped create/list/link but no way to edit an existing requirement
// afterward (flagged 9/11/2026 — see CRM_Requirements_and_Decisions_Log.md).
// Same thin-pass-through convention, now against a new PATCH handler on
// the existing /api/agent/requirements route.
//
// get_sop_matrix / update_sop_matrix added 9/14/2026, and get_sop_checklist
// became async in the same pass — migration 013 moved the companion-SOP
// routing matrix out of a hardcoded copy in lib/sopMatrix and into the
// sop_matrix table. See CRM_Requirements_and_Decisions_Log.md, 9/14/2026:
// the old static copy was never actually WRONG, but re-syncing it meant a
// code change plus a deploy, so it sat at 2026-08-26 while the SOP doc moved
// to 2026-09-05 and nobody reconciled it. It also could not report a gap for
// an SOP that had no row at all, which is how the missing Due Diligence
// Documents SOP stayed invisible on a live BR deal. Both are now data
// problems rather than code problems.
//
// get_sop_checklist stays a direct lib call rather than a pass-through,
// which is how it has always worked — it does its own shaping and has no
// insert/validation logic to duplicate. The two new tools follow the normal
// pass-through convention against /api/agent/sop-matrix.
//
// find_contact / merge_contacts / delete_contact added 9/15/2026, and
// list_contacts / list_entities gained search, offset and field selection in
// the same pass — findings #1, #2 and #4 in
// CRM_Findings_2026-09-15_BR-HyVee.md, from running the BR-Hy-Vee 108th &
// Hwy 370 title commitment through the CRM.
//
// The short version of why all of this shipped together: list_contacts had
// no lookup and returned every column of every row, so checking whether a
// person already existed meant dumping all 64 records (over the tool
// response cap, twice) and grepping the dump. Without that check a duplicate
// got created — CON-0068, which was already on file as Daniel E. Moore
// (CON-0058) — and with no merge or delete, the fix could only be a
// permanent tombstone row. No lookup creates duplicates; no merge makes them
// permanent. Fixing either alone leaves half the problem, so neither shipped
// alone.
//
// Note on naming: find_contact is a thin wrapper over the same search
// parameter list_contacts now accepts, and that redundancy is deliberate.
// Tools get reached for by name. A session hunting "does this person exist"
// will find find_contact immediately; it may never notice that list_contacts
// grew a search parameter.
//
// find_entity / merge_entities / delete_entity / find_property /
// merge_properties / delete_property / add_entity_alias /
// list_entity_aliases / delete_entity_alias added 9/24/2026 (migration 016),
// and list_properties gained search, offset and field selection in the same
// pass. This is the second half of the duplicate-prevention work 014 started,
// and the gate on the RealNex import (Dan's call, 9/22/2026).
//
// The audit that prompted it: 014 fixed contacts and left the other two core
// tables where contacts had been. Entities had no alias list, no near-match
// check and no merge — list_entities' own description admitted that a
// duplicate entity "becomes permanent." Properties had no lookup at all.
// And create_contact, though find_contact now sat beside it, still checked
// nothing itself; its description told the caller to remember, which is the
// discipline that failed four times in three days.
//
// So the check moved into the write path. create_contact, create_entity and
// create_property now run a near-match query server-side and REFUSE a create
// that looks like an existing record, returning the candidates so the caller
// can link to it instead. allow_duplicate overrides, deliberately, for the
// real two-people-same-name case. 26,156 contacts are waiting to import,
// 13,642 of them in exact duplicate triples: a rule the caller has to
// remember is a rule that breaks at that volume.

function toolResult(result: AgentApiResult) {
  if (!result.ok) {
    return {
      isError: true as const,
      content: [
        {
          type: "text" as const,
          text: `Agent API error (HTTP ${result.status}): ${JSON.stringify(result.body)}`,
        },
      ],
    };
  }
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result.body, null, 2) }],
  };
}

const limitArg = { limit: z.number().int().min(1).max(200).optional() };

// Provenance (migration 018, wired through 9/24/2026). Optional on every
// create tool whose table carries the columns. source_record_id is the foreign
// system's own key (e.g. a RealNex space GUID); (source_system,
// source_record_id) is unique per table, so loading the same foreign record
// twice is refused rather than duplicated. source_batch_id groups one load run
// so it can be reversed.
const provenanceArgs = {
  source_system: z.string().optional(),
  source_record_id: z.string().optional(),
  source_batch_id: z.string().optional(),
};

// Args for the searchable, paginated list endpoints (contacts, entities).
// limit maxes at 100 rather than 200 — the server caps it there anyway as of
// 9/15/2026, and a schema that advertises a limit the server will silently
// reduce is worse than one that says the real number.
const searchableListArgs = {
  search: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional(),
  offset: z.number().int().min(0).optional(),
  fields: z.string().optional(),
};

const handler = createMcpHandler(
  (server) => {
    // --- entities ---
server.registerTool(
  "list_owner_signals",
  {
    title: "List owner signals",
    description:
      "List owner signals — dated indications of what a property's owner would accept " +
      "(\"I'd sell at $2.4M\", \"I'd lease at $18 NNN\", \"not interested\"). Migration 015. " +
      "Sorted NEWEST SIGNAL_DATE FIRST: the current signal for a property is the most " +
      "recent row, and older rows are kept deliberately because the movement between an " +
      "owner's numbers is negotiating leverage. Optionally filter by property_id, " +
      "contact_id, entity_id or signal_type. CONFIDENTIAL — never put this in anything " +
      "client-facing unless Dan says so.",
    inputSchema: {
      limit: z.number().int().min(1).max(200).optional(),
      property_id: z.string().optional(),
      contact_id: z.string().optional(),
      entity_id: z.string().optional(),
      signal_type: z.string().optional(),
    },
  },
  async ({ limit, property_id, contact_id, entity_id, signal_type }) =>
    toolResult(
      await agentApiGet("owner-signals", {
        limit: limit?.toString(),
        property_id,
        contact_id,
        entity_id,
        signal_type,
      })
    )
);
server.registerTool(
  "create_owner_signal",
  {
    title: "Create owner signal",
    description:
      "Record what a property owner has indicated they'd accept. property_id and " +
      "signal_type are required; signal_date defaults to today. " +
      "A NEW CONVERSATION IS A NEW ROW — call this every time an owner says something " +
      "new, even about a property that already has signals. Never update an old signal " +
      "to a newer number; the history is the point. " +
      "This is NOT a Requirement (requirements are demand — 'find this for me' — and " +
      "have no property link) and NOT properties.market_status (how a property is " +
      "marketed and what its owner would accept are independent facts). If the owner " +
      "actually engages Dan to find a buyer, that's a project, not a signal. " +
      "signal_type is free text — suggested: Would Sell, Would Lease, Would Sell or " +
      "Lease, Not Interested, Other. source is free text — suggested: Direct " +
      "Conversation, Secondhand, Inferred ('Inferred' keeps a read-between-the-lines " +
      "read distinguishable from something the owner actually said). " +
      "contact_id (who said it) and entity_id (the owner entity) are independent — " +
      "either can be known without the other. indicated_rent_basis records the unit the " +
      "rent was quoted in, because owners quote rent every possible way. " +
      "CONFIDENTIAL by default — never client-facing unless Dan says so.",
    inputSchema: {
      property_id: z.string().min(1),
      signal_type: z.string().min(1),
      signal_date: z.string().optional(),
      contact_id: z.string().optional(),
      entity_id: z.string().optional(),
      source: z.string().optional(),
      indicated_price: z.number().optional(),
      indicated_rent: z.number().optional(),
      indicated_rent_basis: z.string().optional(),
      conditions: z.string().optional(),
      notes: z.string().optional(),
    },
  },
  async (args) => toolResult(await agentApiPost("owner-signals", args))
);
server.registerTool(
  "update_owner_signal",
  {
    title: "Update owner signal",
    description:
      "CORRECT an existing owner signal by id — a mistyped price, the wrong contact, a " +
      "date off by a day. THIS IS NOT HOW YOU RECORD A CHANGED NUMBER: if the owner said " +
      "something new, call create_owner_signal instead. Overwriting a signal destroys the " +
      "history this table exists to keep. " +
      "Only the fields provided are changed; omitted fields are left as-is. Pass a " +
      "clearable string field as an empty string to clear it. property_id, signal_date " +
      "and signal_type are required and cannot be cleared. At least one field besides id " +
      "is required.",
    inputSchema: {
      id: z.string().min(1),
      property_id: z.string().optional(),
      signal_type: z.string().optional(),
      signal_date: z.string().optional(),
      contact_id: z.string().optional(),
      entity_id: z.string().optional(),
      source: z.string().optional(),
      indicated_price: z.number().optional(),
      indicated_rent: z.number().optional(),
      indicated_rent_basis: z.string().optional(),
      conditions: z.string().optional(),
      notes: z.string().optional(),
    },
  },
  async (args) => toolResult(await agentApiPatch("owner-signals", args))
);    
server.registerTool(
      "list_entities",
      {
        title: "List or search entities",
        description:
          "List entities (owners, tenants, companies), most recently created first, or " +
          "search them by name. search matches legal name, trade name (d/b/a) and industry; " +
          "multiple words are ANDed, so 'moore trust' requires both. Returns count and " +
          "has_more alongside the rows, so an empty result means no such entity rather than " +
          "'not on this page'. Search also covers recorded aliases (other names the same " +
          "company is known by), so a d/b/a or an assessor spelling finds the real record, " +
          "and ignores punctuation and LLC/Inc/Corp/Trust (migration 017). " +
          "fields: 'summary' (default) or 'full' for notes and timestamps. Prefer find_entity " +
          "when the question is simply whether a company already exists.",
        inputSchema: searchableListArgs,
      },
      async ({ search, limit, offset, fields }) =>
        toolResult(
          await agentApiGet("entities", {
            search,
            limit: limit?.toString(),
            offset: offset?.toString(),
            fields,
          })
        )
    );
    server.registerTool(
      "create_entity",
      {
        title: "Create entity",
        description:
          "Create an entity — an owner LLC, a tenant company, a corporation, etc. REFUSES " +
          "with a 409 if the name matches a company already on file, and returns the " +
          "matches: comparison ignores punctuation and LLC/Inc/Corp/Trust, and covers " +
          "recorded aliases, so 'Ashley Lynns Inc' finds \"Ashley Lynn's Inc.\" and " +
          "'TitleCore National' finds 'TitleCore, LLC'. Use the id it hands back rather " +
          "than creating a second record; pass allow_duplicate: true only when it really " +
          "is a different company. aliases: other names this company is known by (the name " +
          "on the lease, the assessor's spelling, a d/b/a) — recording them here is what " +
          "stops the next session creating a duplicate under one of those names.",
        inputSchema: {
          ...provenanceArgs,
          name: z.string().min(1),
          trade_name: z.string().optional(),
          entity_type: z.string().optional(),
          industry: z.string().optional(),
          website: z.string().optional(),
          primary_contact_id: z.string().optional(),
          notes: z.string().optional(),
          aliases: z.array(z.string()).optional(),
          allow_duplicate: z.boolean().optional(),
        },
      },
      async (args) => toolResult(await agentApiPost("entities", args))
    );
    server.registerTool(
      "find_entity",
      {
        title: "Find a company by name",
        description:
          "Look up whether a company is ALREADY in the CRM, by any name it might be under — " +
          "legal name, trade name, d/b/a, or a recorded alias. Call this before " +
          "create_entity. Matching ignores punctuation and entity suffixes, so " +
          "'buyers realty' finds \"Buyer's Realty, Inc.\" and 'ashley lynns' finds " +
          "\"Ashley Lynn's Inc.\" — it runs the same normalizer the duplicate check uses " +
          "(migration 017; before that, this tool claimed to do so and did not). Returns " +
          "count, so count: 0 means the company genuinely is not on file.",
        inputSchema: {
          query: z.string().min(1),
          limit: z.number().int().min(1).max(100).optional(),
          fields: z.string().optional(),
        },
      },
      async ({ query, limit, fields }) =>
        toolResult(
          await agentApiGet("entities", {
            search: query,
            limit: limit?.toString(),
            fields,
          })
        )
    );
    server.registerTool(
      "merge_entities",
      {
        title: "Merge a duplicate company",
        description:
          "Fold a duplicate entity into the record that should survive. keep_id stays; " +
          "merge_id is REMOVED. Every reference — property ownership, tenancies, leases as " +
          "tenant or landlord, contacts' employer, project roles, requirement parties, " +
          "activity, tasks, owner signals — is repointed onto the survivor first, in one " +
          "transaction. The survivor wins every populated field; the duplicate only fills " +
          "blanks, and its notes are appended with a provenance line. The duplicate's name " +
          "and trade name are KEPT as aliases on the survivor, so a later search for the " +
          "merged-away name still finds the right record. Use this, not delete_entity, for " +
          "a duplicate. Irreversible.",
        inputSchema: {
          keep_id: z.string().min(1),
          merge_id: z.string().min(1),
        },
      },
      async (args) => toolResult(await agentApiPost("entities/merge", args))
    );
    server.registerTool(
      "delete_entity",
      {
        title: "Delete an entity",
        description:
          "Permanently remove a company. Refuses, and reports what is still attached, if " +
          "anything references it — pass force: true to delete anyway and destroy those " +
          "links. If it is a DUPLICATE, use merge_entities instead. Use this only for a row " +
          "created in error. Irreversible.",
        inputSchema: {
          id: z.string().min(1),
          force: z.boolean().optional(),
        },
      },
      async ({ id, force }) =>
        toolResult(
          await agentApiDelete("entities", {
            id,
            force: force ? "true" : undefined,
          })
        )
    );
    server.registerTool(
      "add_entity_alias",
      {
        title: "Add an alias to a company",
        description:
          "Record another name a company is known by — the name on a lease, the assessor's " +
          "spelling, a d/b/a, a former name. Aliases feed both the entity search and the " +
          "duplicate check on create_entity, so adding one is how you stop a future session " +
          "creating a second record under that name. source: where the alias came from " +
          "('lease', 'assessor', 'secretary of state', free text).",
        inputSchema: {
          entity_id: z.string().min(1),
          alias: z.string().min(1),
          source: z.string().optional(),
          note: z.string().optional(),
        },
      },
      async (args) => toolResult(await agentApiPost("entity-aliases", args))
    );
    server.registerTool(
      "list_entity_aliases",
      {
        title: "List company aliases",
        description:
          "List recorded aliases, optionally for one entity (entity_id). Use it to see what " +
          "names an entity is already findable under before adding another.",
        inputSchema: {
          entity_id: z.string().optional(),
          limit: z.number().int().min(1).max(200).optional(),
        },
      },
      async ({ entity_id, limit }) =>
        toolResult(
          await agentApiGet("entity-aliases", {
            entity_id,
            limit: limit?.toString(),
          })
        )
    );
    server.registerTool(
      "delete_entity_alias",
      {
        title: "Remove a company alias",
        description:
          "Remove one recorded alias by its id (from list_entity_aliases). Removing an alias " +
          "makes that name stop matching this entity in search and in the duplicate check.",
        inputSchema: { id: z.string().min(1) },
      },
      async ({ id }) => toolResult(await agentApiDelete("entity-aliases", { id }))
    );
    server.registerTool(
      "update_entity",
      {
        title: "Update entity",
        description:
          "Update one or more fields on an EXISTING entity by id — name, entity_type, industry, " +
          "website, primary_contact_id, notes. Only the fields provided are changed; omitted " +
          "fields are left as-is. Pass a field as an empty string to clear it. At least one field " +
          "besides id is required. Added 9/2/2026 to close the gap where an existing entity's " +
          "name/etc. could only be set at creation time — e.g. a spelling correction like Astlali " +
          "Concina->Cocina previously needed a raw SQL UPDATE. See CRM_Requirements_and_Decisions_Log.md.",
        inputSchema: {
          id: z.string().min(1),
          name: z.string().optional(),
          entity_type: z.string().optional(),
          industry: z.string().optional(),
          website: z.string().optional(),
          primary_contact_id: z.string().optional(),
          notes: z.string().optional(),
        },
      },
      async (args) => toolResult(await agentApiPatch("entities", args))
    );

    // --- contacts ---
    server.registerTool(
      "list_contacts",
      {
        title: "List or search contacts",
        description:
          "List contacts (people), most recently created first, or search them. search " +
          "matches first name, last name, email and title, ignoring punctuation so 'obrien' " +
          "finds \"O'Brien\"; multiple words are ANDed, so " +
          "'richard secor' requires both rather than matching every Richard. Set " +
          "needs_verification: true to list only records flagged as unconfirmed. Returns " +
          "count and has_more alongside the rows. fields: 'summary' (default) or 'full' " +
          "for notes and timestamps. Default page is 25 rows, max 100.",
        inputSchema: {
          ...searchableListArgs,
          needs_verification: z.boolean().optional(),
        },
      },
      async ({ search, limit, offset, fields, needs_verification }) =>
        toolResult(
          await agentApiGet("contacts", {
            search,
            limit: limit?.toString(),
            offset: offset?.toString(),
            fields,
            needs_verification:
              needs_verification === undefined ? undefined : String(needs_verification),
          })
        )
    );
    server.registerTool(
      "find_contact",
      {
        title: "Find a contact by name or email",
        description:
          "Look up whether a person is ALREADY in the CRM, by name or email address. Call " +
          "this before create_contact, every time — it is the cheapest way to avoid a " +
          "duplicate, and duplicates are expensive to undo. Matches first name, last name, " +
          "email and title, ignoring punctuation (so 'obrien' finds \"O'Brien\"); multiple " +
          "words are ANDed. Returns count, so count: 0 means the " +
          "person genuinely is not on file. Same search as list_contacts, named for the " +
          "question it answers.",
        inputSchema: {
          query: z.string().min(1),
          limit: z.number().int().min(1).max(100).optional(),
          fields: z.string().optional(),
        },
      },
      async ({ query, limit, fields }) =>
        toolResult(
          await agentApiGet("contacts", {
            search: query,
            limit: limit?.toString(),
            fields,
          })
        )
    );
    server.registerTool(
      "create_contact",
      {
        title: "Create contact",
        description:
          "Create a contact (a person). REFUSES with a 409 if the person looks like someone " +
          "already on file — same email, same first and last name, or same last name with " +
          "the same first initial (Mitch / Mitchell) — and returns the matching records. " +
          "Use the id it hands back instead of creating a second row; pass " +
          "allow_duplicate: true only when it genuinely is a different person with a " +
          "similar name. find_contact is still worth running first when you want to see " +
          "what is there before writing. " +
          "Provide entity_id to link to an existing entity by id (preferred), or " +
          "company_name to look up/create an entity by name. At least one of " +
          "first_name/last_name is required. Set needs_verification: true whenever any part " +
          "of the record is inferred rather than confirmed — a last name guessed from an " +
          "email handle, a person not yet identified behind a shared address — and say what " +
          "is unconfirmed in verification_note. That is a queryable flag; a sentence in " +
          "notes is not.",
        inputSchema: {
          ...provenanceArgs,
          first_name: z.string().optional(),
          last_name: z.string().optional(),
          email: z.string().optional(),
          phone: z.string().optional(),
          mobile_phone: z.string().optional(),
          title: z.string().optional(),
          entity_id: z.string().optional(),
          company_name: z.string().optional(),
          notes: z.string().optional(),
          needs_verification: z.boolean().optional(),
          verification_note: z.string().optional(),
          allow_duplicate: z.boolean().optional(),
        },
      },
      async (args) => toolResult(await agentApiPost("contacts", args))
    );
    server.registerTool(
      "update_contact",
      {
        title: "Update contact",
        description:
          "Update one or more fields on an EXISTING contact by id — first_name, last_name, " +
          "email, phone, mobile_phone, title, entity_id, notes, needs_verification, " +
          "verification_note. Only the fields provided are changed; omitted fields are left " +
          "as-is. Pass a text field as an empty string to clear it (e.g. entity_id: \"\" to " +
          "unlink from its entity). Set needs_verification: false once a flagged record has " +
          "been confirmed against a source. At least one field besides id is required. Added " +
          "9/1/2026 to close the gap where an existing contact's email/phone/etc. could only " +
          "be set at creation time, not corrected or filled in afterward — see " +
          "CRM_Requirements_and_Decisions_Log.md.",
        inputSchema: {
          id: z.string().min(1),
          first_name: z.string().optional(),
          last_name: z.string().optional(),
          email: z.string().optional(),
          phone: z.string().optional(),
          mobile_phone: z.string().optional(),
          title: z.string().optional(),
          entity_id: z.string().optional(),
          notes: z.string().optional(),
          needs_verification: z.boolean().optional(),
          verification_note: z.string().optional(),
        },
      },
      async (args) => toolResult(await agentApiPatch("contacts", args))
    );
    server.registerTool(
      "merge_contacts",
      {
        title: "Merge a duplicate contact",
        description:
          "Fold a duplicate contact into the record that should survive. keep_id is the " +
          "contact that stays; merge_id is the duplicate, which is REMOVED. Every reference " +
          "to the duplicate — project links, entity affiliations, requirement parties, " +
          "activity log entries, tasks, tenancies and leases — is repointed onto the " +
          "surviving record first, in one transaction. The survivor wins every populated " +
          "field; the duplicate only fills blanks, and its notes are appended with a " +
          "provenance line rather than discarded. This is the right tool for a duplicate, " +
          "not delete_contact: delete destroys those links, merge keeps them. Irreversible.",
        inputSchema: {
          keep_id: z.string().min(1),
          merge_id: z.string().min(1),
        },
      },
      async (args) => toolResult(await agentApiPost("contacts/merge", args))
    );
    server.registerTool(
      "delete_contact",
      {
        title: "Delete a contact",
        description:
          "Permanently remove a contact. Refuses, and reports what is still attached, if " +
          "anything references it — pass force: true to delete anyway and destroy those " +
          "links. If the contact is a DUPLICATE, use merge_contacts instead; deleting a " +
          "duplicate throws away its project links, activity history and entity " +
          "affiliations rather than moving them to the surviving record. Use this only for " +
          "a row created in error. Irreversible.",
        inputSchema: {
          id: z.string().min(1),
          force: z.boolean().optional(),
        },
      },
      async ({ id, force }) =>
        toolResult(
          await agentApiDelete("contacts", {
            id,
            force: force ? "true" : undefined,
          })
        )
    );

    // --- contact_entities links ---
    server.registerTool(
      "list_contact_entities",
      {
        title: "List contact entity links",
        description:
          "List a contact's entity affiliations BEYOND their primary one (contacts.entity_id) — " +
          "e.g. a person who is a principal of more than one company. Optionally filter to one " +
          "contact or one entity.",
        inputSchema: {
          ...limitArg,
          contact_id: z.string().optional(),
          entity_id: z.string().optional(),
        },
      },
      async ({ limit, contact_id, entity_id }) =>
        toolResult(
          await agentApiGet("contact-entities", {
            limit: limit?.toString(),
            contact_id,
            entity_id,
          })
        )
    );
    server.registerTool(
      "link_contact_entity",
      {
        title: "Link contact to an additional entity",
        description:
          "Link a contact to an ADDITIONAL entity beyond their primary one (contacts.entity_id) " +
          "— use this when someone is a principal/owner/officer of more than one company (e.g. " +
          "the same person runs two separate businesses). Do not create a duplicate contact " +
          "record for the second affiliation — reuse the existing contact_id. Calling again with " +
          "the same contact_id+entity_id updates that link's role/notes instead of creating a " +
          "duplicate.",
        inputSchema: {
          contact_id: z.string().min(1),
          entity_id: z.string().min(1),
          role: z.string().optional(),
          notes: z.string().optional(),
        },
      },
      async (args) => toolResult(await agentApiPost("contact-entities", args))
    );

    // --- properties ---
    server.registerTool(
      "list_properties",
      {
        title: "List or search properties",
        description:
          "List properties/spaces, most recently created first, or search them. search " +
          "matches address, suite, city, state, zip, parcel number and submarket, ignoring " +
          "directional and street-type spelling (S/South, Ave/Avenue); multiple " +
          "words are ANDed, so '3606 61st' requires both. Returns count and has_more " +
          "alongside the rows. fields: 'summary' (default) or 'full'. Default page is 25 " +
          "rows, max 100. Search and paging added 9/24/2026 — this tool previously took a " +
          "limit and nothing else.",
        inputSchema: searchableListArgs,
      },
      async ({ search, limit, offset, fields }) =>
        toolResult(
          await agentApiGet("properties", {
            search,
            limit: limit?.toString(),
            offset: offset?.toString(),
            fields,
          })
        )
    );
    server.registerTool(
      "find_property",
      {
        title: "Find a property by address or parcel",
        description:
          "Look up whether a property is ALREADY in the CRM, by address, suite, city or " +
          "parcel number. Call this before create_property. Matching runs the same address " +
          "normalizer the duplicate check uses (migration 017), so it works in both " +
          "directions: 'South 61st Avenue' finds a row stored as '3606 S 61st Ave Cir', and " +
          "'W Center Rd' finds '14126 West Center Road'. A parcel number matches with or " +
          "without dashes. Returns count, so count: 0 means it genuinely is not on file. " +
          "create_property also refuses an address that already exists — this is for looking " +
          "before writing.",
        inputSchema: {
          query: z.string().min(1),
          limit: z.number().int().min(1).max(100).optional(),
          fields: z.string().optional(),
        },
      },
      async ({ query, limit, fields }) =>
        toolResult(
          await agentApiGet("properties", {
            search: query,
            limit: limit?.toString(),
            fields,
          })
        )
    );
    server.registerTool(
      "create_property",
      {
        title: "Create property",
        description:
          "Create a property, or a leasable space/suite inside one (set parent_property_id). " +
          "REFUSES with a 409 if the address or parcel number matches a property already on " +
          "file, and returns the matches: comparison ignores punctuation, directionals and " +
          "street-suffix words, so '3606 South 61st Avenue Circle' finds '3606 S 61st Ave " +
          "Cir'. Use the id it hands back rather than creating a second record; pass " +
          "allow_duplicate: true only when it really is a separate property. The check is " +
          "skipped when parent_property_id is set, since a suite is supposed to share its " +
          "building's address. " +
          "market_status/research_status: omit to use the DB default (off_market/unresearched). " +
          "latitude/longitude: omit to auto-geocode the address (best-effort — a miss leaves " +
          "both null, it never blocks the create); pass explicit values to skip geocoding.",
        inputSchema: {
          ...provenanceArgs,
          address: z.string().min(1),
          city: z.string().optional(),
          state: z.string().optional(),
          zip: z.string().optional(),
          property_type: z.string().optional(),
          submarket: z.string().optional(),
          building_sf: z.number().optional(),
          land_acres: z.number().optional(),
          parent_property_id: z.string().optional(),
          suite_number: z.string().optional(),
          market_status: z.enum(["on_market", "off_market"]).optional(),
          research_status: z.string().optional(),
          latitude: z.number().optional(),
          longitude: z.number().optional(),
          priority: z.string().optional(),
          notes: z.string().optional(),
          allow_duplicate: z.boolean().optional(),
        },
      },
      async (args) => toolResult(await agentApiPost("properties", args))
    );
    server.registerTool(
      "geocode_property",
      {
        title: "Geocode property",
        description:
          "Backfill or correct a property's latitude/longitude. Pass action:\"geocode\" to look " +
          "up that property's own address and (re)geocode it — the backfill path: list_properties, " +
          "find rows where latitude/longitude are null, and call this for each by id, no need to " +
          "already know the address. Or pass explicit latitude/longitude to set coordinates " +
          "directly (a manual correction).",
        inputSchema: {
          id: z.string().min(1),
          action: z.literal("geocode").optional(),
          latitude: z.number().optional(),
          longitude: z.number().optional(),
        },
      },
      async (args) => toolResult(await agentApiPatch("properties", args))
    );
    server.registerTool(
      "update_property",
      {
        title: "Update property",
        description:
          "Update one or more fields on an EXISTING property by id — address, city, state, zip, " +
          "county, parcel_number, property_type, submarket, building_sf, land_acres, year_built, " +
          "parent_property_id, suite_number, market_status, research_status, priority, notes, " +
          "latitude, longitude. Only the fields provided are changed; omitted fields are left " +
          "as-is. Pass a string field as an empty string to clear it. At least one field besides " +
          "id is required. For latitude/longitude specifically, prefer geocode_property unless " +
          "you already have the exact coordinates. Added 9/2/2026 to close the gap where a " +
          "confirmed data error (e.g. PROP-0003's building_sf) had no supported way to correct " +
          "it — see CRM_Requirements_and_Decisions_Log.md.",
        inputSchema: {
          id: z.string().min(1),
          address: z.string().optional(),
          city: z.string().optional(),
          state: z.string().optional(),
          zip: z.string().optional(),
          county: z.string().optional(),
          parcel_number: z.string().optional(),
          property_type: z.string().optional(),
          submarket: z.string().optional(),
          building_sf: z.number().optional(),
          land_acres: z.number().optional(),
          year_built: z.number().optional(),
          parent_property_id: z.string().optional(),
          suite_number: z.string().optional(),
          market_status: z.enum(["on_market", "off_market"]).optional(),
          research_status: z.string().optional(),
          priority: z.string().optional(),
          notes: z.string().optional(),
          latitude: z.number().optional(),
          longitude: z.number().optional(),
        },
      },
      async (args) => toolResult(await agentApiPatch("properties", args))
    );
    server.registerTool(
      "merge_properties",
      {
        title: "Merge a duplicate property",
        description:
          "Fold a duplicate property into the record that should survive. keep_id stays; " +
          "merge_id is REMOVED. Spaces, leases, ownership and tenancy rows, project " +
          "candidates, comps, expenses, owner signals, activity, tasks and child " +
          "properties are all repointed onto the survivor first, in one transaction. The " +
          "survivor keeps its own address and wins every populated field; the duplicate " +
          "fills blanks (this is how a row created from a lease, with a parcel number, " +
          "improves one created from a drive-by). Always prefer this to delete_property " +
          "for a duplicate: deleting a property CASCADES to its spaces, their leases and " +
          "those leases' events. Irreversible.",
        inputSchema: {
          keep_id: z.string().min(1),
          merge_id: z.string().min(1),
        },
      },
      async (args) => toolResult(await agentApiPost("properties/merge", args))
    );
    server.registerTool(
      "delete_property",
      {
        title: "Delete a property",
        description:
          "Permanently remove a property. Refuses, and reports what is attached, if " +
          "anything references it — force: true overrides that. It will NOT delete a " +
          "property whose spaces carry leases at all, force or not, because that would " +
          "destroy executed-lease history and critical dates; merge_properties moves them " +
          "instead. Use this only for a row created in error. Irreversible.",
        inputSchema: {
          id: z.string().min(1),
          force: z.boolean().optional(),
        },
      },
      async ({ id, force }) =>
        toolResult(
          await agentApiDelete("properties", {
            id,
            force: force ? "true" : undefined,
          })
        )
    );

    // --- tasks ---
    //
    // Added 9/24/2026. The tasks table and its /api/agent/tasks route have
    // existed since 8/25/2026, but were never wrapped — so the Dashboard's
    // primary column, "Your move", was fed by a table no Claude session could
    // write to. Everything Dan was told to do landed either in a spreadsheet
    // or in activity_log.next_step, neither of which that screen reads.
    server.registerTool(
      "create_task",
      {
        title: "Create task",
        description:
          "Put something on Dan's plate. Tasks are what the Dashboard's \"Your move\" column " +
          "reads, so a follow-up that is not a task is a follow-up Dan will not see. Most " +
          "follow-ups should NOT be created here directly: log_activity with a next_step and " +
          "a next_step_due_date creates the task automatically AND keeps the history of what " +
          "was agreed. Use this tool for work that is not the consequence of a logged " +
          "interaction — a license renewal, a recurring admin item, a reminder to research " +
          "something. Set waiting_on_contact_id when the ball is in someone else's court; the " +
          "Dashboard splits on exactly that. recurrence_unit/recurrence_interval make it " +
          "repeat (completing it spawns the next occurrence).",
        inputSchema: {
          ...provenanceArgs,
          description: z.string().min(1),
          due_date: z.string().optional(),
          category: z.string().optional(),
          project_id: z.string().optional(),
          property_id: z.string().optional(),
          contact_id: z.string().optional(),
          entity_id: z.string().optional(),
          requirement_id: z.string().optional(),
          waiting_on_contact_id: z.string().optional(),
          recurrence_unit: z.enum(["none", "day", "week", "month", "year"]).optional(),
          recurrence_interval: z.number().int().min(1).optional(),
        },
      },
      async (args) => toolResult(await agentApiPost("tasks", args))
    );
    server.registerTool(
      "list_tasks",
      {
        title: "List tasks",
        description:
          "List tasks, most recently created first. Filter by status (\"open\", \"done\", " +
          "\"cancelled\"), or by any of project_id / property_id / contact_id / entity_id / " +
          "requirement_id / waiting_on_contact_id. status: \"open\" is what the Dashboard " +
          "shows. Use this to answer \"what is on my plate\" and to find a task's id before " +
          "completing it.",
        inputSchema: {
          status: z.string().optional(),
          project_id: z.string().optional(),
          property_id: z.string().optional(),
          contact_id: z.string().optional(),
          entity_id: z.string().optional(),
          requirement_id: z.string().optional(),
          waiting_on_contact_id: z.string().optional(),
          limit: z.number().int().min(1).max(200).optional(),
        },
      },
      async ({ limit, ...filters }) =>
        toolResult(
          await agentApiGet("tasks", {
            ...Object.fromEntries(
              Object.entries(filters).map(([k, v]) => [k, v as string | undefined])
            ),
            limit: limit?.toString(),
          })
        )
    );
    server.registerTool(
      "complete_task",
      {
        title: "Complete or cancel a task",
        description:
          "Close a task. action: \"complete\" for work that got done — a recurring task " +
          "spawns its next occurrence automatically. action: \"cancel\" for work that is no " +
          "longer wanted; it keeps the row and its history rather than deleting it, so the " +
          "record of what was once planned survives. Get the id from list_tasks.",
        inputSchema: {
          id: z.string().min(1),
          action: z.enum(["complete", "cancel"]),
        },
      },
      async (args) => toolResult(await agentApiPatch("tasks", args))
    );

    // --- projects ---
    server.registerTool(
      "list_projects",
      {
        title: "List projects",
        description: "List projects (deals/engagements), most recently created first.",
        inputSchema: limitArg,
      },
      async ({ limit }) => toolResult(await agentApiGet("projects", { limit: limit?.toString() }))
    );
    server.registerTool(
      "create_project",
      {
        title: "Create project",
        description:
          "Create a project (a formal engagement). project_type is Dan's engagement taxonomy " +
          "(TR/BR/CL/CS/L/LRT/LRLL/SL) as free text. deal_price/commission_rate/probability_pct/ " +
          "strategic_weight_note are the Value/Probability/Expected-Value scoring fields (added " +
          "9/2/2026) — all optional at creation since deal terms are typically filled in later, " +
          "as Dan pulls deal documents into the project. deal_value and expected_value are " +
          "computed automatically and can never be set directly.",
        inputSchema: {
          project_code: z.string().min(1),
          project_type: z.string().min(1),
          client_name: z.string().min(1),
          status: z.string().optional(),
          start_date: z.string().optional(),
          target_close_date: z.string().optional(),
          notes: z.string().optional(),
          deal_price: z.number().optional(),
          commission_rate: z.number().optional(),
          probability_pct: z.number().optional(),
          strategic_weight_note: z.string().optional(),
        },
      },
      async (args) => toolResult(await agentApiPost("projects", args))
    );
    server.registerTool(
      "update_project",
      {
        title: "Update project",
        description:
          "Update one or more fields on an EXISTING project by id — project_code, project_type, " +
          "client_name, status, start_date, target_close_date, notes, deal_price, commission_rate, " +
          "probability_pct (0-100), strategic_weight_note. Only the fields provided are changed; " +
          "omitted fields are left as-is. Pass a field as an empty string (or, for a numeric field, " +
          "an empty value) to clear it. At least one field besides id is required. deal_value and " +
          "expected_value are computed automatically and can never be set directly. Added " +
          "9/2/2026 to close the gap where a spelling correction like Astlali Concina->Cocina " +
          "previously needed a raw SQL UPDATE; extended the same day for the Value/Probability/ " +
          "Expected-Value scoring fields — see CRM_Requirements_and_Decisions_Log.md.",
        inputSchema: {
          id: z.string().min(1),
          project_code: z.string().optional(),
          project_type: z.string().optional(),
          client_name: z.string().optional(),
          status: z.string().optional(),
          start_date: z.string().optional(),
          target_close_date: z.string().optional(),
          notes: z.string().optional(),
          deal_price: z.number().optional(),
          commission_rate: z.number().optional(),
          probability_pct: z.number().optional(),
          strategic_weight_note: z.string().optional(),
        },
      },
      async (args) => toolResult(await agentApiPatch("projects", args))
    );
    server.registerTool(
      "get_sop_checklist",
      {
        title: "Get companion-SOP checklist for a project type",
        description:
          "Look up which companion SOPs to load into a new engagement's Claude Project " +
          "Knowledge base, and how (Load as-is / Adapt with judgment / Gap — no SOP exists yet), " +
          "per Section 4 of New_Project_Setup_and_Categorization_-_SOP.md. Added 9/1/2026 so this " +
          "doesn't need re-deriving from the SOP doc by hand every time a new engagement is set " +
          "up. project_type accepts a single code (\"TR\") or a compound/undecided value as " +
          "stored on a live project (\"TR/BR\") — unions the checklist across every code found. " +
          "Reads the sop_matrix table (migration 013, 9/14/2026), the machine-readable projection " +
          "of Section 4 — this is no longer a hardcoded copy in code. The result includes a " +
          "computed staleness verdict (CURRENT or STALE) comparing the SOP doc's own \"Last " +
          "updated\" date against the date this matrix was last reconciled against it, so no hand " +
          "cross-check is needed; if it reads STALE, re-read Section 4 and reconcile via " +
          "update_sop_matrix before relying on the result. A status of Gap means that SOP does " +
          "not exist yet — including ones tracked only on the SOP doc's Section 6 roadmap.",
        inputSchema: {
          project_type: z.string().min(1),
        },
      },
      async ({ project_type }) => ({
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(await getSopChecklist(project_type), null, 2),
          },
        ],
      })
    );
    server.registerTool(
      "get_sop_matrix",
      {
        title: "Get the full companion-SOP matrix",
        description:
          "Return the entire companion-SOP routing matrix — every SOP row across all eight " +
          "engagement-type codes — plus its staleness verdict and the exact sop_name values " +
          "needed to edit a cell with update_sop_matrix. Use get_sop_checklist instead when you " +
          "only need one engagement's checklist; use this when reconciling the matrix against " +
          "Section 4 of New_Project_Setup_and_Categorization_-_SOP.md, or to see which SOPs are " +
          "still unwritten across the board. Optional project_type narrows it to one code.",
        inputSchema: {
          project_type: z.string().optional(),
        },
      },
      async ({ project_type }) => toolResult(await agentApiGet("sop-matrix", { project_type }))
    );
    server.registerTool(
      "update_sop_matrix",
      {
        title: "Update a companion-SOP matrix cell or its sync metadata",
        description:
          "Reconcile the sop_matrix table with Section 4 of " +
          "New_Project_Setup_and_Categorization_-_SOP.md after an SOP is written or revised. " +
          "This is the reason the matrix lives in the database rather than in code: a re-sync is " +
          "a row edit, not a code change and a deploy. Two modes. (1) Update one cell: send " +
          "sop_name AND project_type plus any of status / note / sop_filename / sort_order — " +
          "only the fields present are written, and note: \"\" clears a note. Add mark_synced: " +
          "true to also stamp source_last_synced with today's date, which is normally what you " +
          "want after reconciling a change. (2) Update the metadata row: omit sop_name and send " +
          "source_doc_last_updated (whenever the SOP doc's own \"Last updated\" line moves — " +
          "that is what makes the staleness verdict meaningful) and/or source_last_synced. Call " +
          "get_sop_matrix first to get exact sop_name values. Adding a brand-new SOP row is a " +
          "POST to /api/agent/sop-matrix, not this tool.",
        inputSchema: {
          sop_name: z.string().optional(),
          project_type: z.string().optional(),
          status: z.enum(["Load", "Adapt", "Gap", "N/A"]).optional(),
          note: z.string().optional(),
          sop_filename: z.string().optional(),
          sort_order: z.number().optional(),
          mark_synced: z.boolean().optional(),
          source_doc_last_updated: z.string().optional(),
          source_last_synced: z.string().optional(),
        },
      },
      async (args) => toolResult(await agentApiPatch("sop-matrix", args))
    );

    // --- property_owner links ---
    server.registerTool(
      "list_property_owners",
      {
        title: "List property owner links",
        description: "List property-owner ownership links, most recently created first.",
        inputSchema: limitArg,
      },
      async ({ limit }) =>
        toolResult(await agentApiGet("property-owners", { limit: limit?.toString() }))
    );
    server.registerTool(
      "link_property_owner",
      {
        title: "Link property owner",
        description: "Link an entity as the (current or past) owner of a property.",
        inputSchema: {
          property_id: z.string().min(1),
          entity_id: z.string().min(1),
          ownership_start_date: z.string().optional(),
          ownership_end_date: z.string().optional(),
          is_current: z.boolean().optional(),
          is_headquarters: z.boolean().optional(),
        },
      },
      async (args) => toolResult(await agentApiPost("property-owners", args))
    );

    // --- property_tenant links ---
    server.registerTool(
      "list_property_tenants",
      {
        title: "List property tenant links",
        description: "List property-tenant tenancy links, most recently created first.",
        inputSchema: limitArg,
      },
      async ({ limit }) =>
        toolResult(await agentApiGet("property-tenants", { limit: limit?.toString() }))
    );
    server.registerTool(
      "link_property_tenant",
      {
        title: "Link property tenant",
        description:
          "Link an entity and/or contact as a (current or past) tenant of a property. At least " +
          "one of entity_id/contact_id is required.",
        inputSchema: {
          property_id: z.string().min(1),
          entity_id: z.string().optional(),
          contact_id: z.string().optional(),
          lease_start_date: z.string().optional(),
          lease_end_date: z.string().optional(),
          is_current: z.boolean().optional(),
          is_headquarters: z.boolean().optional(),
          notes: z.string().optional(),
        },
      },
      async (args) => toolResult(await agentApiPost("property-tenants", args))
    );

    // --- project_properties links ---
    server.registerTool(
      "list_project_properties",
      {
        title: "List project property links",
        description:
          "List project-property candidate links, most recently created first. Optionally " +
          "filter to one project.",
        inputSchema: { ...limitArg, project_id: z.string().optional() },
      },
      async ({ limit, project_id }) =>
        toolResult(
          await agentApiGet("project-properties", { limit: limit?.toString(), project_id })
        )
    );
    server.registerTool(
      "link_project_property",
      {
        title: "Link project property",
        description:
          "Link a property to a project as a candidate/toured/selected/rejected space. Calling " +
          "again with the same project_id+property_id updates that link's status/notes instead " +
          "of creating a duplicate.",
        inputSchema: {
          project_id: z.string().min(1),
          property_id: z.string().min(1),
          status: z.enum(["candidate", "toured", "selected", "rejected"]).optional(),
          notes: z.string().optional(),
        },
      },
      async (args) => toolResult(await agentApiPost("project-properties", args))
    );

    // --- activity_log ---
    server.registerTool(
      "list_activity_log",
      {
        title: "List activity log",
        description:
          "List activity log entries, most recent activity_date first. Optionally filter by " +
          "project/property/entity/contact.",
        inputSchema: {
          ...limitArg,
          project_id: z.string().optional(),
          property_id: z.string().optional(),
          entity_id: z.string().optional(),
          contact_id: z.string().optional(),
        },
      },
      async ({ limit, project_id, property_id, entity_id, contact_id }) =>
        toolResult(
          await agentApiGet("activity-log", {
            limit: limit?.toString(),
            project_id,
            property_id,
            entity_id,
            contact_id,
          })
        )
    );
    server.registerTool(
      "log_activity",
      {
        title: "Log activity",
        description:
          "Log an activity (call/email/meeting/research/inquiry/etc. — free text, no fixed " +
          "list). All four link fields are optional and independent. IMPORTANT: giving both " +
          "next_step AND next_step_due_date also creates a task, which is what puts the " +
          "follow-up on the Dashboard's \"Your move\" column — a next step without a due date " +
          "stays a note and will NOT appear there. That is the intended distinction: a dated " +
          "commitment is queue work, an undated one is a remark. Pass " +
          "create_task_from_next_step: false to log the next step without queueing it.",
        inputSchema: {
          ...provenanceArgs,
          activity_type: z.string().min(1),
          project_id: z.string().optional(),
          property_id: z.string().optional(),
          contact_id: z.string().optional(),
          entity_id: z.string().optional(),
          activity_date: z.string().optional(),
          performed_by: z.string().optional(),
          summary: z.string().optional(),
          next_step: z.string().optional(),
          next_step_due_date: z.string().optional(),
          create_task_from_next_step: z.boolean().optional(),
          client_visible: z.boolean().optional(),
          source: z.string().optional(),
        },
      },
      async (args) => toolResult(await agentApiPost("activity-log", args))
    );

    // --- project_contacts links ---
    server.registerTool(
      "list_project_contacts",
      {
        title: "List project contact links",
        description:
          "List contacts linked to projects, most recently created first. Optionally filter to " +
          "one project.",
        inputSchema: { ...limitArg, project_id: z.string().optional() },
      },
      async ({ limit, project_id }) =>
        toolResult(
          await agentApiGet("project-contacts", { limit: limit?.toString(), project_id })
        )
    );
    server.registerTool(
      "link_project_contact",
      {
        title: "Link project contact",
        description:
          "Link a contact and/or entity to a project (e.g. a co-broker, referral source, outside " +
          "brokerage, or other party on the deal). At least one of contact_id/entity_id is " +
          "required. For a commission-split collaborator, set split_pct — meaning depends on " +
          "role: a referral fee is typically 10-20% off the top of the gross commission before " +
          "any split, while a co-broker split (50/50 or 60/40 typical) divides what's left after " +
          "any referral. Calling again with the same project_id+contact_id (or " +
          "project_id+entity_id) updates that link's role/split_pct/notes instead of creating a " +
          "duplicate.",
        inputSchema: {
          project_id: z.string().min(1),
          contact_id: z.string().optional(),
          entity_id: z.string().optional(),
          role: z.string().optional(),
          split_pct: z.number().optional(),
          notes: z.string().optional(),
        },
      },
      async (args) => toolResult(await agentApiPost("project-contacts", args))
    );

    // --- reference_links ---
    server.registerTool(
      "list_reference_links",
      {
        title: "List reference links",
        description:
          "List reference links (standing deal-terms answers, shareable marketing-package/due-" +
          "diligence links), most recently created first. Optionally filter by property or project.",
        inputSchema: {
          ...limitArg,
          property_id: z.string().optional(),
          project_id: z.string().optional(),
        },
      },
      async ({ limit, property_id, project_id }) =>
        toolResult(
          await agentApiGet("reference-links", {
            limit: limit?.toString(),
            property_id,
            project_id,
          })
        )
    );
    server.registerTool(
      "create_reference_link",
      {
        title: "Create reference link",
        description:
          "Log a structured reference link or standing answer (e.g. a Dropbox marketing-package " +
          "link, or a standing NNN/CAM/tax figure) instead of an activity_log note. At least one " +
          "of property_id/project_id is required; url is optional (a text-only standing answer " +
          "can be logged via notes alone).",
        inputSchema: {
          label: z.string().min(1),
          property_id: z.string().optional(),
          project_id: z.string().optional(),
          entity_id: z.string().optional(),
          url: z.string().optional(),
          link_type: z.string().optional(),
          notes: z.string().optional(),
        },
      },
      async (args) => toolResult(await agentApiPost("reference-links", args))
    );

    // --- saved_polygons (territories) ---
    server.registerTool(
      "list_territories",
      {
        title: "List territories",
        description:
          "List saved polygons (\"research zones\" / \"campaign territories\" drawn on the map's " +
          "polygon tool), most recently created first. Optionally filter to one project.",
        inputSchema: { ...limitArg, project_id: z.string().optional() },
      },
      async ({ limit, project_id }) =>
        toolResult(await agentApiGet("territories", { limit: limit?.toString(), project_id }))
    );
    server.registerTool(
      "save_territory",
      {
        title: "Save territory",
        description:
          "Save a polygon as a reusable research zone / campaign territory. geojson must be a " +
          "Polygon geometry, e.g. {\"type\":\"Polygon\",\"coordinates\":[[[lng,lat],...]]}, first " +
          "and last point equal to close the ring. Which properties fall inside it is always " +
          "computed live when the zone is reloaded, never stored here.",
        inputSchema: {
          name: z.string().min(1),
          geojson: z.object({
            type: z.literal("Polygon"),
            coordinates: z.array(z.array(z.tuple([z.number(), z.number()]))),
          }),
          project_id: z.string().optional(),
          notes: z.string().optional(),
        },
      },
      async (args) => toolResult(await agentApiPost("territories", args))
    );

    // --- requirements ---
    server.registerTool(
      "list_requirements",
      {
        title: "List requirements",
        description:
          "List requirements — a standing, informal capture of what someone told Dan they need " +
          "(\"let me know if you find this for me\"), distinct from a formal project/assignment. " +
          "Most recently created first. Optionally filter by status (active/on_hold/fulfilled/dead).",
        inputSchema: { ...limitArg, status: z.string().optional() },
      },
      async ({ limit, status }) =>
        toolResult(await agentApiGet("requirements", { limit: limit?.toString(), status }))
    );
    server.registerTool(
      "create_requirement",
      {
        title: "Create requirement",
        description:
          "Create a requirement. deal_type/property_type/priority/source are free text, no fixed " +
          "list — use whatever term fits (e.g. deal_type: \"Lease\", \"Buy\", \"Sell\", " +
          "\"Build-to-suit\"). size_min/size_max are square feet, budget_min/budget_max are " +
          "dollars — any of the four can be omitted. status defaults to \"active\" if not set. " +
          "This only creates the requirement itself — call link_requirement_party separately to " +
          "attach the contact(s)/entity(ies) it belongs to.",
        inputSchema: {
          deal_type: z.string().optional(),
          property_type: z.string().optional(),
          size_min: z.number().optional(),
          size_max: z.number().optional(),
          budget_min: z.number().optional(),
          budget_max: z.number().optional(),
          target_location: z.string().optional(),
          timeline: z.string().optional(),
          status: z.enum(["active", "on_hold", "fulfilled", "dead"]).optional(),
          priority: z.string().optional(),
          details: z.string().optional(),
          source: z.string().optional(),
        },
      },
      async (args) => toolResult(await agentApiPost("requirements", args))
    );

    // --- requirement_parties links ---
    server.registerTool(
      "list_requirement_parties",
      {
        title: "List requirement party links",
        description:
          "List the contacts/entities linked to requirements, most recently created first. " +
          "Optionally filter to one requirement.",
        inputSchema: { ...limitArg, requirement_id: z.string().optional() },
      },
      async ({ limit, requirement_id }) =>
        toolResult(
          await agentApiGet("requirement-parties", { limit: limit?.toString(), requirement_id })
        )
    );
    server.registerTool(
      "link_requirement_party",
      {
        title: "Link requirement party",
        description:
          "Link a contact and/or entity to a requirement — a single requirement can attach to " +
          "any combination of both at once (e.g. a decision-maker personally AND the company " +
          "itself; call this once per party to link). At least one of contact_id/entity_id is " +
          "required. Unlike the other link tools, this does not upsert — calling it again with " +
          "the same requirement_id+contact_id (or +entity_id) creates a second link row rather " +
          "than updating one, since there's nothing on the link itself to update.",
        inputSchema: {
          requirement_id: z.string().min(1),
          contact_id: z.string().optional(),
          entity_id: z.string().optional(),
        },
      },
      async (args) => toolResult(await agentApiPost("requirement-parties", args))
    );
    server.registerTool(
      "update_requirement",
      {
        title: "Update requirement",
        description:
          "Update one or more fields on an EXISTING requirement by id — deal_type, " +
          "property_type, target_location, timeline, status (active/on_hold/fulfilled/dead), " +
          "priority, details, source (strings), and size_min, size_max, budget_min, budget_max " +
          "(numbers). Only the fields provided are changed; omitted fields are left as-is. Pass " +
          "a string field as an empty string to clear it. At least one field besides id is " +
          "required. Added 9/13/2026 to close the gap where an existing requirement (e.g. " +
          "REQ-0001, REQ-0002) had no supported way to be edited after creation — see " +
          "CRM_Requirements_and_Decisions_Log.md.",
        inputSchema: {
          id: z.string().min(1),
          deal_type: z.string().optional(),
          property_type: z.string().optional(),
          size_min: z.number().optional(),
          size_max: z.number().optional(),
          budget_min: z.number().optional(),
          budget_max: z.number().optional(),
          target_location: z.string().optional(),
          timeline: z.string().optional(),
          status: z.enum(["active", "on_hold", "fulfilled", "dead"]).optional(),
          priority: z.string().optional(),
          details: z.string().optional(),
          source: z.string().optional(),
        },
      },
      async (args) => toolResult(await agentApiPatch("requirements", args))
    );

    // --- spaces ---
    server.registerTool(
      "list_spaces",
      {
        title: "List spaces",
        description:
          "List spaces — a leasable unit within a property (or the whole property, for a " +
          "single-tenant building). Part of the Space/Lease data model (migration 011, Phase 1, " +
          "9/8/2026) — NOT the legacy parent_property_id child-property pattern used by " +
          "PROP-0002/0003 and PROP-0006/0007, which stays untouched. Most recently created first. " +
          "Optionally filter by property_id or space_status (occupied/vacant/owner_occupied).",
        inputSchema: {
          ...limitArg,
          property_id: z.string().optional(),
          space_status: z.string().optional(),
        },
      },
      async ({ limit, property_id, space_status }) =>
        toolResult(
          await agentApiGet("spaces", { limit: limit?.toString(), property_id, space_status })
        )
    );
    server.registerTool(
      "create_space",
      {
        title: "Create space",
        description:
          "Create a space (a suite/unit within a property). property_id is required — the " +
          "property this space belongs to. space_status: occupied, vacant, or owner_occupied — " +
          "omit to default to vacant. Vacant suites should be tracked, not just occupied ones.",
        inputSchema: {
          ...provenanceArgs,
          property_id: z.string().min(1),
          suite_number: z.string().optional(),
          building_sf: z.number().optional(),
          space_status: z.enum(["occupied", "vacant", "owner_occupied"]).optional(),
          notes: z.string().optional(),
        },
      },
      async (args) => toolResult(await agentApiPost("spaces", args))
    );
    server.registerTool(
      "update_space",
      {
        title: "Update space",
        description:
          "Update one or more fields on an EXISTING space by id — property_id, suite_number, " +
          "building_sf, space_status, notes. Only the fields provided are changed; omitted fields " +
          "are left as-is. Pass a string field as an empty string to clear it. At least one field " +
          "besides id is required.",
        inputSchema: {
          id: z.string().min(1),
          property_id: z.string().optional(),
          suite_number: z.string().optional(),
          building_sf: z.number().optional(),
          space_status: z.enum(["occupied", "vacant", "owner_occupied"]).optional(),
          notes: z.string().optional(),
        },
      },
      async (args) => toolResult(await agentApiPatch("spaces", args))
    );

    // --- leases ---
    server.registerTool(
      "list_leases",
      {
        title: "List leases",
        description:
          "List leases — the join record carrying the tenant/landlord relationship plus every " +
          "economic term for one lease term. Part of the Space/Lease data model (migration 011, " +
          "Phase 1, 9/8/2026). A lease with master_lease_id null IS a Master Lease (landlord_" +
          "entity_id = Master Landlord); one with master_lease_id set is a Sublease (landlord_" +
          "entity_id = Sub Landlord, i.e. the master tenant one level down). Most recently created " +
          "first. Optionally filter by space_id, tenant_entity_id, landlord_entity_id, " +
          "master_lease_id, or is_current.",
        inputSchema: {
          ...limitArg,
          space_id: z.string().optional(),
          tenant_entity_id: z.string().optional(),
          landlord_entity_id: z.string().optional(),
          master_lease_id: z.string().optional(),
          is_current: z.boolean().optional(),
        },
      },
      async ({ limit, space_id, tenant_entity_id, landlord_entity_id, master_lease_id, is_current }) =>
        toolResult(
          await agentApiGet("leases", {
            limit: limit?.toString(),
            space_id,
            tenant_entity_id,
            landlord_entity_id,
            master_lease_id,
            is_current: is_current === undefined ? undefined : String(is_current),
          })
        )
    );
    server.registerTool(
      "create_lease",
      {
        title: "Create lease",
        description:
          "Create a lease. space_id is required. At least one of tenant_entity_id/" +
          "tenant_contact_id is required. To record a Sublease, set master_lease_id to the Master " +
          "Lease's id and landlord_entity_id to the Sub Landlord (the master tenant) — omit " +
          "master_lease_id for a Master Lease, whose landlord_entity_id is normally the property's " +
          "fee owner. is_current/comp_eligible default to true if not set. A renewal at new terms " +
          "should be a NEW row (not an update to the old one) — set the old row's is_current to " +
          "false via update_lease once the new one is created, so lease history is never " +
          "overwritten. base_rent_annual/base_rent_monthly/rent_psf/cam_payment_annual/cam_psf/ " +
          "ti_allowance are all optional numeric terms; cam_payment_annual is the tenant's billed " +
          "CAM/CAMIT reimbursement.",
        inputSchema: {
          ...provenanceArgs,
          space_id: z.string().min(1),
          tenant_entity_id: z.string().optional(),
          tenant_contact_id: z.string().optional(),
          landlord_entity_id: z.string().optional(),
          landlord_contact_id: z.string().optional(),
          master_lease_id: z.string().optional(),
          lease_start_date: z.string().optional(),
          lease_end_date: z.string().optional(),
          base_rent_annual: z.number().optional(),
          base_rent_monthly: z.number().optional(),
          rent_psf: z.number().optional(),
          cam_payment_annual: z.number().optional(),
          cam_psf: z.number().optional(),
          ti_allowance: z.number().optional(),
          is_current: z.boolean().optional(),
          as_of_date: z.string().optional(),
          comp_eligible: z.boolean().optional(),
          notes: z.string().optional(),
        },
      },
      async (args) => toolResult(await agentApiPost("leases", args))
    );
    server.registerTool(
      "update_lease",
      {
        title: "Update lease",
        description:
          "Update one or more fields on an EXISTING lease by id — space_id, tenant_entity_id, " +
          "tenant_contact_id, landlord_entity_id, landlord_contact_id, master_lease_id, " +
          "lease_start_date, lease_end_date, as_of_date, base_rent_annual, base_rent_monthly, " +
          "rent_psf, cam_payment_annual, cam_psf, ti_allowance, is_current, comp_eligible, notes. " +
          "Only the fields provided are changed; omitted fields are left as-is. Pass a string/FK/" +
          "date field as an empty string to clear it. At least one field besides id is required. " +
          "Common use: setting is_current to false on a superseded lease once its renewal is " +
          "entered as a new row via create_lease, or correcting a term flagged as uncertain at " +
          "load time (e.g. a rent-roll date that didn't match its own renewal note).",
        inputSchema: {
          id: z.string().min(1),
          space_id: z.string().optional(),
          tenant_entity_id: z.string().optional(),
          tenant_contact_id: z.string().optional(),
          landlord_entity_id: z.string().optional(),
          landlord_contact_id: z.string().optional(),
          master_lease_id: z.string().optional(),
          lease_start_date: z.string().optional(),
          lease_end_date: z.string().optional(),
          as_of_date: z.string().optional(),
          base_rent_annual: z.number().optional(),
          base_rent_monthly: z.number().optional(),
          rent_psf: z.number().optional(),
          cam_payment_annual: z.number().optional(),
          cam_psf: z.number().optional(),
          ti_allowance: z.number().optional(),
          is_current: z.boolean().optional(),
          comp_eligible: z.boolean().optional(),
          notes: z.string().optional(),
        },
      },
      async (args) => toolResult(await agentApiPatch("leases", args))
    );

    // --- lease_events (Phase 2, migration 012) ---
    server.registerTool(
      "list_lease_events",
      {
        title: "List lease events",
        description:
          "List lease events — dated things tied to one specific lease: option/renewal " +
          "deadlines, scheduled rent bumps, rent commencement, TI disbursement, CAM " +
          "reconciliation, etc. Part of the Space/Lease data model, Phase 2 (migration 012). " +
          "Most recently created first. Optionally filter by lease_id, event_type, or " +
          "is_completed.",
        inputSchema: {
          ...limitArg,
          lease_id: z.string().optional(),
          event_type: z.string().optional(),
          is_completed: z.boolean().optional(),
        },
      },
      async ({ limit, lease_id, event_type, is_completed }) =>
        toolResult(
          await agentApiGet("lease-events", {
            limit: limit?.toString(),
            lease_id,
            event_type,
            is_completed: is_completed === undefined ? undefined : String(is_completed),
          })
        )
    );
    server.registerTool(
      "create_lease_event",
      {
        title: "Create lease event",
        description:
          "Create a lease event. lease_id and event_type are required. event_type is free " +
          "text — suggested vocabulary: Lease Expiration, Option Notice Deadline, Option " +
          "Exercise Deadline, Renewal Rent Step, Scheduled Rent Bump, Rent Commencement, " +
          "TI Disbursement, CAM Reconciliation, Other. event_date is optional — leave it unset " +
          "when the exact date isn't known yet (e.g. a renewal still being negotiated) and put " +
          "what's known in notes instead. amount is an optional dollar figure relevant to the " +
          "event (a rent-bump increase, a TI disbursement amount, etc.). is_completed defaults " +
          "to false.",
        inputSchema: {
          ...provenanceArgs,
          lease_id: z.string().min(1),
          event_type: z.string().min(1),
          event_date: z.string().optional(),
          amount: z.number().optional(),
          is_completed: z.boolean().optional(),
          notes: z.string().optional(),
        },
      },
      async (args) => toolResult(await agentApiPost("lease-events", args))
    );
    server.registerTool(
      "update_lease_event",
      {
        title: "Update lease event",
        description:
          "Update one or more fields on an EXISTING lease event by id — lease_id, event_type, " +
          "event_date, amount, is_completed, notes. Only the fields provided are changed; " +
          "omitted fields are left as-is. Pass a string/date field as an empty string to clear " +
          "it. At least one field besides id is required. Common use: setting is_completed to " +
          "true once a TI disbursement goes out or an option notice is actually sent, or " +
          "correcting event_date/amount as a deal firms up.",
        inputSchema: {
          id: z.string().min(1),
          lease_id: z.string().optional(),
          event_type: z.string().optional(),
          event_date: z.string().optional(),
          amount: z.number().optional(),
          is_completed: z.boolean().optional(),
          notes: z.string().optional(),
        },
      },
      async (args) => toolResult(await agentApiPatch("lease-events", args))
    );

    // --- property_expenses (Phase 2, migration 012) ---
    server.registerTool(
      "list_property_expenses",
      {
        title: "List property expenses",
        description:
          "List property expenses — CAM/tax/insurance category breakout and multi-year " +
          "expense history for a property. Part of the Space/Lease data model, Phase 2 " +
          "(migration 012). Most recently created first. Optionally filter by property_id, " +
          "year, or category.",
        inputSchema: {
          ...limitArg,
          property_id: z.string().optional(),
          year: z.number().int().optional(),
          category: z.string().optional(),
        },
      },
      async ({ limit, property_id, year, category }) =>
        toolResult(
          await agentApiGet("property-expenses", {
            limit: limit?.toString(),
            property_id,
            year: year?.toString(),
            category,
          })
        )
    );
    server.registerTool(
      "create_property_expense",
      {
        title: "Create property expense",
        description:
          "Create a property expense record. property_id, year, category, and amount are all " +
          "required. category is free text (CAM, Property Tax, Insurance, etc.) — no fixed " +
          "list. More than one row can exist for the same property/year/category (e.g. a " +
          "correction or a supplemental invoice) — there's no uniqueness constraint.",
        inputSchema: {
          property_id: z.string().min(1),
          year: z.number().int(),
          category: z.string().min(1),
          amount: z.number(),
          notes: z.string().optional(),
        },
      },
      async (args) => toolResult(await agentApiPost("property-expenses", args))
    );
    server.registerTool(
      "update_property_expense",
      {
        title: "Update property expense",
        description:
          "Update one or more fields on an EXISTING property expense by id — property_id, " +
          "year, category, amount, notes. Only the fields provided are changed; omitted fields " +
          "are left as-is. Pass a string field as an empty string to clear it. At least one " +
          "field besides id is required.",
        inputSchema: {
          id: z.string().min(1),
          property_id: z.string().optional(),
          year: z.number().int().optional(),
          category: z.string().optional(),
          amount: z.number().optional(),
          notes: z.string().optional(),
        },
      },
      async (args) => toolResult(await agentApiPatch("property-expenses", args))
    );
  },
  {
    // version bumped 9/3/2026 (was a static "1.0.0" since this connector was
    // first built on 8/27/2026, never changed across 6 tool-discovery-lag
    // recurrences — see CRM_Requirements_and_Decisions_Log.md). Some MCP
    // client implementations key tool-list caching off the (name, version)
    // pair and won't re-fetch a fresh tool list if the version looks
    // unchanged. BUMP THIS any time a tool is added, removed, or has its
    // input schema changed — treat it as a real cache-busting key, not a
    // cosmetic version number.
    serverInfo: { name: "dan-fishburn-crm", version: "1.11.0" },
    verboseLogs: true,
  }
);

// Next.js route-segment config: cap this route's execution time on Vercel.
// (mcp-handler v2's createMcpHandler no longer takes basePath/maxDuration —
// those are handled by Next.js itself and by where this file lives.)
export const maxDuration = 60;

// Force this route to be fully dynamic (no caching at the Next.js/Vercel
// layer) — added 9/3/2026 as a defensive measure alongside the version
// bump above, in case any HTTP-level caching was contributing to the
// tool-discovery-lag bug tracked in CRM_Requirements_and_Decisions_Log.md.
// Cheap and safe either way: this route's responses (tool lists, tool call
// results) should never be cached.
export const dynamic = "force-dynamic";

// Static-secret verification for Claude's "Static API Key" custom-connector
// auth mode: Dan enters MCP_API_TOKEN's value once when adding the
// connector in Claude's settings, and Claude attaches it as a bearer token
// on every request from then on, in any future session. Deliberately a
// separate secret from AGENT_API_TOKEN (see lib/agentApiClient.ts) so this
// connector can be rotated or revoked on its own.
const verifyToken = async (
  _req: Request,
  bearerToken?: string
): Promise<AuthInfo | undefined> => {
  const expected = process.env.MCP_API_TOKEN;
  if (!expected || !bearerToken || bearerToken !== expected) return undefined;
  return {
    token: bearerToken,
    clientId: "dan-fishburn-crm-mcp",
    scopes: ["crm:read", "crm:write"],
  };
};

const authHandler = withMcpAuth(handler, verifyToken, { required: true });

export { authHandler as GET, authHandler as POST };
