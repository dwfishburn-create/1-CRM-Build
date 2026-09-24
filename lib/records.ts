// Shared helpers for record detail pages (added 9/24/2026).
//
// Before this, the CRM had list screens only — nothing on the Dashboard could
// link anywhere, because there was no page for a contact, property or entity
// to open. The hrefs live in one place so a future route change is a one-line
// edit rather than a hunt through every screen that links to a record.

export function contactHref(id: string): string {
  return `/contacts/${id}`;
}

export function propertyHref(id: string): string {
  return `/properties/${id}`;
}

export function entityHref(id: string): string {
  return `/entities/${id}`;
}

export function projectHref(id: string): string {
  return `/projects/${id}`;
}

export function requirementHref(id: string): string {
  return `/requirements/${id}`;
}

// Supabase returns an embedded to-one relation as an object or a one-element
// array depending on how it infers the FK. Every screen already carried its own
// copy of this; new code uses this one.
export function one<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  return Array.isArray(v) ? v[0] ?? null : v;
}

export function personName(c: {
  first_name: string | null;
  last_name: string | null;
} | null): string {
  if (!c) return "";
  return [c.first_name, c.last_name].filter(Boolean).join(" ") || "Unnamed contact";
}

export function propertyLabel(p: {
  display_code?: string | null;
  address: string;
  suite_number?: string | null;
  city?: string | null;
}): string {
  let s = p.address;
  if (p.suite_number) s += ` #${p.suite_number}`;
  if (p.city) s += `, ${p.city}`;
  return s;
}

export function entityLabel(e: { name: string; trade_name?: string | null }): string {
  return e.trade_name ? `${e.name} (d/b/a ${e.trade_name})` : e.name;
}

export function money(n: number | null | undefined): string {
  if (n == null) return "—";
  return `$${Math.round(n).toLocaleString()}`;
}

export function psf(n: number | null | undefined): string {
  if (n == null) return "—";
  return `$${n.toFixed(2)}/SF`;
}

export function sf(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${Math.round(n).toLocaleString()} SF`;
}

export function day(d: string | null | undefined): string {
  if (!d) return "—";
  return d.slice(0, 10);
}

export function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export function dueClass(d: string | null | undefined): string {
  if (!d) return "";
  const t = todayStr();
  if (d < t) return "text-red-600 font-medium";
  if (d === t) return "text-amber-600 font-medium";
  return "";
}
