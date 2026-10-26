import ExcelJS from "exceljs";

// Nebraska Liquor Control Commission "Active License Roster" → rows for
// liquor_stage_rows (migration 032). Columns are found by header name, not
// position: the NLCC exports move columns around between pulls (the 5/22/2024
// and 6/6/2024 rosters already differ), and some pulls carry extra columns
// (Manager Name) that others lack.
//
// Scope (Dan, 10/26/2026): Nebraska retail + miscellaneous licenses only.
// Out-of-state premises and the "Shipper" class type are skipped and counted.

export type RosterRow = {
  license_number: string;
  class_type: string | null;
  class: string | null;
  secondary: string[];
  trade_name: string | null;
  premises_street: string | null;
  premises_city: string | null;
  premises_state: string | null;
  premises_zip: string | null;
  county: string | null;
  county_index: string | null;
  corporate_limits: string | null;
  restrictions: string | null;
  phone: string | null;
  email: string | null;
  manager_name: string | null;
  licensee: string | null;
  corporate_address: string | null;
  effective_date: string | null;
  issue_date: string | null;
  expiration_date: string | null;
  legal_description: string | null;
};

export type ParsedRoster = {
  rows: RosterRow[];
  total: number;
  skipped_out_of_state: number;
  skipped_shipper: number;
  skipped_no_number: number;
  has_manager_column: boolean;
  /** Roster date read from the file name (…06062024…), if there is one. */
  date_from_name: string | null;
};

const HEADERS: Record<string, keyof RosterRow | "address"> = {
  "license class type": "class_type",
  "class": "class",
  "secondary licenses": "secondary",
  "license number": "license_number",
  "trade name": "trade_name",
  "address": "address",
  "city": "premises_city",
  "county": "county",
  "county index #": "county_index",
  "corporate limits designation": "corporate_limits",
  "restrictions": "restrictions",
  "phone number": "phone",
  "email address": "email",
  "manager name": "manager_name",
  "licensee": "licensee",
  "corporate address": "corporate_address",
  "current effective date": "effective_date",
  "issue date": "issue_date",
  "current expiration date": "expiration_date",
  "legal description on license": "legal_description",
};

const REQUIRED = ["license number", "trade name", "address", "licensee"];

function text(v: ExcelJS.CellValue): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") {
    if ("richText" in v) return v.richText.map((t) => t.text).join("");
    if ("text" in v && typeof v.text === "string") return v.text;
    if ("result" in v) return text(v.result as ExcelJS.CellValue);
    return null;
  }
  const s = String(v).trim();
  if (s === "" || /^(none|null|n\/a)$/i.test(s)) return null;
  return s;
}

function date(v: ExcelJS.CellValue): string | null {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = text(v);
  if (!s) return null;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  const iso = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return iso ? iso[1] : null;
}

/** "7224 MAPLE ST \nOMAHA, NE  68134-6827\nUSA" → street / city / state / zip. */
export function splitAddress(raw: string | null): {
  street: string | null; city: string | null; state: string | null; zip: string | null;
} {
  if (!raw) return { street: null, city: null, state: null, zip: null };
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && l.toUpperCase() !== "USA");
  // Some pulls write the suite first ("STE 110-1100 S DEWEY ST"); put it last,
  // the way the other pulls (and every CRM property) write it.
  const first = lines[0] ?? null;
  const suite = first?.match(/^(STE|SUITE|UNIT|APT|#)\s*(\S.*?)\s*-\s*(\d+[A-Z]?\s.*)$/i);
  const street = suite ? `${suite[3].trim()} ${suite[1].toUpperCase() === "#" ? "#" : "STE"} ${suite[2].trim()}` : first;
  const last = lines.length > 1 ? lines[lines.length - 1] : "";
  const m = last.match(/^(.*?),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)?\s*$/i);
  if (m) return { street, city: m[1].trim() || null, state: m[2].toUpperCase(), zip: m[3] ?? null };
  return { street, city: null, state: null, zip: null };
}

/** One line: "1861 FRONT ST, BLAIR, NE 68008-1557". */
function oneLine(raw: string | null): string | null {
  if (!raw) return null;
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && l.toUpperCase() !== "USA");
  return lines.join(", ").replace(/\s{2,}/g, " ") || null;
}

function titleCity(s: string | null): string | null {
  if (!s) return null;
  return s.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase());
}

