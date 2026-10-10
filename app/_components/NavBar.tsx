"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { GlobalSearch } from "./GlobalSearch";

// Top menu (10/5/2026). The old links were text-gray-600 with hover:text-black:
// dim on Dan's dark background, and black-on-black — invisible — on hover.
// Now: bright labels, a filled pill on hover, and the current section shown
// in blue so it's clear where you are. Works in light and dark mode.
//
// 10/10/2026: the global search box sits at the right end (ml-auto inside
// GlobalSearch). / or Ctrl+K focuses it from any page.

const LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/contacts", label: "Contacts" },
  { href: "/properties", label: "Properties" },
  { href: "/map", label: "Map" },
  { href: "/entities", label: "Entities" },
  { href: "/projects", label: "Projects" },
  { href: "/pipeline", label: "Pipeline" },
  { href: "/requirements", label: "Requirements" },
  { href: "/tasks", label: "Tasks" },
  { href: "/sale-comps", label: "Sale Comps" },
  { href: "/lease-comps", label: "Lease Comps" },
];

export function NavBar() {
  const path = usePathname() ?? "";
  return (
    <nav className="border-b border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 px-6 py-2.5 flex flex-wrap items-center gap-1">
      <Link
        href="/"
        className="mr-5 whitespace-nowrap text-[17px] font-semibold text-neutral-900 dark:text-white"
      >
        CRM - Dan Fishburn
      </Link>
      {LINKS.map((l) => {
        const active = path === l.href || path.startsWith(l.href + "/");
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={
              "whitespace-nowrap rounded-md px-3 py-1.5 text-[15px] transition-colors " +
              (active
                ? "bg-blue-600 text-white font-medium"
                : "text-neutral-700 hover:bg-neutral-100 hover:text-neutral-950 dark:text-neutral-100 dark:hover:bg-neutral-800 dark:hover:text-white")
            }
          >
            {l.label}
          </Link>
        );
      })}
      <GlobalSearch />
    </nav>
  );
}
