"use client";

import { useState } from "react";

// Activity type picker (10/5/2026). The old field was a text box with a
// <datalist>; once it held "Call", Chrome filtered the suggestions down to
// entries matching "Call", so the arrow showed nothing else and the list
// looked broken. A real <select> always shows every type. "Other…" opens a
// text box for a type not on the list, so activity_type stays free text.

export function TypePicker({ types, className }: { types: string[]; className?: string }) {
  const [choice, setChoice] = useState(types[0]);
  const other = choice === "__other";
  return (
    <>
      <select
        name={other ? undefined : "activity_type"}
        value={choice}
        onChange={(e) => setChoice(e.target.value)}
        className={className}
      >
        {types.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
        <option value="__other">Other…</option>
      </select>
      {other && (
        <input
          name="activity_type"
          required
          autoFocus
          placeholder="Type the activity type"
          className={`${className ?? ""} mt-1`}
        />
      )}
    </>
  );
}
