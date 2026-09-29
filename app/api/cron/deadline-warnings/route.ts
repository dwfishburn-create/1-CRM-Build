import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { runDeadlineWarnings } from "@/lib/deadlines";

// Daily at ~5 a.m. Central (vercel.json: 10:00 UTC). Vercel Cron sends
// `Authorization: Bearer <CRON_SECRET>` when the CRON_SECRET environment
// variable is set — set it in Vercel before relying on this. The Dashboard
// also runs the generator on load, so a missed cron run is caught the first
// time Dan opens the app.
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not set." }, { status: 500 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const issued = await runDeadlineWarnings();
    return NextResponse.json({ issued, ran_at: new Date().toISOString() });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
