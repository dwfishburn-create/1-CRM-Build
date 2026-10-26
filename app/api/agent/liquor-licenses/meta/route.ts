import { NextResponse } from "next/server";
import { liquorMeta } from "@/lib/liquorLicenses";

// GET /api/agent/liquor-licenses/meta — roster status: latest roster date,
// counts on file, how many are linked, every snapshot with its new / dropped /
// changed counts, the counties on file and the class list.
export async function GET() {
  try {
    return NextResponse.json(await liquorMeta());
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
