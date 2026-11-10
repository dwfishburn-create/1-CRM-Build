"use client";

import { useState, useTransition } from "react";
import { runImportChunk, rollbackImport, importStatus } from "./actions";

function addInto(totals: Record<string, number>, prefix: string, obj: unknown) {
  if (!obj || typeof obj !== "object") return;
  for (const [k, v] of Object.entries(obj as Record<string, number>)) {
    totals[`${prefix}.${k}`] = (totals[`${prefix}.${k}`] ?? 0) + Number(v || 0);
  }
}

async function runImport(mode: "pilot" | "full", progress: (s: string) => void) {
  const totals: Record<string, number> = {};
  let offset = 0;
  for (;;) {
    const r = await runImportChunk(mode, offset);
    if (!r.ok) return { ok: false, error: r.error, totals };
    const c = r.counts as Record<string, unknown>;
    addInto(totals, "properties", c.properties);
    addInto(totals, "owners", c.owners);
    addInto(totals, "owner_links", c.owner_links);
    progress(`Working… ${r.done} of ${r.total} rows`);
    if (r.done >= r.total) return { ok: true, mode, rows: r.total, totals };
    offset = r.done;
  }
}

export default function ImportClient({ initialStatus }: { initialStatus: unknown }) {
  const [status, setStatus] = useState<unknown>(initialStatus);
  const [output, setOutput] = useState<unknown>(null);
  const [pending, start] = useTransition();

  const run = (fn: () => Promise<unknown>) =>
    start(async () => {
      setOutput("Working…");
      try {
        setOutput(await fn());
      } catch (e) {
        setOutput({ ok: false, error: e instanceof Error ? e.message : String(e) });
      }
      setStatus(await importStatus());
    });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <button disabled={pending} onClick={() => run(() => runImport("pilot", setOutput))}
          className="bg-black text-white rounded px-3 py-1.5 text-sm disabled:opacity-40">
          Run pilot (50 rows)
        </button>
        <button disabled={pending} onClick={() => run(() => runImport("full", setOutput))}
          className="bg-blue-700 text-white rounded px-3 py-1.5 text-sm disabled:opacity-40">
          Run full load
        </button>
        <button disabled={pending} onClick={() => run(() => rollbackImport())}
          className="bg-red-700 text-white rounded px-3 py-1.5 text-sm disabled:opacity-40">
          Roll back this batch
        </button>
        <button disabled={pending} onClick={() => run(() => importStatus())}
          className="border rounded px-3 py-1.5 text-sm disabled:opacity-40">
          Refresh status
        </button>
      </div>
      <div>
        <div className="font-medium text-sm">Batch status</div>
        <pre id="import-status" className="text-xs bg-gray-100 text-gray-900 rounded p-3 overflow-x-auto">
          {JSON.stringify(status, null, 2)}
        </pre>
      </div>
      <div>
        <div className="font-medium text-sm">Last action</div>
        <pre id="import-output" className="text-xs bg-gray-100 text-gray-900 rounded p-3 overflow-x-auto max-h-96">
          {output == null ? "—" : typeof output === "string" ? output : JSON.stringify(output, null, 2)}
        </pre>
      </div>
    </div>
  );
}
