import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/app/_components/ActionForm";
import { loadProspectChecklist } from "@/lib/prospectChecklist";
import { addCampaignAction } from "./actions";
import { ProspectTable } from "./ProspectTable";

export const dynamic = "force-dynamic";

// Prospect Checklist — every buyer prospect on a listing, worked from the CRM
// instead of a spreadsheet (11/18/2026, migration 039). First listing:
// CS-3167 Joliet Ave. The .xlsx export doubles as the Listing Agreement's
// Existing Prospects list.

export default async function ProspectChecklistPage(props: PageProps<"/projects/[id]/prospects">) {
  const { id } = await props.params;
  const checklist = await loadProspectChecklist(id);
  if (!checklist) notFound();
  const { project, rows, campaigns, called_since } = checklist;

  const noPhone = rows.filter((r) => !r.phone).length;
  const noEmail = rows.filter((r) => !r.email).length;
  const overdue = rows.filter((r) => r.open_task_overdue).length;
  const input = "border border-gray-300 rounded px-2 py-1 text-sm bg-transparent";

  return (
    <div className="p-6 max-w-[100rem] mx-auto">
      <Link href={`/projects/${id}`} className="text-sm text-blue-600 underline">
        ← {project.project_code}
      </Link>
      <div className="flex flex-wrap items-end justify-between gap-3 mt-2 mb-4">
        <div>
          <h1 className="text-2xl font-semibold">Prospect Checklist</h1>
          <p className="text-gray-500 text-sm">
            {project.project_code} · {project.client_name} · {rows.length} buyer prospects
            {noPhone > 0 && <> · <span className="text-red-700">{noPhone} no phone</span></>}
            {noEmail > 0 && <> · <span className="text-amber-700">{noEmail} no email</span></>}
            {overdue > 0 && <> · <span className="text-red-600 font-medium">{overdue} overdue follow-up{overdue === 1 ? "" : "s"}</span></>}
          </p>
        </div>
        <a
          href={`/projects/${id}/prospects/export`}
          className="px-3 py-1.5 rounded border border-gray-300 text-sm"
          title="Same columns as this page. Doubles as the Listing Agreement's Existing Prospects list."
        >
          Export to Excel
        </a>
      </div>

      <p className="text-xs text-gray-500 mb-3">
        A prospect is anyone linked to this deal as <em>counterparty</em> with a role containing “prospect” or
        “buyer”; the seller is never listed. Numbers never change, so “#19” always means the same person. A new
        prospect linked to the deal gets the next number automatically.
      </p>

      <ProspectTable projectId={id} rows={rows} campaigns={campaigns} calledSince={called_since} />

      <details className="mt-6 border border-gray-200 rounded-lg">
        <summary className="cursor-pointer px-4 py-2 text-sm font-medium text-blue-700 select-none">
          + Add a campaign column (a dated send to the prospect list)
        </summary>
        <ActionForm action={addCampaignAction} className="p-4 pt-2 flex flex-wrap items-end gap-3">
          <input type="hidden" name="project_id" value={id} />
          <label className="text-xs text-gray-500 flex flex-col">
            Name
            <input name="name" required className={`${input} w-64`} placeholder="e.g. Year-end call-around" />
          </label>
          <label className="text-xs text-gray-500 flex flex-col">
            Sent on
            <input name="sent_on" type="date" className={input} />
          </label>
          <label className="text-xs text-gray-500 flex flex-col">
            Notes
            <input name="notes" className={`${input} w-80`} />
          </label>
          <button type="submit" className="px-3 py-1 rounded bg-blue-600 text-white text-sm">
            Add
          </button>
          <p className="w-full text-xs text-gray-500">
            “Not yet called” counts calls and texts on or after the newest campaign’s date.
          </p>
        </ActionForm>
      </details>
    </div>
  );
}
