"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { SearchHit, SearchResults } from "@/lib/globalSearch";
import { searchAction } from "./searchActions";

// Global search box in the top menu (10/10/2026).
//
//   /  or  Ctrl+K (Cmd+K on a Mac)   focus the box from any page
//   type                             results drop down, grouped by type
//   ↑ ↓                              move through results
//   Enter                            open the highlighted result, or the
//                                    full results page if none is highlighted
//   Esc                              close
//
// Matching happens server-side through the 017 matcher; this component only
// debounces, drops out-of-order responses and handles the keyboard.

const MIN = 2;
const DEBOUNCE_MS = 200;

export function GlobalSearch() {
  const router = useRouter();
  const pathname = usePathname();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const reqSeq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [q, setQ] = useState("");
  // The panel is open only on the page where it was opened, so navigating
  // anywhere closes it without an effect.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn !== null && openOn === pathname;
  const setOpen = useCallback(
    (v: boolean) => setOpenOn(v ? pathname : null),
    [pathname]
  );
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<SearchResults | null>(null);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState(-1);

  const flat: SearchHit[] = useMemo(
    () => (results ? results.groups.flatMap((g) => g.hits) : []),
    [results]
  );

  // "/" and Ctrl/Cmd+K focus the box from anywhere — except "/" while typing
  // in another field, where it is just a slash.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing =
        !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
      if ((e.key === "k" || e.key === "K") && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      } else if (e.key === "/" && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Close on a click outside.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [setOpen]);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  // Debounced search, run from the input's change handler. Each request
  // carries a sequence number so a slow early response can never overwrite a
  // later one.
  const runSearch = (value: string) => {
    if (timer.current) clearTimeout(timer.current);
    const term = value.trim();
    const seq = ++reqSeq.current;
    if (term.length < MIN) {
      setResults(null);
      setLoading(false);
      setFailed(false);
      return;
    }
    setLoading(true);
    timer.current = setTimeout(async () => {
      try {
        const r = await searchAction(term);
        if (seq !== reqSeq.current) return;
        setResults(r);
        setFailed(false);
        setActive(-1);
      } catch {
        if (seq !== reqSeq.current) return;
        setFailed(true);
        setResults(null);
      } finally {
        if (seq === reqSeq.current) setLoading(false);
      }
    }, DEBOUNCE_MS);
  };

  const goFull = useCallback(() => {
    const term = q.trim();
    if (term.length < MIN) return;
    setOpen(false);
    inputRef.current?.blur();
    router.push(`/search?q=${encodeURIComponent(term)}`);
  }, [q, router, setOpen]);

  const goHit = useCallback(
    (h: SearchHit) => {
      setOpen(false);
      setActive(-1);
      inputRef.current?.blur();
      router.push(h.href);
    },
    [router, setOpen]
  );

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (flat.length === 0 ? -1 : (i + 1) % flat.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (flat.length === 0 ? -1 : i <= 0 ? flat.length - 1 : i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (active >= 0 && flat[active]) goHit(flat[active]);
      else goFull();
    }
  };

  const term = q.trim();
  const showPanel = open && term.length >= MIN;
  let idx = -1;

  return (
    <div ref={boxRef} className="relative ml-auto">
      <div className="relative">
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500 dark:text-neutral-400"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <circle cx="8.5" cy="8.5" r="5.5" />
          <path d="M13 13l4 4" strokeLinecap="round" />
        </svg>
        <input
          ref={inputRef}
          type="search"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
            runSearch(e.target.value);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search"
          aria-label="Search contacts, companies, properties, deals and requirements"
          role="combobox"
          aria-expanded={showPanel}
          aria-controls={listId}
          aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
          autoComplete="off"
          spellCheck={false}
          className="w-56 focus:w-80 transition-[width] rounded-md border border-neutral-300 bg-white py-1.5 pl-8 pr-10 text-[15px] text-neutral-900 placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:placeholder:text-neutral-400"
        />
        <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-neutral-300 px-1.5 text-[11px] leading-5 text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
          /
        </kbd>
      </div>

      {showPanel && (
        <div
          id={listId}
          role="listbox"
          className="absolute right-0 z-50 mt-1.5 max-h-[70vh] w-[30rem] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-lg border border-neutral-200 bg-white py-1 shadow-xl dark:border-neutral-700 dark:bg-neutral-900"
        >
          {failed && (
            <p className="px-3 py-2 text-sm text-red-600 dark:text-red-400">
              Search didn&apos;t respond. Try again in a moment.
            </p>
          )}
          {!failed && loading && !results && (
            <p className="px-3 py-2 text-sm text-neutral-500 dark:text-neutral-400">Searching…</p>
          )}
          {!failed && results && results.groups.length === 0 && !loading && (
            <p className="px-3 py-2 text-sm text-neutral-500 dark:text-neutral-400">
              Nothing matches &ldquo;{term}&rdquo;.
            </p>
          )}
          {results?.groups.map((g) => (
            <div key={g.kind} className="py-1">
              <div className="flex items-baseline justify-between px-3 pb-0.5 pt-1">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                  {g.label}
                </span>
                {g.total > g.hits.length && (
                  <span className="text-[11px] text-neutral-500 dark:text-neutral-400">
                    {g.hits.length} of {g.total}
                  </span>
                )}
              </div>
              {g.hits.map((h) => {
                idx++;
                const i = idx;
                const on = i === active;
                return (
                  <button
                    key={h.kind + h.id}
                    id={`${listId}-${i}`}
                    type="button"
                    role="option"
                    aria-selected={on}
                    onMouseEnter={() => setActive(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => goHit(h)}
                    className={
                      "block w-full px-3 py-1.5 text-left " +
                      (on ? "bg-blue-600 text-white" : "text-neutral-900 dark:text-neutral-100")
                    }
                  >
                    <span className="block truncate text-[14px]">
                      {h.title}
                      {h.code && (
                        <span className={"ml-2 text-[12px] " + (on ? "text-blue-100" : "text-neutral-500 dark:text-neutral-400")}>
                          {h.code}
                        </span>
                      )}
                    </span>
                    {h.context && (
                      <span className={"block truncate text-[12px] " + (on ? "text-blue-100" : "text-neutral-500 dark:text-neutral-400")}>
                        {h.context}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
          {results && results.errors.length > 0 && (
            <p className="px-3 py-1.5 text-[12px] text-amber-700 dark:text-amber-400">
              Some results couldn&apos;t load: {results.errors.join("; ")}
            </p>
          )}
          {results && results.groups.length > 0 && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={goFull}
              className="mt-1 block w-full border-t border-neutral-200 px-3 py-2 text-left text-[13px] text-blue-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-blue-400 dark:hover:bg-neutral-800"
            >
              All results for &ldquo;{term}&rdquo; →<span className="ml-2 text-neutral-500 dark:text-neutral-400">Enter</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
