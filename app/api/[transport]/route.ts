import { createMcpHandler, withMcpAuth } from "mcp-handler";
import type { AuthInfo } from "@modelcontextprotocol/server";
import { z } from "zod";
import { agentApiGet, agentApiPost, type AgentApiResult } from "@/lib/agentApiClient";

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
          "market_status/research_status: omit to use the DB default (off_market/unresearched).",
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
          notes: z.string().optional(),
        },
      },
      async (args) => toolResult(await agentApiPost("properties", args))
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
