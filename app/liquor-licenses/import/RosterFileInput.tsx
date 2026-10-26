"use client";

import { useRef } from "react";

// Picks the roster file and fills the roster date from its NLCC file name
// ("Liquor Active Roster 06062024 …" → 2024-06-06) so the date is rarely typed.
export function RosterFileInput({ control }: { control: string }) {
  const dateRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <label className="text-xs text-gray-600 dark:text-gray-400">
        NLCC roster (.xlsx)
        <input
          type="file"
          name="file"
          accept=".xlsx"
          required
          className={`${control} block w-96`}
          onChange={(e) => {
            const name = e.currentTarget.files?.[0]?.name ?? "";
            const m = name.match(/(?:^|[^0-9])(\d{2})(\d{2})(\d{4})(?:[^0-9]|$)/);
            if (m && dateRef.current && !dateRef.current.value) dateRef.current.value = `${m[3]}-${m[1]}-${m[2]}`;
          }}
        />
      </label>
      <label className="text-xs text-gray-600 dark:text-gray-400">
        Roster date
        <input ref={dateRef} type="date" name="snapshot_date" required className={`${control} block`} />
      </label>
    </>
  );
}
