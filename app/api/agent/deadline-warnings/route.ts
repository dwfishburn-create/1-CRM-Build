import { NextResponse } from "next/server";
import { runDeadlineWarnings } from "@/lib/deadlines";

// POST /api/agent/deadline-warnings — run the warning generator now (the same
// one the daily cron runs). Idempotent: a second run the same day issues 0.
export async function POST() {
  try {
    const issued = await runDeadlineWarnings();
    return NextResponse.json({ issued });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
