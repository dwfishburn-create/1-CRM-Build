"use server";

import { globalSearch, type SearchResults } from "@/lib/globalSearch";
import { scopeForKind } from "@/lib/searchScope";

// The top-menu search box calls this as you type. A server action rather
// than a new /api route: the app's reads already run server-side with the
// secret key, and /api/agent/* is the Claude-session surface behind
// AGENT_API_TOKEN, which a browser can't carry.
//
// `only` (11/19/2026) scopes the search to one record type — the page you're
// on. Scoped results show 10 instead of 5, since there is only one group.
export async function searchAction(q: string, only?: string | null): Promise<SearchResults> {
  const scope = scopeForKind(only);
  return globalSearch(typeof q === "string" ? q : "", scope ? 10 : 5, scope?.kind ?? null);
}
