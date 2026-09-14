// Normalizes HTML character entities in agent-supplied text before it is
// written to the CRM.
//
// Why this exists: every write that originates in a Claude session goes
// through the MCP route (app/api/[transport]/route.ts) -> lib/agentApiClient.ts
// -> /api/agent/*. Models intermittently emit HTML-escaped text instead of
// literal characters, so a notes field arrives holding the five characters
// "&amp;" where it should hold a single "&". The row then renders wrong in
// the UI and — the part that actually bites — stops matching a plain-text
// search: a contact stored as "Cushman &amp; Wakefield" is invisible to
// anyone searching "Cushman & Wakefield".
//
// Found 9/14/2026 during the BR-Hy-Vee 108th & Hwy 370 import. That cleanup
// also turned up rows written in earlier, unrelated sessions carrying the
// same artifact (CON-0013, CON-0014, CON-0015, CON-0017, CON-0054,
// ENT-0048), which is what makes this worth a guard at the write path
// instead of a manual sweep each time it recurs.
// See CRM_Requirements_and_Decisions_Log.md, 9/14/2026.
//
// Scope note: this deliberately does NOT touch app/*/actions.ts (the UI
// server actions). A human typing into a form means exactly what they
// typed; this is a guard on machine-generated input only.

// The only entities decoded. Anything outside this set is left alone, so a
// genuine "&copy;" or "&sect;" in a note survives untouched.
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  // Deliberately a normal space (U+0020), not U+00A0. Strict HTML says
  // &nbsp; is a non-breaking space, but a stray U+00A0 in a CRM notes field
  // is its own quiet search-breaking problem — the same class of bug this
  // module exists to prevent — and nothing here needs a non-breaking space.
  nbsp: " ",
};

const NUMERIC_ENTITIES: Record<number, string> = {
  38: "&",
  60: "<",
  62: ">",
  34: '"',
  39: "'",
  160: " ",
};

// Matches &name; &#38; and &#x26; forms.
const ENTITY_PATTERN = /&(?:([a-zA-Z]+)|#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6}));/g;

/**
 * Decode the supported HTML entities in a string.
 *
 * Single pass by design: String.replace scans the original string once and
 * does not re-scan what it substituted in, so "&amp;lt;" decodes to "&lt;"
 * and stops there rather than collapsing to "<". Repeated decoding until
 * stable would corrupt any note that legitimately discusses escaped markup,
 * and one level is all the observed bug ever produces.
 */
export function decodeHtmlEntities(value: string): string {
  // Fast path — the overwhelming majority of fields contain no "&" at all.
  if (!value || !value.includes("&")) return value;

  return value.replace(ENTITY_PATTERN, (match, name?: string, dec?: string, hex?: string) => {
    if (name) {
      const decoded = NAMED_ENTITIES[name.toLowerCase()];
      return decoded === undefined ? match : decoded;
    }
    const code = dec !== undefined ? parseInt(dec, 10) : parseInt(hex as string, 16);
    const decoded = NUMERIC_ENTITIES[code];
    return decoded === undefined ? match : decoded;
  });
}

const MAX_DEPTH = 8;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Walk a JSON-shaped value and decode entities in every string it contains.
 *
 * Object keys are left alone — they are field names chosen by this codebase,
 * never free text from the caller. Numbers, booleans and null pass straight
 * through. Anything that is not a string, array or plain object (a Date, a
 * class instance) is returned untouched rather than rebuilt, so this can
 * never quietly flatten a value it does not understand.
 */
export function decodeHtmlEntitiesDeep<T>(value: T, depth = 0): T {
  if (depth > MAX_DEPTH) return value;

  if (typeof value === "string") {
    return decodeHtmlEntities(value) as unknown as T;
  }

  if (Array.isArray(value)) {
    return value.map((item) => decodeHtmlEntitiesDeep(item, depth + 1)) as unknown as T;
  }

  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = decodeHtmlEntitiesDeep(item, depth + 1);
    }
    return out as unknown as T;
  }

  return value;
}
