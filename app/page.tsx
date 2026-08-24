import Link from "next/link";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

async function getCounts() {
  const [contacts, properties, entities, projects, saleComps, leaseComps] =
    await Promise.all([
      supabase.from("contacts").select("id", { count: "exact", head: true }),
      supabase
        .from("properties")
        .select("id", { count: "exact", head: true }),
      supabase.from("entities").select("id", { count: "exact", head: true }),
      supabase.from("projects").select("id", { count: "exact", head: true }),
      supabase
        .from("sale_comps")
        .select("id", { count: "exact", head: true }),
      supabase
        .from("lease_comps")
        .select("id", { count: "exact", head: true }),
    ]);

  return {
    contacts: contacts.count ?? 0,
    properties: properties.count ?? 0,
    entities: entities.count ?? 0,
    projects: projects.count ?? 0,
    saleComps: saleComps.count ?? 0,
    leaseComps: leaseComps.count ?? 0,
  };
}

export default async function Home() {
  const counts = await getCounts();

  const liveCards = [
    { label: "Contacts", href: "/contacts", count: counts.contacts },
    { label: "Properties", href: "/properties", count: counts.properties },
    { label: "Entities", href: "/entities", count: counts.entities },
    { label: "Projects", href: "/projects", count: counts.projects },
  ];

  const comingSoon = [
    { label: "Sale Comps", count: counts.saleComps },
    { label: "Lease Comps", count: counts.leaseComps },
  ];

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h1 className="text-2xl font-semibold mb-1">Dan Fishburn CRM</h1>
      <p className="text-gray-500 mb-8">
        Omaha metro · statewide Nebraska · Council Bluffs / Iowa
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        {liveCards.map((c) => (
          <Link
            key={c.href}
            href={c.href}
            className="border border-gray-200 rounded-lg p-4 hover:border-gray-400 transition"
          >
            <div className="text-3xl font-semibold">{c.count}</div>
            <div className="text-gray-500">{c.label}</div>
          </Link>
        ))}
        {comingSoon.map((c) => (
          <div
            key={c.label}
            className="border border-dashed border-gray-200 rounded-lg p-4 text-gray-400"
          >
            <div className="text-3xl font-semibold">{c.count}</div>
            <div>{c.label}</div>
            <div className="text-xs mt-1">coming soon</div>
          </div>
        ))}
      </div>

      <p className="text-sm text-gray-400">
        Next up per the build plan: Sale/Lease Comps, then the Opportunity
        Engine and map features.
      </p>
    </div>
  );
}
