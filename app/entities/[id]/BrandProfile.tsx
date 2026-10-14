import Link from "next/link";
import { ActionForm } from "@/app/_components/ActionForm";
import { Empty, Field, Section, VerificationBanner } from "@/app/_components/RecordParts";
import { contactHref, dueClass, personName, requirementHref } from "@/lib/records";
import {
  BRAND_CONTACT_ROLES,
  DRIVE_THRU,
  EXPANSION_STATUSES,
  FACILITY_TYPES,
  OPERATING_MODELS,
  TARGET_MARKETS,
  choiceLabel,
  sizeRange,
  type Choice,
  type RetailCategory,
} from "@/lib/retailBrands";
import { CONFIDENCE } from "@/lib/requirementReconfirm";
import {
  createBrandProfile,
  markBrandVerified,
  setAffiliationCurrent,
  updateBrandProfile,
} from "../actions";

// "Retail brand profile" on the entity page (10/13/2026, migration 026). A
// brand is this entity plus one retail_brands row: no row → a small "Add to
// Tenant Directory" form; a row → the profile, an edit form, Mark verified,
// the brand's people (current and former) and its active requirements with
// their re-confirm dates. Server component; every form posts to
// app/entities/actions.ts, which validates through lib/retailBrands.ts.

export type BrandRow = {
  id: string;
  entity_id: string;
  category: string | null;
  category_detail: string | null;
  size_min_sf: number | null;
  size_max_sf: number | null;
  frontage_min_ft: number | null;
  drive_thru: string | null;
  facility_types: string[];
  site_criteria: string | null;
  operating_model: string | null;
  expansion_status: string;
  target_markets: string[];
  needs_verification: boolean;
  last_verified_on: string | null;
  verification_note: string | null;
  notes: string | null;
  source_system: string | null;
};

export type BrandPerson = {
  link_id: string | null;
  contact: { id: string; first_name: string | null; last_name: string | null; title: string | null };
  role: string | null;
  is_current: boolean;
  started_on: string | null;
  ended_on: string | null;
};

export type BrandRequirement = {
  id: string;
  display_code: string | null;
  deal_type: string | null;
  size_min: number | null;
  size_max: number | null;
  target_markets: string[] | null;
  confidence: string | null;
  reconfirm_date: string | null;
};

const input =
  "border border-gray-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 rounded px-2 py-1 text-sm";
const lbl = "text-xs text-gray-600 dark:text-gray-400";

function Checks({ name, list, checked }: { name: string; list: Choice[]; checked: string[] }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1">
      <input type="hidden" name={`${name}__present`} value="1" />
      {list.map((c) => (
        <label key={c.value} className="flex items-center gap-1 text-sm text-gray-800 dark:text-gray-200">
          <input type="checkbox" name={name} value={c.value} defaultChecked={checked.includes(c.value)} />
          {c.label}
        </label>
      ))}
    </div>
  );
}

function Select({
  name,
  list,
  value,
  blank = "—",
}: {
  name: string;
  list: Choice[];
  value: string | null;
  blank?: string | null;
}) {
  return (
    <select name={name} defaultValue={value ?? ""} className={`${input} w-full`}>
      {blank !== null && <option value="">{blank}</option>}
      {list.map((c) => (
        <option key={c.value} value={c.value}>
          {c.label}
        </option>
      ))}
    </select>
  );
}

