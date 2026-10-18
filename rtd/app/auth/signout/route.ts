import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { db } from "@/lib/supabase";

export async function POST(request: NextRequest) {
  const supabase = await db();
  await supabase.auth.signOut({ scope: "local" });
  const dest = request.nextUrl.clone();
  dest.pathname = "/login";
  dest.search = "";
  return NextResponse.redirect(dest, { status: 303 });
}
