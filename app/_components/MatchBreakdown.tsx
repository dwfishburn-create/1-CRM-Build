import type { Criterion } from "@/lib/requirementMatchCore";

// The met / missed / unknown lines behind a match score (Phase 4, 11/14/2026).
// Unknown = the listing doesn't state it — not a miss (Dan, 11/10).

export function MatchScore({ pct, strong, paused }: { pct: number | null; strong: boolean; paused: boolean }) {
  const cls = paused
    ? "bg-gray-100 text-gray-500 dark:bg-gray-800"
    : strong
      ? "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300"
      : "bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300";
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${cls}`}>
      {pct === null ? "—" : `${pct}%`}
      {paused ? " · paused" : strong ? " · strong" : ""}
    </span>
  );
}

export function MatchBreakdown({ met, missed, unknown }: { met: Criterion[]; missed: Criterion[]; unknown: Criterion[] }) {
  return (
    <ul className="text-xs leading-5">
      {met.map((c) => (
        <li key={`m-${c.key}`} className="text-green-700 dark:text-green-400">✓ {c.label}: {c.detail}</li>
      ))}
      {missed.map((c) => (
        <li key={`x-${c.key}`} className="text-red-700 dark:text-red-400">✗ {c.label}: {c.detail}</li>
      ))}
      {unknown.map((c) => (
        <li key={`u-${c.key}`} className="text-gray-500">? {c.label}: {c.detail}</li>
      ))}
    </ul>
  );
}
