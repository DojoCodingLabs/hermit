/**
 * SL-34 (US-VAULT-03, FR-VAULT-03): reading a password manager's CSV export into vault items. Pure: the runtime holds
 * the result in memory and seals it; nothing here stores, logs or prompts.
 */
import { describe, expect, test } from "vitest";
import { utf8ToBytes } from "@noble/hashes/utils.js";
import { parseOrigin, type VaultEntry } from "../src/vault.ts";
import { detectFormat, IMPORT_LIMITS, planImport, previewOf, readImportFile, type ImportPlan } from "../src/vault-import.ts";

const CHROME = [
  "name,url,username,password,note",
  "github.com,https://github.com/login,ana,gh-S3cret!,",
  'Banco,https://banco.example/,ana@example.com,"pa,ss""word",PIN 4821',
  "router,http://192.168.1.1/,admin,admin123,",
  "app,android://8P1sW0EPJcslw7UzRsiXL64w-O50Ed-RBICtay1g24M==@com.example.app/,ana,app-pass,",
].join("\r\n");

const FIREFOX = [
  '"url","username","password","httpRealm","formActionOrigin","guid","timeCreated","timeLastUsed","timePasswordChanged"',
  '"https://accounts.example.org","ana","ff-pass-1",,"https://accounts.example.org","{0b0e}","1700000000000","1700000000000","1700000000000"',
  '"chrome://FirefoxAccounts","x","sync-pass","Firefox Accounts credentials",,"{1c1f}","1","1","1"',
].join("\r\n");

const BITWARDEN = [
  "folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp",
  ',1,login,Mail,"two\nlines",,0,"https://mail.example.com,androidapp://com.example.mail",ana,bw-pass-1,JBSWY3DPEHPK3PXP',
  ",,note,Recovery codes,secret note text,,0,,,,",
  ",,login,Shop,,,0,https://shop.example.com:8443/cart,ana,bw-pass-2,",
].join("\n");

const ONEPASSWORD = [
  "Title,Url,Username,Password,OTPAuth,Favorite,Archived,Tags,Notes",
  "Forum,https://forum.example.net/,ana,op-pass-1,,false,false,,hi",
].join("\r\n");

const bytes = (s: string) => utf8ToBytes(s);

function plan(csv: string, existing: VaultEntry[] = []): ImportPlan {
  const file = readImportFile(bytes(csv));
  if (!file.ok) throw new Error(file.problem);
  const format = detectFormat(file.header);
  if (!format) throw new Error("unknown format");
  return planImport(file, format, existing);
}

describe("reading the file", () => {
  test("a UTF-8 file with a byte order mark and CRLF reads its header without the mark", () => {
    const r = readImportFile(bytes(`\uFEFF${CHROME}\r\n`));
    expect(r.ok && r.header).toEqual(["name", "url", "username", "password", "note"]);
    expect(r.ok && r.rows.length).toBe(4);
  });

  test("hard caps: more bytes than the cap or more rows than the cap are refused before anything is planned", () => {
    expect(readImportFile(new Uint8Array(IMPORT_LIMITS.bytes + 1))).toEqual({ ok: false, problem: "too_large" });
    const many = ["name,url,username,password", ...Array.from({ length: IMPORT_LIMITS.rows + 1 }, (_, i) => `n${i},https://e${i}.test,u,p`)].join("\n");
    expect(readImportFile(bytes(many))).toEqual({ ok: false, problem: "too_many_rows" });
  });

  test("malformed UTF-8, malformed CSV, an empty file and a header with no rows are each refused with their own code", () => {
    expect(readImportFile(new Uint8Array([0x6e, 0xff, 0x0a]))).toEqual({ ok: false, problem: "not_utf8" });
    expect(readImportFile(bytes('name,url\r\n"x,y\r\n'))).toEqual({ ok: false, problem: "bad_csv" });
    expect(readImportFile(bytes(""))).toEqual({ ok: false, problem: "empty" });
    expect(readImportFile(bytes("name,url,username,password\r\n"))).toEqual({ ok: false, problem: "no_rows" });
  });
});

describe("detecting the format by its header", () => {
  test("Chrome and Google Password Manager, Firefox, Bitwarden and 1Password", () => {
    expect(detectFormat(["name", "url", "username", "password", "note"])?.format).toBe("chrome");
    expect(detectFormat(["name", "url", "username", "password"])?.format).toBe("chrome");
    expect(detectFormat(["url", "username", "password", "httpRealm", "formActionOrigin", "guid", "timeCreated", "timeLastUsed", "timePasswordChanged"])?.format).toBe("firefox");
    expect(detectFormat(["folder", "favorite", "type", "name", "notes", "fields", "reprompt", "login_uri", "login_username", "login_password", "login_totp"])?.format).toBe("bitwarden");
    expect(detectFormat(["Title", "Url", "Username", "Password", "OTPAuth", "Favorite", "Archived", "Tags", "Notes"])?.format).toBe("onepassword");
  });

  test("a header with a site and a password column under common names is read as a generic file", () => {
    expect(detectFormat(["Website", "Login", "Password", "Comments"])).toMatchObject({ format: "generic", map: { site: 0, username: 1, password: 2, notes: 3 } });
  });

  test("an unknown header (no site or no password column) is not guessed", () => {
    expect(detectFormat(["a", "b", "c"])).toBeUndefined();
    expect(detectFormat(["name", "username", "password"])).toBeUndefined();
    expect(detectFormat(["url", "username"])).toBeUndefined();
  });

  test("a first row that looks like data (an address in the header) is not taken as column names", () => {
    expect(detectFormat(["https://github.com", "ana", "password"])).toBeUndefined();
  });
});

