import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

// Two gates (10/16/2026):
//
// 1. /api/agent/* — the Agent API Claude sessions use. Unchanged: a single
//    shared-secret bearer token (AGENT_API_TOKEN, set in Vercel), separate
//    from and much lower-privilege than the Supabase secret key. Never commit
//    the token value anywhere in this repo.
//
// 2. Everything else that renders CRM data — every page and every Server
//    Action — needs a signed-in session whose email is on CRM_ALLOWED_EMAILS
//    (default: Dan's). Until 10/16/2026 the CRM had no sign-in at all.
//
// Left alone here because they check their own secrets: the MCP connector
// route (app/api/[transport], MCP_API_TOKEN) and the daily cron
// (/api/cron/*, CRON_SECRET). The sign-in pages themselves are public.

const PUBLIC_PATHS = ["/login", "/auth/"];

function agentGate(request: NextRequest) {
  const expectedToken = process.env.AGENT_API_TOKEN;
  if (!expectedToken) {
    return NextResponse.json(
      { error: "Agent API is not configured (missing AGENT_API_TOKEN)." },
      { status: 500 }
    );
  }
  if ((request.headers.get("authorization") || "") !== `Bearer ${expectedToken}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.next();
}

function allowed(email: string | undefined): boolean {
  if (!email) return false;
  const list = (process.env.CRM_ALLOWED_EMAILS || "dwfishburn@gmail.com")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email.toLowerCase());
}

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;

  if (path.startsWith("/api/agent/")) return agentGate(request);
  if (path.startsWith("/api/")) return NextResponse.next();
  if (PUBLIC_PATHS.some((p) => path === p || path.startsWith(p))) return NextResponse.next();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    return new NextResponse(
      "Sign-in is not configured: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in Vercel.",
      { status: 500 }
    );
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(list) {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // getUser() checks the session with Supabase and refreshes it when needed,
  // which is what keeps Dan signed in for months on the same device.
  const { data } = await supabase.auth.getUser();
  if (allowed(data.user?.email)) return response;

  // Server Actions (fetch POSTs) get a plain 401 instead of a redirect page.
  if (request.method !== "GET" && request.method !== "HEAD") {
    return NextResponse.json({ error: "Signed out — reload the page to sign in." }, { status: 401 });
  }
  const login = request.nextUrl.clone();
  login.pathname = "/login";
  login.search = "";
  if (path !== "/") login.searchParams.set("next", path + request.nextUrl.search);
  if (data.user) login.searchParams.set("denied", "1");
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico)$).*)"],
};
