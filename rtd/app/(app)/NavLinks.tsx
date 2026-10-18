"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Fits this space" },
  { href: "/brands", label: "All brands" },
];

export function NavLinks() {
  const path = usePathname() ?? "/";
  return (
    <div className="navlinks">
      {LINKS.map((l) => {
        const active = l.href === "/" ? path === "/" : path === l.href || path.startsWith(l.href + "/");
        return (
          <Link key={l.href} href={l.href} aria-current={active ? "page" : undefined}>
            {l.label}
          </Link>
        );
      })}
    </div>
  );
}
