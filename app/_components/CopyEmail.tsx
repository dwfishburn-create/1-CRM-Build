"use client";

import { useEffect, useState } from "react";

// An email address with a small "Copy" button beside it (10/19/2026).
// The address itself stays a mailto: link where `link` is true; the button
// copies the bare address to the clipboard and shows "Copied" for 1.5s.
// Falls back to a hidden-textarea copy if the Clipboard API is unavailable.
export function CopyEmail({
  email,
  link = true,
  className = "",
}: {
  email: string;
  link?: boolean;
  className?: string;
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  useEffect(() => {
    if (state === "idle") return;
    const t = setTimeout(() => setState("idle"), 1500);
    return () => clearTimeout(t);
  }, [state]);

  async function copy() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(email);
      } else {
        const ta = document.createElement("textarea");
        ta.value = email;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(ta);
        if (!ok) throw new Error("copy failed");
      }
      setState("copied");
    } catch {
      setState("failed");
    }
  }

  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      {link ? (
        <a href={`mailto:${email}`} className="text-blue-600 underline break-all">
          {email}
        </a>
      ) : (
        <span className="break-all">{email}</span>
      )}
      <button
        type="button"
        onClick={copy}
        title={`Copy ${email}`}
        aria-label={`Copy email address ${email}`}
        className="shrink-0 text-xs border border-gray-300 rounded px-1.5 py-0.5 leading-tight hover:bg-gray-100 dark:hover:bg-gray-800"
      >
        {state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : "Copy"}
      </button>
    </span>
  );
}
