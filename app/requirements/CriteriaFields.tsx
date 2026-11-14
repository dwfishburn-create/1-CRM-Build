import { ASSET_CLASSES, CREDIT_LEVELS, SIDES, TENANCY_TYPES } from "@/lib/requirementCriteria";
import type { Choice } from "@/lib/retailBrands";

// Matching criteria inputs (11/14/2026, migration 037 — Phase 4 buyer
// matching), shared by the add form on /requirements and the edit form on
// /requirements/[id]. Blank = not a criterion (the 50% rule only counts what
// the party actually stated). Server component — no client state.

export type CriteriaValues = {
  sides?: string[] | null;
  asset_classes?: string[] | null;
  acres_min?: number | null;
  acres_max?: number | null;
  cap_rate_min?: number | null;
  tenancy_types?: string[] | null;
  credit_floor?: string | null;
  min_term_years?: number | null;
  exchange_1031?: boolean | null;
  exchange_identify_by?: string | null;
  exchange_close_by?: string | null;
};

function Checks({ name, list, values, legend }: { name: string; list: Choice[]; values: string[]; legend: string }) {
  return (
    <fieldset className="text-xs text-gray-600 dark:text-gray-400">
      <legend>{legend}</legend>
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1">
        {list.map((c) => (
          <label key={c.value} className="flex items-center gap-1 text-sm text-gray-800 dark:text-gray-200">
            <input type="checkbox" name={name} value={c.value} defaultChecked={values.includes(c.value)} />
            {c.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function CriteriaFields({ v = {}, input }: { v?: CriteriaValues; input: string }) {
  const num = (x: number | null | undefined) => (x === null || x === undefined ? "" : x);
  return (
    <div className="col-span-4 grid grid-cols-4 gap-3 items-end border-t border-gray-200 dark:border-gray-700 pt-3">
      <p className="col-span-4 text-xs font-semibold text-gray-700 dark:text-gray-300">
        Matching criteria <span className="font-normal text-gray-500">— leave blank what they didn&apos;t say; blanks aren&apos;t scored</span>
      </p>
      <div className="col-span-2">
        <Checks name="sides" list={SIDES} values={v.sides ?? []} legend="Side" />
      </div>
      <div className="col-span-2">
        <Checks name="asset_classes" list={ASSET_CLASSES} values={v.asset_classes ?? []} legend="Property classes" />
      </div>
      <label className="text-xs text-gray-600 dark:text-gray-400">
        Land min (acres)
        <input name="acres_min" type="number" step="any" defaultValue={num(v.acres_min)} className={`${input} w-full`} />
      </label>
      <label className="text-xs text-gray-600 dark:text-gray-400">
        Land max (acres)
        <input name="acres_max" type="number" step="any" defaultValue={num(v.acres_max)} className={`${input} w-full`} />
      </label>
      <label className="text-xs text-gray-600 dark:text-gray-400">
        Min cap rate (%)
        <input name="cap_rate_min" type="number" step="any" defaultValue={num(v.cap_rate_min)} className={`${input} w-full`} />
      </label>
      <label className="text-xs text-gray-600 dark:text-gray-400">
        Min lease term left (yrs)
        <input name="min_term_years" type="number" step="any" defaultValue={num(v.min_term_years)} className={`${input} w-full`} />
      </label>
      <div className="col-span-3">
        <Checks name="tenancy_types" list={TENANCY_TYPES} values={v.tenancy_types ?? []} legend="Tenancy (investors)" />
      </div>
      <label className="text-xs text-gray-600 dark:text-gray-400">
        Tenant credit floor
        <select name="credit_floor" defaultValue={v.credit_floor ?? ""} className={`${input} w-full`}>
          <option value="">—</option>
          {CREDIT_LEVELS.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label} or better
            </option>
          ))}
        </select>
      </label>
      <label className="text-xs text-gray-600 dark:text-gray-400 flex items-center gap-2 pb-2">
        <input type="checkbox" name="exchange_1031" defaultChecked={!!v.exchange_1031} />
        1031 exchange buyer
      </label>
      <label className="text-xs text-gray-600 dark:text-gray-400">
        1031 identify by
        <input name="exchange_identify_by" type="date" defaultValue={v.exchange_identify_by ?? ""} className={`${input} w-full`} />
      </label>
      <label className="text-xs text-gray-600 dark:text-gray-400">
        1031 close by
        <input name="exchange_close_by" type="date" defaultValue={v.exchange_close_by ?? ""} className={`${input} w-full`} />
      </label>
    </div>
  );
}
