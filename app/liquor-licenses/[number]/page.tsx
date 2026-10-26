import Link from "next/link";
import { notFound } from "next/navigation";
import { contactHref, entityHref, propertyHref } from "@/lib/records";
import { CHANGE_TYPES, fmtPhone, getLicense, LiquorError, saleTypeLabel } from "@/lib/liquorLicenses";
import { Field, Section, Empty } from "../../_components/RecordParts";
import { ActionForm } from "../../_components/ActionForm";
import {
  clearLinkAction,
  linkLicenseAction,
  promoteLicenseeAction,
  promoteManagerAction,
} from "../actions";

export const dynamic = "force-dynamic";

// One liquor license: the roster fields, its links into the CRM, what each
// roster pull changed, and the one-at-a-time promote buttons ("promote when
// touched", 10/26/2026).

const control =
  "border border-gray-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 rounded px-2 py-1.5 text-sm";
const link = "text-blue-600 dark:text-blue-400 hover:underline";
const btn = "bg-blue-600 text-white rounded px-3 py-1.5 text-sm";
const btnQuiet = "border border-gray-300 dark:border-neutral-700 rounded px-2 py-1 text-xs";

type Rec = { id: string; display_code: string | null; name?: string; trade_name?: string | null; address?: string; city?: string | null;
  first_name?: string | null; last_name?: string | null; email?: string | null; phone?: string | null };

