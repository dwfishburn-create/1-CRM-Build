"use server";

import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";

export type SaveTerritoryInput = {
  id?: string;
  name: string;
  geojson: { type: "Polygon"; coordinates: [number, number][][] };
  project_id?: string | null;
  notes?: string | null;
};

// Save (or update) a drawn polygon as a reusable "research zone" /
// "campaign territory" — see the 8/20/2026 Polygon property search
// decision. Only the shape + name/notes/project tie are stored; which
// properties fall inside it is always recomputed live on load (see the
// 8/26/2026 refinement — results must reflect current research
// status/ownership, not a stale snapshot).
export async function saveTerritory(input: SaveTerritoryInput) {
  const name = input.name.trim();
  if (!name) throw new Error("Name is required.");

  const ring = input.geojson?.coordinates?.[0];
  if (!ring || ring.length < 3) {
    throw new Error("Draw a polygon before saving.");
  }

  const payload = {
    name,
    geojson: input.geojson,
    project_id: input.project_id || null,
    notes: input.notes?.trim() || null,
    updated_at: new Date().toISOString(),
  };

  const { error } = input.id
    ? await supabase.from("saved_polygons").update(payload).eq("id", input.id)
    : await supabase.from("saved_polygons").insert(payload);

  if (error) throw new Error(error.message);

  revalidatePath("/map");
}

export async function deleteTerritory(id: string) {
  if (!id) throw new Error("id is required.");

  const { error } = await supabase.from("saved_polygons").delete().eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath("/map");
}
