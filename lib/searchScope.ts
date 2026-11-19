// Search-box scope (11/19/2026). Client-safe: no server imports, so the
// top-menu box can read it. lib/globalSearch is server-only.

export type SearchScopeKind = "contact" | "entity" | "property" | "project" | "requirement";

// Which record type a page's search box is scoped to by default. A page not
// listed here (Dashboard, Map, Pipeline…) searches everything. `label`
// matches the top-menu name, not GROUP_LABELS ("Deals" vs "Projects").
export const PAGE_SCOPES: { prefix: string; kind: SearchScopeKind; label: string }[] = [
  { prefix: "/projects", kind: "project", label: "Projects" },
  { prefix: "/contacts", kind: "contact", label: "Contacts" },
  { prefix: "/entities", kind: "entity", label: "Entities" },
  { prefix: "/properties", kind: "property", label: "Properties" },
  { prefix: "/requirements", kind: "requirement", label: "Requirements" },
];

export function scopeForPath(pathname: string | null | undefined) {
  if (!pathname) return null;
  return (
    PAGE_SCOPES.find((s) => pathname === s.prefix || pathname.startsWith(s.prefix + "/")) ?? null
  );
}

export function scopeForKind(kind: string | null | undefined) {
  return PAGE_SCOPES.find((s) => s.kind === kind) ?? null;
}
