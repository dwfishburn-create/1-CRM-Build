import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { db } from "@/lib/supabase";

// Where the emailed link lands: ?token_hash=… (custom template, any device)
// or ?code=… (Supabase's default template, same browser only).
//
// 10/22/2026: the link no longer signs in on GET. CBRE's email security opens
// every link in an email within seconds to scan it; a GET that verified the
// token used it up (and the 6-digit code with it), so Trey's code "didn't
// work". Now GET only shows a "Sign in" button; the button POSTs, and only
// that verifies. Scanners fetch pages, they don't press buttons.

const OTP_TYPES = new Set(["email", "magiclink", "signup", "invite", "recovery", "email_change"]);

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const tokenHash = sp.get("token_hash") ?? "";
  const code = sp.get("code") ?? "";
  const type = sp.get("type") ?? "email";
  if (!tokenHash && !code) {
    const dest = request.nextUrl.clone();
    dest.pathname = "/login";
    dest.search = "?error=link";
    return NextResponse.redirect(dest);
  }
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Sign in · RTD</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f3f4ef; color: #14201f;
         font-family: "IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif; padding: 16px; box-sizing: border-box; }
  .card { background: #fff; border: 1px solid #d9ded6; border-radius: 14px; padding: 28px; max-width: 380px; width: 100%;
          display: flex; flex-direction: column; gap: 14px; text-align: center; }
  .logo { align-self: center; background: #c6e84b; color: #0f2a2e; font-weight: 800; border-radius: 10px; padding: 8px 10px; }
  h1 { margin: 0; font-size: 22px; }
  p { margin: 0; color: #4e6460; line-height: 1.5; }
  button { font: inherit; font-weight: 700; min-height: 48px; border: 0; border-radius: 10px; background: #0f2a2e; color: #fff; cursor: pointer; }
  button:focus-visible { outline: 3px solid #c6e84b; outline-offset: 2px; }
</style></head>
<body><form class="card" method="post" action="/auth/confirm">
  <span class="logo">RTD</span>
  <h1>Retail Tenant Directory</h1>
  <p>Tap the button to finish signing in on this device.</p>
  <input type="hidden" name="token_hash" value="${esc(tokenHash)}">
  <input type="hidden" name="code" value="${esc(code)}">
  <input type="hidden" name="type" value="${esc(type)}">
  <button type="submit">Sign in</button>
</form></body></html>`;
  return new NextResponse(html, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
  });
}

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const tokenHash = String(form.get("token_hash") ?? "");
  const code = String(form.get("code") ?? "");
  const rawType = String(form.get("type") ?? "email");
  const type = (OTP_TYPES.has(rawType) ? rawType : "email") as EmailOtpType;

  const supabase = await db();
  let ok = false;
  if (tokenHash) {
    ok = !(await supabase.auth.verifyOtp({ type, token_hash: tokenHash })).error;
  } else if (code) {
    ok = !(await supabase.auth.exchangeCodeForSession(code)).error;
  }

  const dest = request.nextUrl.clone();
  dest.search = "";
  if (!ok) {
    dest.pathname = "/login";
    dest.searchParams.set("error", "link");
    return NextResponse.redirect(dest, 303);
  }
  const next = request.cookies.get("post_login_next")?.value || "/";
  const safe = next.startsWith("/") && !next.startsWith("//") ? next : "/";
  const [p, q] = safe.split("?");
  dest.pathname = p;
  dest.search = q ? `?${q}` : "";
  const res = NextResponse.redirect(dest, 303);
  res.cookies.delete("post_login_next");
  return res;
}
