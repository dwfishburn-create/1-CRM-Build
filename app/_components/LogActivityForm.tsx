import { logActivityAction } from "./recordActions";
import { todayCentral, type Option } from "@/lib/contactOptions";

// Log Activity form for the Contact, Property and Entity pages (9/24/2026,
// fifth pass). Posts through lib/activity.ts — the same function the Agent
// API uses — so a next step WITH a follow-up date becomes a task, and picking
// a "waiting on" contact puts that task in the Dashboard's Waiting On column
// instead of Your Move. No client JavaScript: a plain form and a server action.

const TYPES = [
  "Call",
  "Voicemail",
  "Email",
  "Text",
  "Meeting",
  "Tour",
  "Note",
  "Research",
  "LOI Sent",
  "Proposal Sent",
];

export function LogActivityForm({
  returnPath,
  contactId,
  entityId,
  propertyId,
  projects = [],
  preferredContacts = [],
  allContacts = [],
}: {
  returnPath: string;
  contactId?: string;
  entityId?: string;
  propertyId?: string;
  projects?: Option[];
  preferredContacts?: Option[];
  allContacts?: Option[];
}) {
  const preferredIds = new Set(preferredContacts.map((c) => c.id));
  const others = allContacts.filter((c) => !preferredIds.has(c.id));
  const input = "border border-gray-300 rounded px-2 py-1 text-sm w-full";

  return (
    <details className="mb-8 border border-gray-200 rounded-lg">
      <summary className="cursor-pointer px-4 py-2 text-sm font-medium text-blue-700 select-none">
        + Log activity
      </summary>
      <form action={logActivityAction} className="p-4 pt-2 grid grid-cols-4 gap-3">
        <input type="hidden" name="return_path" value={returnPath} />
        {contactId && <input type="hidden" name="contact_id" value={contactId} />}
        {entityId && <input type="hidden" name="entity_id" value={entityId} />}
        {propertyId && <input type="hidden" name="property_id" value={propertyId} />}

        <label className="text-xs text-gray-600">
          Type
          <input name="activity_type" list="activity-types" required className={input} placeholder="Call" />
          <datalist id="activity-types">
            {TYPES.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </label>
        <label className="text-xs text-gray-600">
          Date
          <input name="activity_date" type="date" defaultValue={todayCentral()} className={input} />
        </label>
        {projects.length > 0 ? (
          <label className="text-xs text-gray-600 col-span-2">
            Deal (optional)
            <select name="project_id" className={input} defaultValue="">
              <option value="">— none —</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <div className="col-span-2" />
        )}

        <label className="text-xs text-gray-600 col-span-4">
          What happened
          <textarea name="summary" rows={3} className={input} />
        </label>

        <label className="text-xs text-gray-600 col-span-2">
          Next step
          <input name="next_step" className={input} placeholder="e.g. Follow up on LOI comments" />
        </label>
        <label className="text-xs text-gray-600">
          Follow-up date
          <input name="next_step_due_date" type="date" className={input} />
        </label>
        <label className="text-xs text-gray-600">
          Ball in whose court
          <select name="waiting_on_contact_id" className={input} defaultValue="">
            <option value="">Mine (Your move)</option>
            {preferredContacts.length > 0 && (
              <optgroup label="On this record">
                {preferredContacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    Waiting on {c.label}
                  </option>
                ))}
              </optgroup>
            )}
            {others.length > 0 && (
              <optgroup label="Everyone else">
                {others.map((c) => (
                  <option key={c.id} value={c.id}>
                    Waiting on {c.label}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </label>

        <p className="col-span-3 text-xs text-gray-500 self-center">
          A next step with a follow-up date goes on the Dashboard as a task. Without a date it stays a note on this entry.
        </p>
        <button type="submit" className="bg-blue-600 text-white rounded px-3 py-1.5 text-sm justify-self-end">
          Save activity
        </button>
      </form>
    </details>
  );
}
