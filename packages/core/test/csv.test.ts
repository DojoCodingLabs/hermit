/**
 * SL-34 (US-VAULT-03, FR-VAULT-03): the RFC 4180 reader the vault import uses, and the cell escaper any later export
 * must use. Strict on purpose: a misread row could shift a password into the name column the preview shows.
 */
import { describe, expect, test } from "vitest";
import { csvCell, csvLine, parseCsv } from "../src/csv.ts";

const ok = (text: string, maxRows = 100) => {
  const r = parseCsv(text, maxRows);
  if (!r.ok) throw new Error(`${r.problem} at ${r.record}`);
  return r.rows;
};

describe("parseCsv (RFC 4180)", () => {
  test("plain fields, CRLF and LF record breaks, and no extra record for the final break", () => {
    expect(ok("a,b,c\r\n1,2,3\r\n")).toEqual([["a", "b", "c"], ["1", "2", "3"]]);
    expect(ok("a,b\n1,2")).toEqual([["a", "b"], ["1", "2"]]);
    expect(ok("a,b\r\n1,2\n3,4\r\n")).toEqual([["a", "b"], ["1", "2"], ["3", "4"]]);
  });

  test("quoted fields hold commas, CRLF and LF newlines, and escaped quotes", () => {
    expect(ok('name,notes\r\n"Banco, personal","line 1\r\nline 2\nline 3"\r\n')).toEqual([["name", "notes"], ["Banco, personal", "line 1\r\nline 2\nline 3"]]);
    expect(ok('p\r\n"say ""hi"""\r\n')).toEqual([["p"], ['say "hi"']]);
    expect(ok('p\r\n""""\r\n')).toEqual([["p"], ['"']]);
  });

  test("empty fields, quoted empty fields and a trailing empty field survive", () => {
    expect(ok('a,b,c\r\n,"",\r\n')).toEqual([["a", "b", "c"], ["", "", ""]]);
  });

  test("spaces are data, kept exactly (a password may start or end with one)", () => {
    expect(ok("a,b\r\n  x , y \r\n")).toEqual([["a", "b"], ["  x ", " y "]]);
  });

  test("a leading byte order mark is not part of the first header", () => {
    expect(ok("\uFEFFname,url\r\nx,y\r\n")[0]).toEqual(["name", "url"]);
  });

  test("blank lines between records are skipped, not read as records", () => {
    expect(ok("a,b\r\n\r\n1,2\r\n\n")).toEqual([["a", "b"], ["1", "2"]]);
  });

  test("an unterminated quote is refused with the record it starts in", () => {
    expect(parseCsv('a,b\r\n1,"open\r\n2,3\r\n', 100)).toEqual({ ok: false, problem: "unterminated_quote", record: 2 });
  });

  test("a quote inside an unquoted field, or text after a closing quote, is refused instead of guessed", () => {
    expect(parseCsv('a,b\r\n1,ab"c\r\n', 100)).toEqual({ ok: false, problem: "stray_quote", record: 2 });
    expect(parseCsv('a,b\r\n1,"ab"c\r\n', 100)).toEqual({ ok: false, problem: "stray_quote", record: 2 });
  });

  test("a lone CR outside quotes is refused (no record break means it is ambiguous)", () => {
    expect(parseCsv("a,b\r1,2", 100)).toEqual({ ok: false, problem: "stray_cr", record: 1 });
  });

  test("the row cap counts data records only and stops reading as soon as it is passed", () => {
    expect(ok("h\r\n1\r\n2\r\n", 2)).toHaveLength(3);
    expect(parseCsv("h\r\n1\r\n2\r\n3\r\n", 2)).toEqual({ ok: false, problem: "too_many_rows", record: 4 });
  });

  test("an empty text is an empty table", () => {
    expect(ok("")).toEqual([]);
    expect(ok("\uFEFF")).toEqual([]);
  });
});

describe("csvCell and csvLine (formula-injection-safe export)", () => {
  test("cells that a spreadsheet would run as a formula are prefixed with a quote mark", () => {
    for (const v of ["=1+1", "+SUM(A1)", "-2+3", "@cmd", "\tx", "\rx", "=HYPERLINK(\"http://e.test\")"]) expect(csvCell(v).replace(/^"/, "").startsWith("'")).toBe(true);
    expect(csvCell("plain")).toBe("plain");
  });

  test("commas, quotes and newlines are quoted and quotes doubled, so parseCsv reads the cell back", () => {
    const cells = ["a,b", 'say "hi"', "line 1\r\nline 2", "ok", "=evil()"];
    const line = csvLine(cells);
    const back = ok(`${line}\r\n`)[0]!;
    expect(back.slice(0, 4)).toEqual(cells.slice(0, 4));
    expect(back[4]).toBe("'=evil()");
  });
});
