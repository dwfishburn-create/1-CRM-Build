import Link from "next/link";
import { liquorMeta, type LiquorMeta } from "@/lib/liquorLicenses";
import { ActionForm } from "../../_components/ActionForm";
import { rollbackSnapshotAction } from "../actions";
import { RosterFileInput } from "./RosterFileInput";

export const dynamic = "force-dynamic";

// Import an NLCC Active License Roster (10/26/2026, migration 032). Every pull
// is a dated snapshot: keep the raw file in Dropbox
// /Prospecting/Liquor Licenses/Raw/ (never overwritten), upload it here, and
// the CRM records what changed since the last pull. Rosters go in date order;
// the most recent one can be undone.

const control =
  "border border-gray-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 rounded px-2 py-1.5 text-sm";
const link = "text-blue-600 dark:text-blue-400 hover:underline";

function first(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v ?? "").trim();
}

export default async function ImportRosterPage(props: PageProps<"/liquor-licenses/import">) {
  const sp = await props.searchParams;
  const error = first(sp.error);
  const done = first(sp.done);
  let meta: LiquorMeta | null = null;
  let loadError: string | null = null;
  try {
    meta = await liquorMeta();
  } catch (e) {
    loadError = e instanceof Error ? e.message : String(e);
  }
  const imported = (meta?.snapshots ?? []).filter((s) => s.imported_at);
  const latest = imported[0];

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <Link href="/liquor-licenses" className={`text-sm ${link}`}>← Liquor Licenses</Link>
      <h1 className="text-2xl font-semibold mt-2 mb-1">Import a liquor license roster</h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
        Upload an NLCC Active License Roster (.xlsx). Only Nebraska retail and miscellaneous licenses are kept;
        out-of-state shippers are skipped. Save the file in Dropbox <code>/Prospecting/Liquor Licenses/Raw/</code> with its
        date first — every pull is kept, never overwritten. Rosters load in date order: the first is the baseline, each
        later one is compared with the one before (new, dropped, new licensee, new manager, moved).
      </p>

      {loadError && <p className="mb-4 text-sm text-red-600">Couldn&apos;t load: {loadError}</p>}
      {error && (
        <p role="alert" className="mb-4 text-sm text-red-600">
          Not imported — {error}
        </p>
      )}
      {done && (
        <div className="mb-6 rounded border border-green-300 bg-green-50 dark:bg-green-950 dark:border-green-800 p-3 text-sm">
          <b>Imported {done}</b> — {Number(first(sp.rows)).toLocaleString()} Nebraska licenses
          {Number(first(sp.skipped)) > 0 && <> ({Number(first(sp.skipped)).toLocaleString()} out-of-state / shipper rows skipped)</>}.
          {first(sp.baseline) === "1" ? (
            <> This is the baseline roster — later pulls will be compared with it.</>
          ) : (
            <>
              {" "}
              <b>{first(sp.new)}</b> new, <b>{first(sp.dropped)}</b> dropped, <b>{first(sp.returned)}</b> back on, <b>{first(sp.changed)}</b> changed.{" "}
              <Link className={link} href={`/liquor-licenses?view=changes&since=${done.replace(/^nlcc-/, "")}`}>See the changes →</Link>
            </>
          )}
          <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">
            Active licenses linked: {first(sp.brand)} to a directory brand, {first(sp.company)} to a CRM company, {first(sp.property)} to a CRM property.
          </div>
        </div>
      )}

      <form
        method="post"
        action="/liquor-licenses/import/upload"
        encType="multipart/form-data"
        className="flex flex-wrap items-end gap-3 mb-10"
      >
        <RosterFileInput control={control} />
        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 pb-1.5">
          <input type="checkbox" name="date_ok" value="yes" />
          the date is right even if the file name differs
        </label>
        <button type="submit" className="bg-blue-600 text-white rounded px-4 py-1.5 text-sm">
          Import
        </button>
        <p className="w-full text-xs text-gray-500">A 6,000-row roster takes about 10–20 seconds. Don&apos;t press Import twice.</p>
      </form>

      <h2 className="text-lg font-semibold mb-2">Rosters on file</h2>
      {imported.length === 0 ? (
        <p className="text-sm text-gray-400">None yet.</p>
      ) : (
        <table className="w-full text-sm border-collapse mb-6">
          <thead>
            <tr className="text-left border-b border-gray-300 dark:border-neutral-700">
              <th className="py-2 pr-3 font-medium">Roster date</th>
              <th className="py-2 pr-3 font-medium">File</th>
              <th className="py-2 pr-3 font-medium text-right">Licenses</th>
              <th className="py-2 pr-3 font-medium text-right">New</th>
              <th className="py-2 pr-3 font-medium text-right">Dropped</th>
              <th className="py-2 pr-3 font-medium text-right">Changed</th>
              <th className="py-2 pr-3 font-medium">Imported</th>
            </tr>
          </thead>
          <tbody>
            {imported.map((s) => (
              <tr key={s.batch_id} className="border-b border-gray-100 dark:border-neutral-800">
                <td className="py-2 pr-3">{s.snapshot_date}{s.baseline ? " (baseline)" : ""}</td>
                <td className="py-2 pr-3 text-xs break-all">{s.source_file}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{Number(s.rows).toLocaleString()}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{s.baseline ? "—" : s.new}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{s.dropped}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{s.changed}</td>
                <td className="py-2 pr-3 text-xs">{s.imported_at?.slice(0, 10)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {latest && (
        <ActionForm action={rollbackSnapshotAction} className="flex flex-wrap items-center gap-3 text-sm">
          <input type="hidden" name="batch_id" value={latest.batch_id} />
          <label className="flex items-center gap-2">
            <input type="checkbox" name="confirm" value="yes" />
            Undo the {latest.snapshot_date} roster (licenses it added are removed, the rest go back to how the previous
            roster left them; your links and notes stay)
          </label>
          <button type="submit" className="border border-red-400 text-red-700 rounded px-3 py-1 text-sm">
            Undo latest roster
          </button>
        </ActionForm>
      )}
    </div>
  );
}