export function dateFromFileName(name: string): string | null {
  const m = name.match(/(?:^|[^0-9])(\d{2})(\d{2})(\d{4})(?:[^0-9]|$)/);
  if (!m) return null;
  const [, mm, dd, yyyy] = m;
  const d = new Date(`${yyyy}-${mm}-${dd}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.getUTCMonth() + 1 !== Number(mm)) return null;
  return `${yyyy}-${mm}-${dd}`;
}

export class RosterError extends Error {}

export async function parseRoster(data: ArrayBuffer | Buffer, fileName = ""): Promise<ParsedRoster> {
  const wb = new ExcelJS.Workbook();
  // exceljs's own Buffer typing lags @types/node; the runtime accepts both.
  await wb.xlsx.load(data as unknown as Parameters<typeof wb.xlsx.load>[0]);
  const ws = wb.worksheets[0];
  if (!ws) throw new RosterError("The workbook has no sheets.");

  // Header row: the first row that names "License Number".
  let headerRow = 0;
  const col: Partial<Record<keyof RosterRow | "address", number>> = {};
  for (let r = 1; r <= Math.min(ws.rowCount, 10) && !headerRow; r++) {
    const row = ws.getRow(r);
    const found: typeof col = {};
    row.eachCell((cell, c) => {
      const h = (text(cell.value) ?? "").toLowerCase().replace(/\s+/g, " ").trim();
      const key = HEADERS[h];
      if (key && found[key] === undefined) found[key] = c;
    });
    if (found.license_number) {
      headerRow = r;
      Object.assign(col, found);
    }
  }
  if (!headerRow) throw new RosterError("No 'License Number' column found — is this an NLCC Active License Roster?");
  const missing = REQUIRED.filter((h) => col[HEADERS[h]] === undefined);
  if (missing.length) throw new RosterError(`Missing column(s): ${missing.join(", ")}.`);

  const get = (row: ExcelJS.Row, k: keyof RosterRow | "address") =>
    col[k] === undefined ? null : row.getCell(col[k] as number).value;

  const out: ParsedRoster = {
    rows: [], total: 0, skipped_out_of_state: 0, skipped_shipper: 0, skipped_no_number: 0,
    has_manager_column: col.manager_name !== undefined,
    date_from_name: dateFromFileName(fileName),
  };
  const seen = new Map<string, number>();

  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    if (!row.hasValues) continue;
    out.total++;
    const num = text(get(row, "license_number"));
    if (!num) { out.skipped_no_number++; continue; }
    const county = text(get(row, "county"));
    const classType = text(get(row, "class_type"));
    if ((county ?? "").toLowerCase() === "out of state") { out.skipped_out_of_state++; continue; }
    if ((classType ?? "").toLowerCase() === "shipper") { out.skipped_shipper++; continue; }

    const addr = splitAddress(text(get(row, "address")));
    if (addr.state && addr.state !== "NE") { out.skipped_out_of_state++; continue; }
    const cityCol = text(get(row, "premises_city"));
    const rec: RosterRow = {
      license_number: num,
      class_type: classType,
      class: text(get(row, "class"))?.toUpperCase() ?? null,
      secondary: (text(get(row, "secondary")) ?? "").split(/[,;]/).map((s) => s.trim().toUpperCase()).filter(Boolean),
      trade_name: text(get(row, "trade_name")),
      premises_street: addr.street,
      premises_city: cityCol && cityCol.toUpperCase() !== "N/A" ? cityCol : titleCity(addr.city),
      premises_state: addr.state ?? "NE",
      premises_zip: addr.zip,
      county,
      county_index: text(get(row, "county_index")),
      corporate_limits: text(get(row, "corporate_limits")),
      restrictions: text(get(row, "restrictions"))?.replace(/\s{2,}/g, " ") ?? null,
      phone: text(get(row, "phone")),
      email: text(get(row, "email"))?.toLowerCase() ?? null,
      manager_name: text(get(row, "manager_name")),
      licensee: text(get(row, "licensee")),
      corporate_address: oneLine(text(get(row, "corporate_address"))),
      effective_date: date(get(row, "effective_date")),
      issue_date: date(get(row, "issue_date")),
      expiration_date: date(get(row, "expiration_date")),
      legal_description: text(get(row, "legal_description")),
    };
    const at = seen.get(num);
    if (at === undefined) { seen.set(num, out.rows.length); out.rows.push(rec); }
    else out.rows[at] = rec;   // a repeated license number: the later row wins
  }
  return out;
}
