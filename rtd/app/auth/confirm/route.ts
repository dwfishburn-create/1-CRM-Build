import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { db } from "@/lib/supabase";

// Where the emailed link lands: ?token_hash=… (custom template, any device)
// or ?code=… (Supabase's default template, same browser only).
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const supabase = await db();
  let ok = false;
  const tokenHash = sp.get("token_hash");
  const code = sp.get("code");
  if (tokenHash) {
    ok = !(await supabase.auth.verifyOtp({ type: (sp.get("type") || "email") as EmailOtpType, token_hash: tokenHash })).error;
  } else if (code) {
    ok = !(await supabase.auth.exchangeCodeForSession(code)).error;
  }

  const dest = request.nextUrl.clone();
  dest.search = "";
  if (!ok) {
    dest.pathname = "/login";
    dest.searchParams.set("error", "link");
    return NextResponse.redirect(dest);
  }
  const next = request.cookies.get("post_login_next")?.value || "/";
  const safe = next.startsWith("/") && !next.startsWith("//") ? next : "/";
  const [p, q] = safe.split("?");
  dest.pathname = p;
  dest.search = q ? `?${q}` : "";
  const res = NextResponse.redirect(dest);
  res.cookies.delete("post_login_next");
  return res;
}
