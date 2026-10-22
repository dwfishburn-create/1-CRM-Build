"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Fits this space" },
  { href: "/searches", label: "Saved searches" },
  { href: "/brands", label: "All brands" },
  { href: "/requirements", label: "Requirements" },
  { href: "/intel", label: "Quick note" },
  { href: "/new", label: "What's new" },
  { href: "/add-brand", label: "Add a brand" },
];

export function NavLinks({ isAdmin, reviewCount }: { isAdmin: boolean; reviewCount: number }) {
  const path = usePathname() ?? "/";
  // Dan's private step: copying the team's updates into his CRM.
  const links = isAdmin ? [...LINKS, { href: "/review", label: "Sync to CRM" }] : LINKS;
  return (
    <div className="navlinks">
      {links.map((l) => {
        const active = l.href === "/" ? path === "/" : path === l.href || path.startsWith(l.href + "/");
        return (
          <Link key={l.href} href={l.href} aria-current={active ? "page" : undefined}>
            {l.label}
            {l.href === "/review" && reviewCount > 0 && <span className="badge">{reviewCount}</span>}
          </Link>
        );
      })}
    </div>
  );
}
