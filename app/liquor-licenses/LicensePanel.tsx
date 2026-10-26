import Link from "next/link";
import { fmtPhone, saleTypeLabel, searchLicenses } from "@/lib/liquorLicenses";
import { Section } from "../_components/RecordParts";

// "Liquor licenses" on a company or property page (10/26/2026, migration 032):
// the NLCC licenses linked to this record — as the directory brand, the
// licensee company, or the premises. Renders nothing when there are none, so
// most pages are unchanged.
export async function LicensePanel({ entityId, propertyId }: { entityId?: string; propertyId?: string }) {
  let r: Awaited<ReturnType<typeof searchLicenses>>;
  try {
    r = await searchLicenses({ entity_id: entityId, property_id: propertyId, status: "all", sort: "city", limit: 15 });
  } catch {
    return null;   // the panel must never break the page it sits on
  }
  if (r.count === 0) return null;
  const active = r.licenses.filter((l) => l.status === "active").length;
  return (
    <Section title="Liquor licenses" count={r.count}>
      <ul className="text-sm space-y-1">
        {r.licenses.map((l) => (
          <li key={l.id}>
            <Link href={`/liquor-licenses/${l.license_number}`} className="text-blue-600 underline">
              {l.trade_name}
            </Link>{" "}
            — {[l.premises_street, l.premises_city].filter(Boolean).join(", ")} · {saleTypeLabel(l.sale_type)} ({l.class})
            {l.status === "dropped" && <span className="text-amber-700"> · dropped {l.dropped_on}</span>}
            <span className="text-gray-500">
              {" "}
              · {[l.manager_name, fmtPhone(l.phone), l.email].filter(Boolean).join(" · ")}
            </span>
          </li>
        ))}
      </ul>
      {r.count > r.licenses.length && (
        <p className="text-xs text-gray-500 mt-1">
          Showing {r.licenses.length} of {r.count} ({active} active shown).{" "}
          <span>Ask Claude for the full list, or search the Liquor Licenses page.</span>
        </p>
      )}
    </Section>
  );
}
