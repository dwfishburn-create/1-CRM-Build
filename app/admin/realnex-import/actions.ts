"use server";

import { supabase } from "@/lib/supabase";
import rows from "@/data/realnex_properties_2026-09-18.json";
import { REALNEX_PROPERTY_BATCH as BATCH_ID } from "@/lib/realnexImport";

// Phase 2 of the Retail Listing Intake & Matching design (11/10/2026): RealNex
// properties + owners onto the map, ahead of the full RealNex import. The SQL
// (matching, inserts, rollback) lives in db/034_realnex_property_import.sql;
// this file only feeds it the export in chunks and reports the counts.

const CHUNK = 100; // 400 hit Supabase's statement timeout once the tables passed ~1,500 rows (11/10)
const PILOT_ROWS = 50;

type Counts = Record<string, Record<string, number> | number>;

// One chunk per call so no single request comes near Vercel's 60s limit
// (a 400-row chunk took ~3.5s against a test copy of the schema).
export async function runImportChunk(
  mode: "pilot" | "full",
  offset: number
): Promise<{ ok: true; counts: Counts; done: number; total: number } | { ok: false; error: string }> {
  const all = rows as unknown[];
  const slice = mode === "pilot" ? all.slice(0, PILOT_ROWS) : all;
  const part = slice.slice(offset, offset + CHUNK);
  if (!part.length) return { ok: true, counts: {}, done: slice.length, total: slice.length };
  const { data, error } = await supabase.rpc("import_realnex_properties", {
    p_rows: part,
    p_batch: BATCH_ID,
  });
  if (error) return { ok: false, error: `Rows ${offset + 1}-${offset + part.length}: ${error.message}` };
  return { ok: true, counts: data as Counts, done: offset + part.length, total: slice.length };
}

export async function rollbackImport(): Promise<{ ok: boolean; result?: unknown; error?: string }> {
  const { data, error } = await supabase.rpc("rollback_realnex_property_import", { p_batch: BATCH_ID });
  if (error) return { ok: false, error: error.message };
  return { ok: true, result: data };
}

export async function importStatus(): Promise<{ ok: boolean; result?: unknown; error?: string }> {
  const { data, error } = await supabase.rpc("realnex_property_import_status", { p_batch: BATCH_ID });
  if (error) return { ok: false, error: error.message };
  return { ok: true, result: data };
}
