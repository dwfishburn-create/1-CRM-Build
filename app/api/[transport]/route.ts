import { createMcpHandler, withMcpAuth } from "mcp-handler";
import type { AuthInfo } from "@modelcontextprotocol/server";
import { z } from "zod";
import { agentApiGet, agentApiPost, agentApiPatch, type AgentApiResult } from "@/lib/agentApiClient";
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
// step from. requirements/tasks/sale-comps/lease-comps/requirement-parties
// are not yet wrapped; add them here the same way, if/when a session needs
// to write to them without a pasted token.
//
// contact_entities added 8/31/2026 (migration 009) — a contact<->entity
// many-to-many link, for when one person is a principal of more than one
// company. See the "Contact<->Entity relationship is 1:1" decision in
// CRM_Requirements_and_Decisions_Log.md.

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

const handler = createMcpHandler(
  (server) => {
    // --- entities ---
    server.registerTool(
      "list_entities",
      {
        title: "List entities",
        description: "List entities (owners, tenants, companies), most recently created first.",
        inputSchema: limitArg,
      },
      async ({ limit }) => toolResult(await agentApiGet("entities", { limit: limit?.toString() }))
    );
    server.registerTool(
      "create_entity",
      {
        title: "Create entity",
        description: "Create an entity — an owner LLC, a tenant company, a corporation, etc.",
        inputSchema: {
          name: z.string().min(1),
          entity_type: z.string().optional(),
          industry: z.string().optional(),
          website: z.string().optional(),
          primary_contact_id: z.string().optional(),
          notes: z.string().optional(),
        },
      },
      async (args) => toolResult(await agentApiPost("entities", args))
    );

    // --- contacts ---
    server.registerTool(
      "list_contacts",
      {
        title: "List contacts",
        description: "List contacts (people), most recently created first.",
        inputSchema: limitArg,
      },
      async ({ limit }) => toolResult(await agentApiGet("contacts", { limit: limit?.toString() }))
    );
    server.registerTool(
      "create_contact",
      {
        title: "Create contact",
        description:
          "Create a contact (a person). Provide entity_id to link to an existing entity by id " +
          "(preferred), or company_name to look up/create an entity by name. At least one of " +
          "first_name/last_name is required.",
        inputSchema: {
          first_name: z.string().optional(),
          last_name: z.string().optional(),
          email: z.string().optional(),
          phone: z.string().optional(),
          mobile_phone: z.string().optional(),
          title: z.string().optional(),
          entity_id: z.string().optional(),
          company_name: z.string().optional(),
          notes: z.string().optional(),
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
          "email, phone, mobile_phone, title, entity_id, notes. Only the fields provided are " +
          "changed; omitted fields are left as-is. Pass a field as an empty string to clear it " +
          "(e.g. entity_id: \"\" to unlink from its entity). At least one field besides id is " +
          "required. Added 9/1/2026 to close the gap where an existing contact's email/phone/etc. " +
          "could only be set at creation time, not corrected or filled in afterward — see " +
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
        },
      },
      async (args) => toolResult(await agentApiPatch("contacts", args))
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
        title: "List properties",
        description: "List properties/spaces, most recently created first.",
        inputSchema: limitArg,
      },
      async ({ limit }) =>
        toolResult(await agentApiGet("properties", { limit: limit?.toString() }))
    );
    server.registerTool(
      "create_property",
      {
        title: "Create property",
        description:
          "Create a property, or a leasable space/suite inside one (set parent_property_id). " +
          "market_status/research_status: omit to use the DB default (off_market/unresearched). " +
          "latitude/longitude: omit to auto-geocode the address (best-effort — a miss leaves " +
          "both null, it never blocks the create); pass explicit values to skip geocoding.",
        inputSchema: {
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
          "(TR/BR/CL/CS/L/LRT/LRLL/SL) as free text.",
        inputSchema: {
          project_code: z.string().min(1),
          project_type: z.string().min(1),
          client_name: z.string().min(1),
          status: z.string().optional(),
          start_date: z.string().optional(),
          target_close_date: z.string().optional(),
          notes: z.string().optional(),
        },
      },
      async (args) => toolResult(await agentApiPost("projects", args))
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
          "This is a STATIC snapshot of the matrix, not a live fetch of the SOP doc — the result " +
          "includes source_last_synced so staleness is visible; if in doubt, cross-check the SOP " +
          "doc's own \"Last updated\" line.",
        inputSchema: {
          project_type: z.string().min(1),
        },
      },
      async ({ project_type }) => ({
        content: [
          { type: "text" as const, text: JSON.stringify(getSopChecklist(project_type), null, 2) },
        ],
      })
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
          "list). All four link fields are optional and independent.",
        inputSchema: {
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
  },
  {
    serverInfo: { name: "dan-fishburn-crm", version: "1.0.0" },
    verboseLogs: true,
  }
);

// Next.js route-segment config: cap this route's execution time on Vercel.
// (mcp-handler v2's createMcpHandler no longer takes basePath/maxDuration —
// those are handled by Next.js itself and by where this file lives.)
export const maxDuration = 60;

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
