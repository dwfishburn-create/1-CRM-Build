import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Gates the /api/agent/* surface used by Claude sessions to push data
// directly into the CRM. Auth is a single shared-secret bearer token
// (AGENT_API_TOKEN, set in Vercel Project Settings -> Environment
// Variables), separate from and much lower-privilege than the Supabase
// secret key. Never commit the token value anywhere in this repo.
export function proxy(request: NextRequest) {
  const expectedToken = process.env.AGENT_API_TOKEN;

  if (!expectedToken) {
    return NextResponse.json(
      { error: "Agent API is not configured (missing AGENT_API_TOKEN)." },
      { status: 500 }
    );
  }

  const authHeader = request.headers.get("authorization") || "";
  const expected = `Bearer ${expectedToken}`;

  if (authHeader !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: "/api/agent/:path*",
};
