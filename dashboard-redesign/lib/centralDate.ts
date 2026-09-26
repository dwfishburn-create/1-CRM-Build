// Dates as Dan sees them: America/Chicago, as YYYY-MM-DD strings (9/26/2026).
// UTC's date rolls over at 7pm Central, which made "due today" wrong every
// evening; everything the Dashboard compares goes through here instead.

const TZ = "America/Chicago";

export function todayCentral(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(now);
}

function asUtcNoon(d: string): Date {
  return new Date(`${d}T12:00:00Z`);
}

export function addDays(d: string, days: number): string {
  const x = asUtcNoon(d);
  x.setUTCDate(x.getUTCDate() + days);
  return x.toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday */
export function dayOfWeek(d: string): number {
  return asUtcNoon(d).getUTCDay();
}

/** Whole days from a to b (b − a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((asUtcNoon(b).getTime() - asUtcNoon(a).getTime()) / 86_400_000);
}

/** The Monday that starts the week after the one containing d. */
export function nextMonday(d: string): string {
  const dow = dayOfWeek(d);
  return addDays(d, dow === 0 ? 1 : 8 - dow);
}

export function longDate(d: string): string {
  return asUtcNoon(d).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** "Mon 9/28" */
export function shortDay(d: string): string {
  const x = asUtcNoon(d);
  const wd = x.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
  return `${wd} ${x.getUTCMonth() + 1}/${x.getUTCDate()}`;
}

/** "9/28" */
export function monthDay(d: string): string {
  const x = asUtcNoon(d);
  return `${x.getUTCMonth() + 1}/${x.getUTCDate()}`;
}

export function monthName(d: string): string {
  return asUtcNoon(d).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}
