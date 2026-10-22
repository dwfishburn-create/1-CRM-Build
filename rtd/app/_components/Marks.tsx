import { shortDay, type FieldUpdate } from "@/lib/rtd";

// Small labels for the team's live edits (10/22/2026).
// Everyone sees who changed something; only Dan sees whether it's in his CRM.

export function UpdatedBy({ u, isAdmin }: { u: FieldUpdate | null; isAdmin: boolean }) {
  if (!u) return null;
  return (
    <span className="s updated">
      Updated by {u.author}, {shortDay(u.at)}
      {isAdmin && !u.in_crm && <> · <span className="crmmark">Not in CRM</span></>}
    </span>
  );
}

/** Dan-only: "Not in CRM" / "RTD only". Renders nothing for colleagues. */
export function CrmMark({ isAdmin, status }: { isAdmin: boolean; status?: string | null }) {
  if (!isAdmin || !status) return null;
  if (status === "pending") return <span className="pill pill-crm">Not in CRM</span>;
  if (status === "kept") return <span className="pill pill-plain">RTD only</span>;
  return null;
}
