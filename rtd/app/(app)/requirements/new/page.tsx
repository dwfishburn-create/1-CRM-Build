import Link from "next/link";
import { db } from "@/lib/supabase";
import { ActionForm } from "@/app/_components/ActionForm";
import { addRequirement } from "@/app/actions";
import { RequirementFields } from "../RequirementFields";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Add a requirement of any kind — retail, office, industrial, land,
// investment… For a directory brand (?brand=<id>, from its page) or for any
// company typed in by name.
export default async function NewRequirement({ searchParams }: PageProps<"/requirements/new">) {
  const sp = await searchParams;
  const brandId = typeof sp.brand === "string" && UUID.test(sp.brand) ? sp.brand : null;
  let brand: { entity_id: string; name: string } | null = null;
  if (brandId) {
    const supabase = await db();
    const { data } = await supabase.rpc("rtd_brand", { p_entity_id: brandId });
    brand = (data as { entity_id: string; name: string } | null) ?? null;
  }

  return (
    <>
      <Link href={brand ? `/brands/${brand.entity_id}` : "/requirements"} className="backlink">
        ← {brand ? brand.name : "Requirements"}
      </Link>
      <header className="stack" style={{ gap: 6 }}>
        <div className="eyebrow">Heard about a need?</div>
        <h1>Add a requirement</h1>
        <p className="muted">Jami, Trey and Dan see it on Requirements as soon as you save.</p>
      </header>
      <div className="card">
        <ActionForm action={addRequirement} submitLabel="Save" className="aform grid2">
          {brand ? (
            <>
              <input type="hidden" name="entity_id" value={brand.entity_id} />
              <div className="field span2">For<b className="forname">{brand.name}</b></div>
            </>
          ) : (
            <label className="field span2">For (company or person)
              <input name="party_name" required placeholder="Midwest Cold Storage, a 1031 buyer, a dentist…" />
              <span className="muted small">For a retail brand in the directory, add it from the brand&apos;s page instead so it links up.</span>
            </label>
          )}
          <RequirementFields />
        </ActionForm>
      </div>
    </>
  );
}