describe("validating every row (FR-VAULT-03)", () => {
  test("Chrome: origins reduced to the vault's exact form; http and app origins reported, never changed", () => {
    const p = plan(CHROME);
    expect(p.format).toBe("chrome");
    expect(p.candidates.map((c) => [c.row, c.name, c.origins])).toEqual([
      [2, "github.com", ["https://github.com"]],
      [3, "Banco", ["https://banco.example"]],
    ]);
    expect(p.candidates[1]!.secrets).toEqual({ username: "ana@example.com", secret: 'pa,ss"word', notes: "PIN 4821" });
    expect(p.refused).toEqual([
      { row: 4, name: "router", site: "http://192.168.1.1/", problems: ["origin_not_https"] },
      { row: 5, name: "app", site: expect.stringMatching(/^android:\/\//), problems: ["origin_app"] },
    ]);
    // Every stored origin is already in the exact-origin form the vault and autofill compare.
    for (const c of p.candidates) for (const o of c.origins) expect(parseOrigin(o)).toEqual({ ok: true, origin: o });
  });

  test("Firefox: no name column, so the name is the site's host; a non-web entry is refused", () => {
    const p = plan(FIREFOX);
    expect(p.candidates.map((c) => [c.name, c.origins, c.secrets.secret])).toEqual([["accounts.example.org", ["https://accounts.example.org"], "ff-pass-1"]]);
    expect(p.refused).toEqual([{ row: 3, name: "", site: "chrome://FirefoxAccounts", problems: ["origin_invalid"] }]);
  });

  test("Bitwarden: several addresses per login, app addresses dropped and reported, notes kept, non-logins left out", () => {
    const p = plan(BITWARDEN);
    expect(p.candidates.map((c) => [c.row, c.name, c.origins, c.dropped])).toEqual([
      [2, "Mail", ["https://mail.example.com"], [{ site: "androidapp://com.example.mail", problem: "origin_app" }]],
      [4, "Shop", ["https://shop.example.com:8443"], []],
    ]);
    expect(p.candidates[0]!.secrets.notes).toBe("two\nlines");
    expect(p.refused).toEqual([{ row: 3, name: "Recovery codes", site: "", problems: ["not_login"] }]);
    // One-time code secrets have nowhere to go in this vault: counted and said, never put in another field.
    expect(p.extrasIgnored).toBe(1);
    expect(JSON.stringify(p.candidates)).not.toContain("JBSWY3DPEHPK3PXP");
  });

  test("1Password", () => {
    const p = plan(ONEPASSWORD);
    expect(p.candidates.map((c) => [c.name, c.origins, c.secrets])).toEqual([["Forum", ["https://forum.example.net"], { username: "ana", secret: "op-pass-1", notes: "hi" }]]);
  });

  test("a row without a site, without a password, too long, or with the wrong number of fields is refused with its reasons", () => {
    const long = "x".repeat(5_000);
    const p = plan(["name,url,username,password", "nosite,,ana,p1", "nopass,https://a.test,ana,", `long,https://b.test,ana,${long}`, "short,https://c.test", "extra,https://d.test,ana,p,surplus"].join("\n"));
    expect(p.candidates).toEqual([]);
    expect(p.refused.map((r) => [r.row, r.problems])).toEqual([
      [2, ["origins_missing"]],
      [3, ["secret_missing"]],
      [4, ["too_long"]],
      [5, ["bad_row"]],
      [6, ["bad_row"]],
    ]);
  });

  test("a row whose fields don't line up shows no cell at all: a shifted cell could be a password", () => {
    const p = plan(["name,url,username,password", "Hunter2-secret,ana,https://e.test"].join("\n"));
    expect(p.refused).toEqual([{ row: 2, name: "", site: "", problems: ["bad_row"] }]);
  });

  test("the same login twice in the file is imported once; the repeat is reported", () => {
    const p = plan(["name,url,username,password", "a,https://a.test/x,ana,p1", "a again,https://a.test/y,ana,p1", "other user,https://a.test,bob,p2"].join("\n"));
    expect(p.candidates.map((c) => c.row)).toEqual([2, 4]);
    expect(p.refused).toEqual([{ row: 3, name: "a again", site: "https://a.test/y", problems: ["duplicate_in_file"] }]);
  });

  test("a site shown for a refused row is cut to a safe length", () => {
    const p = plan(["name,url,username,password", `x,http://${"a".repeat(200)}.test,u,p`].join("\n"));
    expect(p.refused[0]!.site.length).toBeLessThanOrEqual(IMPORT_LIMITS.siteShown + 1);
  });
});

describe("duplicates against the vault", () => {
  const existing: VaultEntry[] = [
    { id: "v1", name: "GitHub work", origins: ["https://github.com"], createdAt: 1, updatedAt: 1 },
    { id: "v2", name: "Elsewhere", origins: ["https://elsewhere.test"], createdAt: 1, updatedAt: 1 },
  ];

  test("a row sharing an exact origin with a saved login lists that login, for the user to choose", () => {
    const p = plan(CHROME, existing);
    expect(p.candidates.map((c) => [c.row, c.existing])).toEqual([
      [2, [{ id: "v1", name: "GitHub work" }]],
      [3, []],
    ]);
  });

  test("the preview has names, sites and counts, never a username, password or note", () => {
    const p = plan(CHROME, existing);
    const preview = previewOf(p);
    expect(preview.ready.map((r) => r.name)).toEqual(["github.com", "Banco"]);
    const text = JSON.stringify(preview);
    for (const secret of ["gh-S3cret!", 'pa,ss"word', "ana@example.com", "PIN 4821", "admin123", "app-pass"]) expect(text).not.toContain(secret);
    expect(text).not.toMatch(/"(secrets|username|secret|notes)"/);
  });
});
