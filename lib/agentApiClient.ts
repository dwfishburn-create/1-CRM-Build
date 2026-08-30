// Thin internal client the MCP route (app/api/[transport]/route.ts) uses to
// call this same app's existing /api/agent/* Route Handlers, instead of
// re-implementing their insert/validation logic a second time. Every MCP
// tool is a pass-through to one of these already-working, already-verified
// endpoints, so there is exactly one place each table's field validation
// lives — see the 8/26/2026 and 8/27/2026 silent-field-drop bugs in
// CRM_Requirements_and_Decisions_Log.md for what happens when logic gets
// duplicated and drifts.
//
// Auth here is AGENT_API_TOKEN — the same shared secret proxy.ts already
// checks for direct Agent API callers. It's read straight from the server
// environment and never forwarded to, or accepted from, the MCP caller.
// The MCP route's own callers (Claude connectors) authenticate separately,
// with their own MCP_API_TOKEN, checked in app/api/[transport]/route.ts.

// Always call the stable production domain, never the per-deployment
// VERCEL_URL host. VERCEL_URL points at that specific deployment's own
// unique hostname, which sits behind Vercel's deployment-protection wall
// (an HTML interstitial, not JSON) unless that protection is disabled for
// this project — so a server-to-server call to it can silently come back
// as a 200 OK HTML page instead of the expected JSON. Found 8/27/2026 when
// the MCP route's first live tool call failed with "non-JSON response".
const BASE_URL = "https://1-crm-build.vercel.app";

function baseUrl(): string {
  return BASE_URL;
}

export type AgentApiResult = {
  ok: boolean;
  status: number;
  body: Record<string, unknown>;
};

async function agentApiRequest(
  method: "GET" | "POST" | "PATCH",
  path: string,
  init?: { query?: Record<string, string | undefined>; json?: Record<string, unknown> }
): Promise<AgentApiResult> {
  const token = process.env.AGENT_API_TOKEN;
  if (!token) {
    return {
      ok: false,
      status: 500,
      body: { error: "Server misconfigured: AGENT_API_TOKEN is not set." },
    };
  }

  const url = new URL(`${baseUrl()}/api/agent/${path}`);
  if (init?.query) {
    for (const [key, value] of Object.entries(init.query)) {
      if (value !== undefined && value !== "") url.searchParams.set(key, value);
    }
  }

  const res = await fetch(url.toString(), {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.json ? { "Content-Type": "application/json" } : {}),
    },
    body: init?.json ? JSON.stringify(init.json) : undefined,
    // This is a server-to-server call the MCP route makes to its own
    // deployment; never cache it.
    cache: "no-store",
  });

  let body: Record<string, unknown> = {};
  try {
    body = await res.json();
  } catch {
    body = { error: `Agent API returned a non-JSON response (status ${res.status}).` };
  }

  return { ok: res.ok, status: res.status, body };
}

export function agentApiGet(path: string, query?: Record<string, string | undefined>) {
  return agentApiRequest("GET", path, { query });
}

export function agentApiPost(path: string, json: Record<string, unknown>) {
  return agentApiRequest("POST", path, { json });
}

export function agentApiPatch(path: string, json: Record<string, unknown>) {
  return agentApiRequest("PATCH", path, { json });
}