export default async function LiquorLicensePage(props: PageProps<"/liquor-licenses/[number]">) {
  const { number } = await props.params;
  let data: Awaited<ReturnType<typeof getLicense>>;
  try {
    data = await getLicense(decodeURIComponent(number));
  } catch (e) {
    if (e instanceof LiquorError && e.status === 404) notFound();
    throw e;
  }
  const l = data.license as unknown as Record<string, unknown> & {
    license_number: string; brand: Rec | null; licensee_entity: Rec | null; property: Rec | null; contact: Rec | null;
  };
  const s = (k: string) => (l[k] == null || l[k] === "" ? null : String(l[k]));
  const label = Object.fromEntries(CHANGE_TYPES.map((c) => [c.value, c.label]));
  const source = (k: string) => (s(k) === "dan" ? "set by Dan" : s(k) === "auto" ? "exact match" : "");

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <Link href="/liquor-licenses" className={`text-sm ${link}`}>← Liquor Licenses</Link>
      <h1 className="text-2xl font-semibold mt-2">{s("trade_name") ?? l.license_number}</h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
        NLCC license {l.license_number} · class {s("class")} ({saleTypeLabel(s("sale_type"), false)})
        {(l.secondary_licenses as string[])?.length ? ` · secondary ${(l.secondary_licenses as string[]).join(", ")}` : ""}
        {" · "}
        {s("status") === "active" ? (
          <>on the roster of {s("last_seen_on")}</>
        ) : (
          <span className="text-amber-700 dark:text-amber-400">dropped from the roster of {s("dropped_on")}</span>
        )}
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <Field label="Premises">
          {s("premises_street")}
          <br />
          {[s("premises_city"), s("premises_state"), s("premises_zip")].filter(Boolean).join(" ")} · {s("county")} County
          {s("corporate_limits") && <span className="text-xs text-gray-500"> ({s("corporate_limits")} city limits)</span>}
        </Field>
        <Field label="Licensee">
          {s("licensee")}
          <div className="text-xs text-gray-500">{s("corporate_address")}</div>
        </Field>
        <Field label="Manager">{s("manager_name") ?? "—"}</Field>
        <Field label="Phone">{fmtPhone(s("phone")) || "—"}</Field>
        <Field label="Email">{s("email") ? <a className={link} href={`mailto:${s("email")}`}>{s("email")}</a> : "—"}</Field>
        <Field label="Issued / expires">
          {s("issue_date") ?? "—"} / {s("expiration_date") ?? "—"}
        </Field>
        <Field label="Premises description">{s("legal_description") ?? "—"}</Field>
        {s("restrictions") && <Field label="Restrictions">{s("restrictions")}</Field>}
        <Field label="On the roster">
          first {s("first_seen_on")} · last {s("last_seen_on")}
        </Field>
      </div>

      <Section title="Links into the CRM">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          <LinkRow title="Directory brand" rec={l.brand} href={entityHref} which="brand" licenseNumber={l.license_number} source={source("brand_link_source")} />
          <LinkRow title="Licensee company" rec={l.licensee_entity} href={entityHref} which="licensee" licenseNumber={l.license_number} source={source("licensee_link_source")} />
          <LinkRow title="Property" rec={l.property} href={propertyHref} which="property" licenseNumber={l.license_number} source={source("property_link_source")} />
          <LinkRow title="Contact (manager)" rec={l.contact} href={contactHref} which="contact" licenseNumber={l.license_number} source="" />
        </div>

        <ActionForm action={linkLicenseAction} className="grid grid-cols-1 sm:grid-cols-5 gap-3 items-end mb-4">
          <input type="hidden" name="license_number" value={l.license_number} />
          <label className="text-xs text-gray-600">
            Directory brand
            <input name="brand" placeholder="ENT-####" className={`${control} block w-full`} />
          </label>
          <label className="text-xs text-gray-600">
            Licensee company
            <input name="licensee" placeholder="ENT-####" className={`${control} block w-full`} />
          </label>
          <label className="text-xs text-gray-600">
            Property
            <input name="property" placeholder="PROP-####" className={`${control} block w-full`} />
          </label>
          <label className="text-xs text-gray-600">
            Contact
            <input name="contact" placeholder="CON-####" className={`${control} block w-full`} />
          </label>
          <button className={btn} type="submit">Link</button>
          <p className="col-span-full text-xs text-gray-500">
            A link you set here is yours and survives every roster import. The brand must be in the Tenant Directory; the
            licensee company is the operating LLC (a franchisee is not the brand).
          </p>
        </ActionForm>

        <div className="flex flex-wrap gap-6">
          {!l.licensee_entity && s("licensee") && (
            <ActionForm action={promoteLicenseeAction} className="flex flex-col gap-2 text-sm">
              <input type="hidden" name="license_number" value={l.license_number} />
              <label className="text-xs text-gray-600">
                Add the licensee as a company
                <input name="name" defaultValue={s("licensee") ?? ""} className={`${control} block w-80`} />
              </label>
              <button className={btn} type="submit">Add company</button>
            </ActionForm>
          )}
          {!l.contact && s("manager_name") && (
            <ActionForm action={promoteManagerAction} className="flex flex-col gap-2 text-sm">
              <input type="hidden" name="license_number" value={l.license_number} />
              <label className="text-xs text-gray-600">
                Add the manager as a contact (flagged unverified)
                <input name="manager" defaultValue={s("manager_name") ?? ""} className={`${control} block w-72`} />
              </label>
              <button className={btn} type="submit">Add contact</button>
            </ActionForm>
          )}
        </div>
      </Section>

      <Section title="Notes">
        <ActionForm action={linkLicenseAction} className="flex flex-col gap-2">
          <input type="hidden" name="license_number" value={l.license_number} />
          <textarea name="notes" defaultValue={s("notes") ?? ""} rows={3} className={`${control} w-full`} />
          <button className={`${btn} self-start`} type="submit">Save note</button>
          <p className="text-xs text-gray-500">Yours only — never shown in the RTD.</p>
        </ActionForm>
      </Section>

      <Section title="Roster history" count={data.changes.length}>
        {data.changes.length === 0 ? (
          <Empty>No changes recorded — this license has looked the same on every roster since it was first loaded.</Empty>
        ) : (
          <ul className="text-sm space-y-1">
            {(data.changes as unknown as {
              id: string; change_type: string; old_value: string | null; new_value: string | null;
              snapshot: { snapshot_date: string } | { snapshot_date: string }[] | null;
            }[]).map((c) => {
              const snap = Array.isArray(c.snapshot) ? c.snapshot[0] : c.snapshot;
              return (
                <li key={c.id}>
                  <span className="text-gray-500">{snap?.snapshot_date}</span> · {label[c.change_type] ?? c.change_type}
                  {c.change_type !== "new" && c.change_type !== "dropped" && (
                    <>
                      : {c.old_value ?? "—"} → {c.new_value ?? "—"}
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </div>
  );
}

function LinkRow({ title, rec, href, which, licenseNumber, source }: {
  title: string; rec: Rec | null; href: (id: string) => string; which: string; licenseNumber: string; source: string;
}) {
  return (
    <Field label={title}>
      {rec ? (
        <span className="flex flex-wrap items-center gap-2">
          <Link href={href(rec.id)} className={link}>
            {rec.display_code} — {rec.name ?? rec.address ?? [rec.first_name, rec.last_name].filter(Boolean).join(" ")}
          </Link>
          {source && <span className="text-xs text-gray-500">{source}</span>}
          <ActionForm action={clearLinkAction} className="inline">
            <input type="hidden" name="license_number" value={licenseNumber} />
            <input type="hidden" name="which" value={which} />
            <button className={btnQuiet} type="submit">Unlink</button>
          </ActionForm>
        </span>
      ) : (
        "—"
      )}
    </Field>
  );
}
