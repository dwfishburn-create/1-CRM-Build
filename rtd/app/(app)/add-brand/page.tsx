import { EXPANSION, FACILITY, MARKETS } from "@/lib/search";
import { categoryMap, DRIVE_THRU } from "@/lib/rtd";
import { ActionForm } from "@/app/_components/ActionForm";
import { addBrand } from "@/app/actions";

export default async function AddBrand({ searchParams }: PageProps<"/add-brand">) {
  const sp = await searchParams;
  const name = typeof sp.name === "string" ? sp.name : "";
  const cats = await categoryMap();

  return (
    <>
      <header className="stack" style={{ gap: 6 }}>
        <div className="eyebrow">Not in the directory yet?</div>
        <h1>Add a brand</h1>
        <p className="muted">Only the name is required — add what you know. Everyone sees it in the directory as soon as you save.</p>
      </header>

      <div className="card">
        <ActionForm action={addBrand} submitLabel="Save" className="aform grid2">
          <label className="field span2">Brand name<input name="name" required defaultValue={name} placeholder="Scooter's Coffee" /></label>
          <label className="field">Category
            <select name="category" defaultValue="">
              <option value="">Not sure</option>
              {[...cats.entries()].map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label className="field">Expansion
            <select name="expansion_status" defaultValue="unknown">
              {Object.entries(EXPANSION).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label className="field">Size min (SF)<input name="size_min_sf" inputMode="numeric" /></label>
          <label className="field">Size max (SF)<input name="size_max_sf" inputMode="numeric" /></label>
          <label className="field">Drive-thru
            <select name="drive_thru" defaultValue="">
              <option value="">Not sure</option>
              {Object.entries(DRIVE_THRU).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label className="field">Website<input name="website" placeholder="scooterscoffee.com" /></label>
          <fieldset className="field span2 boxes">
            <legend>Target markets</legend>
            <input type="hidden" name="target_markets__present" value="1" />
            {MARKETS.map((m) => (
              <label key={m.code} className="check"><input type="checkbox" name="target_markets" value={m.code} /> {m.label}</label>
            ))}
          </fieldset>
          <fieldset className="field span2 boxes">
            <legend>Facility types</legend>
            <input type="hidden" name="facility_types__present" value="1" />
            {Object.entries(FACILITY).map(([k, v]) => (
              <label key={k} className="check"><input type="checkbox" name="facility_types" value={k} /> {v}</label>
            ))}
          </fieldset>
          <label className="field span2">Site criteria<textarea name="site_criteria" rows={3} /></label>
        </ActionForm>
      </div>
      
    </>
  );
}