export function BrandProfile({
  entityId,
  brand,
  categories,
  people,
  requirements,
  metroLocations,
}: {
  entityId: string;
  brand: BrandRow | null;
  categories: RetailCategory[];
  people: BrandPerson[];
  requirements: BrandRequirement[];
  metroLocations: number;
}) {
  const catChoices: Choice[] = categories.map((c) => ({ value: c.code, label: c.label }));

  if (!brand) {
    return (
      // Collapsed: most entities are owner LLCs, title companies and brokerages
      // that will never be in the directory.
      <details className="mb-8">
        <summary className="text-sm text-blue-700 dark:text-blue-400 cursor-pointer select-none">
          Add to Tenant Directory
        </summary>
        <p className="text-sm text-gray-500 dark:text-gray-400 my-2">
          For a retail, restaurant or service brand that leases space. The rest of the profile can
          be filled in after.
        </p>
        <ActionForm action={createBrandProfile} className="grid grid-cols-4 gap-3 items-end border border-gray-200 dark:border-neutral-800 rounded-lg p-3">
          <input type="hidden" name="entity_id" value={entityId} />
          <label className={`${lbl} col-span-2`}>
            Category
            <Select name="category" list={catChoices} value={null} />
          </label>
          <label className={lbl}>
            Size min (SF)
            <input name="size_min_sf" type="number" className={`${input} w-full`} />
          </label>
          <label className={lbl}>
            Size max (SF)
            <input name="size_max_sf" type="number" className={`${input} w-full`} />
          </label>
          <fieldset className={`${lbl} col-span-4`}>
            <legend>Target markets</legend>
            <Checks name="target_markets" list={TARGET_MARKETS} checked={[]} />
          </fieldset>
          <div className="col-span-4">
            <button type="submit" className="bg-blue-600 text-white rounded px-3 py-1 text-sm">
              Add to Tenant Directory
            </button>
            <span className="ml-3 text-xs text-gray-500 dark:text-gray-400">Starts as unverified.</span>
          </div>
        </ActionForm>
      </details>
    );
  }

  const cat = categories.find((c) => c.code === brand.category);
  const current = people.filter((p) => p.is_current);
  const former = people.filter((p) => !p.is_current);

  return (
    <Section title="Retail brand profile">
      <VerificationBanner
        needs={brand.needs_verification}
        note={brand.verification_note ?? (brand.source_system ? `Loaded from ${brand.source_system}.` : null)}
      />

      <div className="grid grid-cols-4 gap-4 mb-4 border border-gray-200 dark:border-neutral-800 rounded-lg p-4">
        <Field label="Category">
          {cat?.label ?? brand.category ?? "—"}
          {brand.category_detail && <span className="text-gray-500"> · {brand.category_detail}</span>}
        </Field>
        <Field label="Size">{sizeRange(brand.size_min_sf, brand.size_max_sf)}</Field>
        <Field label="Frontage">{brand.frontage_min_ft != null ? `${brand.frontage_min_ft} ft min` : "—"}</Field>
        <Field label="Drive-thru">{choiceLabel(DRIVE_THRU, brand.drive_thru)}</Field>
        <Field label="Facility types">
          {brand.facility_types.length ? brand.facility_types.map((f) => choiceLabel(FACILITY_TYPES, f)).join(", ") : "—"}
        </Field>
        <Field label="Target markets">
          {brand.target_markets.length ? brand.target_markets.map((m) => choiceLabel(TARGET_MARKETS, m)).join(", ") : "—"}
        </Field>
        <Field label="Operating model">{choiceLabel(OPERATING_MODELS, brand.operating_model)}</Field>
        <Field label="Expansion">{choiceLabel(EXPANSION_STATUSES, brand.expansion_status)}</Field>
        <Field label="Metro locations">{metroLocations}</Field>
        <Field label="Verified">
          {brand.needs_verification ? (
            <span className="text-amber-700 dark:text-amber-400">unverified</span>
          ) : (
            brand.last_verified_on ?? "yes"
          )}
          {!brand.needs_verification && brand.verification_note && (
            <span className="text-gray-500"> · {brand.verification_note}</span>
          )}
        </Field>
        {brand.site_criteria && (
          <div className="col-span-4">
            <Field label="Site criteria">
              <span className="whitespace-pre-wrap">{brand.site_criteria}</span>
            </Field>
          </div>
        )}
        {brand.notes && (
          <div className="col-span-4">
            <Field label="Notes">
              <span className="whitespace-pre-wrap">{brand.notes}</span>
            </Field>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-6 mb-4">
        <details className="flex-1 min-w-[18rem]">
          <summary className="text-sm text-blue-700 dark:text-blue-400 cursor-pointer select-none">Edit profile</summary>
          <ActionForm action={updateBrandProfile} className="mt-2 grid grid-cols-4 gap-3 items-end border border-gray-200 dark:border-neutral-800 rounded-lg p-3">
            <input type="hidden" name="brand_id" value={brand.id} />
            <input type="hidden" name="entity_id" value={entityId} />
            <label className={`${lbl} col-span-2`}>
              Category
              <Select name="category" list={catChoices} value={brand.category} />
            </label>
            <label className={`${lbl} col-span-2`}>
              Category detail (as given)
              <input name="category_detail" defaultValue={brand.category_detail ?? ""} className={`${input} w-full`} />
            </label>
            <label className={lbl}>
              Size min (SF)
              <input name="size_min_sf" type="number" defaultValue={brand.size_min_sf ?? ""} className={`${input} w-full`} />
            </label>
            <label className={lbl}>
              Size max (SF)
              <input name="size_max_sf" type="number" defaultValue={brand.size_max_sf ?? ""} className={`${input} w-full`} />
            </label>
            <label className={lbl}>
              Frontage min (ft)
              <input name="frontage_min_ft" type="number" defaultValue={brand.frontage_min_ft ?? ""} className={`${input} w-full`} />
            </label>
            <label className={lbl}>
              Drive-thru
              <Select name="drive_thru" list={DRIVE_THRU} value={brand.drive_thru} />
            </label>
            <label className={lbl}>
              Operating model
              <Select name="operating_model" list={OPERATING_MODELS} value={brand.operating_model} />
            </label>
            <label className={lbl}>
              Expansion
              <Select name="expansion_status" list={EXPANSION_STATUSES} value={brand.expansion_status} blank={null} />
            </label>
            <fieldset className={`${lbl} col-span-4`}>
              <legend>Facility types</legend>
              <Checks name="facility_types" list={FACILITY_TYPES} checked={brand.facility_types} />
            </fieldset>
            <fieldset className={`${lbl} col-span-4`}>
              <legend>Target markets</legend>
              <Checks name="target_markets" list={TARGET_MARKETS} checked={brand.target_markets} />
            </fieldset>
            <label className={`${lbl} col-span-4`}>
              Site criteria (demographics, co-tenancy, corner, parking)
              <textarea name="site_criteria" rows={2} defaultValue={brand.site_criteria ?? ""} className={`${input} w-full`} />
            </label>
            <label className={`${lbl} col-span-4`}>
              Notes
              <textarea name="notes" rows={2} defaultValue={brand.notes ?? ""} className={`${input} w-full`} />
            </label>
            <div className="col-span-4">
              <button type="submit" className="bg-blue-600 text-white rounded px-3 py-1 text-sm">
                Save profile
              </button>
            </div>
          </ActionForm>
        </details>

        <ActionForm action={markBrandVerified} className="flex items-end gap-2">
          <input type="hidden" name="brand_id" value={brand.id} />
          <input type="hidden" name="entity_id" value={entityId} />
          <label className={lbl}>
            Verification note (optional)
            <input name="verification_note" placeholder="e.g. confirmed with RE director" className={`${input} w-64 block`} />
          </label>
          <button type="submit" className="border border-gray-300 dark:border-neutral-700 rounded px-3 py-1 text-sm hover:bg-gray-50 dark:hover:bg-neutral-800">
            Mark verified
          </button>
        </ActionForm>
      </div>

      <h3 className="text-sm font-semibold mb-1">Brand contacts</h3>
      {people.length === 0 ? (
        <Empty>
          No one linked yet. Usual roles: {BRAND_CONTACT_ROLES.join(", ")}.
        </Empty>
      ) : (
        <ul className="text-sm space-y-1 mb-4">
          {[...current, ...former].map((p) => (
            <li key={p.link_id ?? p.contact.id} className={p.is_current ? "" : "text-gray-400"}>
              <Link href={contactHref(p.contact.id)} className="text-blue-600 dark:text-blue-400 underline">
                {personName(p.contact)}
              </Link>
              <span className={p.is_current ? "text-gray-500 dark:text-gray-400" : ""}>
                {p.role ? <> · {p.role}</> : p.contact.title ? <> · {p.contact.title}</> : null}
                {p.is_current ? " · current" : " · former"}
                {(p.started_on || p.ended_on) && (
                  <> · {p.started_on ?? "?"} → {p.ended_on ?? (p.is_current ? "now" : "?")}</>
                )}
              </span>
              {p.link_id && (
                <form action={setAffiliationCurrent} className="inline ml-2">
                  <input type="hidden" name="id" value={p.link_id} />
                  <input type="hidden" name="entity_id" value={entityId} />
                  <input type="hidden" name="is_current" value={p.is_current ? "false" : "true"} />
                  <button className="text-xs text-blue-700 dark:text-blue-400 underline">
                    {p.is_current ? "Mark former" : "Mark current"}
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}

      <h3 className="text-sm font-semibold mb-1 mt-3">Active requirements</h3>
      {requirements.length === 0 ? (
        <Empty>No active requirements linked to this brand.</Empty>
      ) : (
        <ul className="text-sm space-y-1">
          {requirements.map((r) => (
            <li key={r.id}>
              <Link href={requirementHref(r.id)} className="text-blue-600 dark:text-blue-400 underline">
                {r.display_code ?? "Requirement"}
              </Link>
              <span className="text-gray-500 dark:text-gray-400">
                {r.deal_type && <> · {r.deal_type}</>}
                {(r.size_min != null || r.size_max != null) && <> · {sizeRange(r.size_min, r.size_max)}</>}
                {(r.target_markets ?? []).length > 0 && (
                  <> · {(r.target_markets ?? []).map((m) => choiceLabel(TARGET_MARKETS, m, true)).join(", ")}</>
                )}
                {r.confidence && <> · {choiceLabel(CONFIDENCE, r.confidence)} confidence</>}
              </span>
              {" · re-confirm "}
              <span className={dueClass(r.reconfirm_date)}>{r.reconfirm_date ?? "not set"}</span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
