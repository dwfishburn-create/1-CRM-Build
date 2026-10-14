import { CONFIDENCE } from "@/lib/requirementReconfirm";
import { TARGET_MARKETS } from "@/lib/retailBrands";

// The four expansion-signal inputs (10/13/2026, migration 026), shared by the
// add form on /requirements and the edit form on /requirements/[id]. Markets
// are checkboxes against the closed list; the dates are plain date inputs.
// Server component — no client state.

export function SignalFields({
  confidence,
  sourceDate,
  reconfirmDate,
  markets = [],
  input,
}: {
  confidence?: string | null;
  sourceDate?: string | null;
  reconfirmDate?: string | null;
  markets?: string[];
  input: string;
}) {
  return (
    <>
      <label className="text-xs text-gray-600 dark:text-gray-400">
        Confidence
        <select name="confidence" defaultValue={confidence ?? ""} className={`${input} w-full`}>
          <option value="">—</option>
          {CONFIDENCE.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </label>
      <label className="text-xs text-gray-600 dark:text-gray-400">
        Heard on (source date)
        <input name="source_date" type="date" defaultValue={sourceDate ?? ""} className={`${input} w-full`} />
      </label>
      <label className="text-xs text-gray-600 dark:text-gray-400" title="An active requirement with a re-confirm date gets one open task on the Dashboard">
        Re-confirm by
        <input name="reconfirm_date" type="date" defaultValue={reconfirmDate ?? ""} className={`${input} w-full`} />
      </label>
      <fieldset className="text-xs text-gray-600 dark:text-gray-400">
        <legend>Target markets</legend>
        <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1">
          {TARGET_MARKETS.map((m) => (
            <label key={m.value} className="flex items-center gap-1 text-sm text-gray-800 dark:text-gray-200">
              <input type="checkbox" name="target_markets" value={m.value} defaultChecked={markets.includes(m.value)} />
              {m.label}
            </label>
          ))}
        </div>
      </fieldset>
    </>
  );
}
