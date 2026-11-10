import ImportClient from "./ImportClient";
import { importStatus } from "./actions";
import { REALNEX_PROPERTY_BATCH as BATCH_ID } from "@/lib/realnexImport";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function RealnexImportPage() {
  const status = await importStatus();
  return (
    <div className="max-w-3xl mx-auto p-6 space-y-4">
      <h1 className="text-xl font-semibold">RealNex properties + owners → map</h1>
      <p className="text-sm text-gray-500">
        Phase 2 of Retail Listing Intake &amp; Matching. Loads the 3,834-row RealNex property export
        (9/18/2026) as batch <code>{BATCH_ID}</code>: exact matches to existing properties/owners are
        reused and never edited; everything else is created with provenance. Procedure: pilot → check →
        rollback → pilot again → full.
      </p>
      <ImportClient initialStatus={status} />
    </div>
  );
}
