/**
 * SL-34 (US-VAULT-03, FR-VAULT-03): CSV as RFC 4180 defines it, for the vault import, plus the cell escaper any later
 * export must use.
 *
 * The reader is strict on purpose: a quote inside an unquoted field, text after a closing quote, an unterminated quote
 * or a lone CR is refused instead of guessed. A guess could shift a row's cells, and a password moved into the name
 * column would then show in the import preview. Fields are kept exactly (spaces included: a password may start or end
 * with one). Records break on CRLF or LF; blank lines are skipped. A leading byte order mark is dropped.
 */

export type CsvProblem = "unterminated_quote" | "stray_quote" | "stray_cr" | "too_many_rows";

/** `record` is 1-based and counts the header, so it matches the row number a spreadsheet shows for simple files. */
export type CsvParse = { ok: true; rows: string[][] } | { ok: false; problem: CsvProblem; record: number };

/** Reads every record; `maxRows` caps the data records (the header excluded) and stops the read as soon as it is passed. */
export function parseCsv(input: string, maxRows: number): CsvParse {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const n = text.length;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  /** The current field has content or was quoted (so `""` is a field, and a blank line is not a record). */
  let started = false;
  let quotedInRecord = false;
  let i = 0;
  const fail = (problem: CsvProblem): CsvParse => ({ ok: false, problem, record: rows.length + 1 });

  /** Ends the current record; false once the data records pass the cap. */
  const endRecord = (): boolean => {
    row.push(field);
    if (!(row.length === 1 && row[0] === "" && !quotedInRecord)) rows.push(row);
    row = [];
    field = "";
    started = false;
    quotedInRecord = false;
    return rows.length <= maxRows + 1;
  };

  while (i < n) {
    const c = text[i]!;
    if (c === '"') {
      if (started) return fail("stray_quote");
      started = true;
      quotedInRecord = true;
      i++;
      let closed = false;
      while (i < n) {
        const q = text[i]!;
        if (q === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i += 2;
            continue;
          }
          i++;
          closed = true;
          break;
        }
        field += q;
        i++;
      }
      if (!closed) return fail("unterminated_quote");
      const next = text[i];
      if (next !== undefined && next !== "," && next !== "\n" && next !== "\r") return fail("stray_quote");
      continue;
    }
    if (c === ",") {
      row.push(field);
      field = "";
      started = false;
      i++;
      continue;
    }
    if (c === "\r") {
      if (text[i + 1] !== "\n") return fail("stray_cr");
      i++;
      continue;
    }
    if (c === "\n") {
      if (!endRecord()) return { ok: false, problem: "too_many_rows", record: rows.length };
      i++;
      continue;
    }
    field += c;
    started = true;
    i++;
  }
  if (started || row.length > 0) {
    if (!endRecord()) return { ok: false, problem: "too_many_rows", record: rows.length };
  }
  return { ok: true, rows };
}

/** Characters that make a spreadsheet read a cell as a formula (OWASP CSV injection). */
const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * One cell for an exported CSV: a cell a spreadsheet would run as a formula gets a leading `'`, and a cell with a comma,
 * a quote or a newline is quoted with its quotes doubled. Nothing exports today; any export must go through this.
 */
export function csvCell(value: string): string {
  const safe = FORMULA_START.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export const csvLine = (cells: readonly string[]) => cells.map(csvCell).join(",");
