"use server";

import { globalSearch, type SearchResults } from "@/lib/globalSearch";

// The top-menu search box calls this as you type. A server action rather
// than a new /api route: the app's reads already run server-side with the
// secret key, and /api/agent/* is the Claude-session surface behind
// AGENT_API_TOKEN, which a browser can't carry.
export async function searchAction(q: string): Promise<SearchResults> {
  return globalSearch(typeof q === "string" ? q : "", 5);
}
