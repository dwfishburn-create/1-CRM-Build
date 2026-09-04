# Bug Report: Custom MCP Connector — New/Updated Tools Not Appearing in Tool Discovery

## Summary

A custom MCP connector (a Next.js app on Vercel, using the standard MCP SDK's `registerTool` over a single `/api/[transport]` Streamable HTTP route) has repeatedly failed to surface newly added or newly modified tools to Claude sessions, despite the underlying deployment being independently confirmed live. This has recurred **7 times** across 9 days (8/30/2026–9/3/2026). No workaround reliably fixes it; some misses self-resolve after an unpredictable delay (a session or more) with no action taken.

## Environment

- **Connector type:** Custom MCP server, deployed as a Next.js 16 App Router Route Handler at `app/api/[transport]/route.ts`, hosted on Vercel
- **Transport:** Streamable HTTP (standard MCP SDK `registerTool` calls inside the route handler)
- **Client:** Claude (claude.ai / Claude Code sessions), connector added as a custom connector
- **Observation window:** 8/30/2026 – 9/3/2026, across multiple independent sessions

## Symptom

After deploying a code change that adds a new tool (`server.registerTool("new_tool_name", ...)`) or changes an existing tool's schema/description, a fresh Claude session's tool list — checked via both explicit UI reconnect and a programmatic tool-list refresh call — does not reflect the change. The tool is either entirely absent, or (in later recurrences) present but showing its **stale/prior schema**.

This happens even though the deployment itself is independently verified live and correct — confirmed via direct `curl` against the underlying REST endpoints the tools wrap (e.g., a `PATCH` request against a newly-added route correctly returns `401 Unauthorized` — meaning the route exists and the auth middleware is running — rather than `404`/`405`, which would indicate the route wasn't deployed).

## Timeline of recurrences

| # | Date | What went missing | Notes |
|---|------|---|---|
| 1 | 8/30 | `geocode_property` | First occurrence. Tool count frozen at prior value. |
| 2 | 8/31 | `list_contact_entities`, `link_contact_entity` | Full disconnect/reconnect via Settings → Connectors UI attempted — did not fix. |
| 3 | 9/1 | `get_sop_checklist` | |
| 4 | 9/1 | `update_contact` | Same session as #3, same day. Programmatic refresh call attempted — did not fix. |
| 5 | 9/2 | `update_property`, `update_entity`, `update_project` | Deployment independently confirmed live via `curl PATCH` returning `401` (not `404`/`405`). Tools absent immediately after deploy in the same session that had seen #3/#4 resolve cleanly earlier that same day. |
| 6 | 9/2 | (persistence + new symptom) | `update_property`/`update_entity`/`update_project` from #5 were **still absent in a fresh session, days-equivalent later**, after an explicit refresh — ruling out simple slow propagation within one session. **New symptom:** `create_project`, an *already-registered* tool that needed no new discovery, kept serving its **pre-change schema** — four newly-added optional fields never appeared in its tool definition, even after refresh. This showed the bug isn't limited to brand-new tool names; an existing tool's schema can go stale too. |
| 6b | 9/2 (later same day) | `update_property`/`update_entity`/`update_project` | **Self-resolved with no action taken** — appeared in a fresh `ToolSearch` with no reconnect or refresh call. |
| 7 | 9/3 | `list_requirements`, `create_requirement`, `list_requirement_parties`, `link_requirement_party` | Deployment confirmed via Vercel dashboard showing "Ready." A specific code-level hypothesis was tested this time (see below) — did not produce an immediate fix. |

## What we tried

1. **Full connector disconnect + reconnect** through Claude's Settings → Connectors UI (tried 8/30, 8/31). **Not sufficient.**
2. **Explicit programmatic tool-list refresh** (a `RefreshMcpTools`-equivalent call against the connector, as opposed to a UI toggle) — tried 9/1 for `update_contact`, tried again 9/2 for the three PATCH tools. **Not sufficient** — both times the tool count was reported unchanged with the new tools still absent immediately after the call.
3. **`serverInfo.version` bump** (9/3): The connector's `server.registerTool`/server-init call had declared a hardcoded `version: "1.0.0"` in its `serverInfo` since the connector was first built, unchanged across all 6 prior misses. Hypothesis: some MCP clients cache a server's tool list keyed to the `(name, version)` pair from `serverInfo`, and would treat an unchanged version as "nothing to refetch" regardless of an explicit refresh request. Bumped to `"1.1.0"` and added `export const dynamic = "force-dynamic"` to the route handler as a defensive measure against HTTP-level caching. Deployed and confirmed live. **Result: did not produce an immediate fix** — the four new Requirements tools were still absent right after this deploy too. (Not a clean disproof of the theory either, since several prior misses took a session or more to self-clear rather than resolving immediately — but as tested, it did not resolve the issue.)

## Key observations that rule out simpler explanations

- **Not a deployment problem.** Every miss was independently confirmed live at the HTTP layer (correct auth-gated response codes, Vercel "Ready" status) at the time the tool was reported missing.
- **Not simple session-level caching.** The same session that saw `get_sop_checklist`/`update_contact` (#3/#4) resolve cleanly with no workaround needed then missed three *other* tools (#5) deployed later the same day. If the client cached "the whole tool list" per session, either all same-day deploys would show or none would — this rules that out.
- **Not limited to brand-new tool names.** `create_project`'s stale schema (part of #6) shows an *existing, already-discovered* tool can also fail to pick up a schema change.
- **Not permanently stuck.** Recurrence #5/#6 self-resolved (#6b) after some elapsed time with zero corrective action — suggesting a cache or propagation delay somewhere in the discovery pipeline, rather than a hard failure, but with no reliable trigger for when it clears.
- **The reverse never happens.** We have not observed a tool disappearing that was previously visible — only new/changed tools failing to appear.

## Impact

Each occurrence blocks Claude sessions from using newly shipped functionality through the connector (forcing fallback to either the web UI directly or a manual `curl` with a bearer token) for an unpredictable period — anywhere from within the same session to multiple days. This has happened on **7 separate feature deployments** in **9 days**, making it the single most disruptive recurring issue in this project's build process.

## Ask

1. Is tool-list caching for custom MCP connectors keyed to anything in `serverInfo` (name/version) or elsewhere, and if so, what's the expected cache invalidation trigger on the client/platform side?
2. Is there a supported way to force an immediate, guaranteed tool-list refetch from a custom connector (beyond the UI reconnect and the programmatic refresh call already tried, both confirmed insufficient here)?
3. Any known issues in this window (8/30–9/3/2026) affecting custom-connector tool discovery specifically for Streamable-HTTP connectors hosted on Vercel?

Happy to provide the connector's route handler source, Vercel deployment logs, or reproduce live on a call if useful.
