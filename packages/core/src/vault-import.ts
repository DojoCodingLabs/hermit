import { parseCsv } from "./csv.ts";
import { parseOrigin, utf8Decode, validateItem, type VaultEntry, type VaultProblem, type VaultSecrets } from "./vault.ts";

/**
 * SL-34 (US-VAULT-03, FR-VAULT-03): a password manager's CSV export read into vault items, all pure.
 *
 * The file arrives as bytes the user picked in the system document picker. Its format is recognized by its header
 * (Chrome and Google Password Manager, Firefox, Bitwarden, 1Password, or a header with site and password columns under
 * common names); an unknown header is refused, never guessed (Q89). Every row is validated with the vault's own rules:
 * each address is reduced to the vault's exact origin (`parseOrigin`), and http, app and malformed addresses are reported
 * with their reason, never rewritten. A row that shares an origin with a saved login lists that login so the user
 * chooses (Q87).
 *
 * The plan holds the secrets in memory only, for the runtime to seal; `previewOf` is the only shape a screen gets, and it
 * carries names and sites, never a username, a password or a note.
 */

/** Q88: hard caps, checked before anything is planned (2 MiB holds about ten thousand typical logins). */
export const IMPORT_LIMITS = { bytes: 2 * 1024 * 1024, rows: 5_000, siteShown: 80 } as const;

export type ImportFormat = "chrome" | "firefox" | "bitwarden" | "onepassword" | "generic";

export interface ColumnMap {
  site: number;
  password: number;
  name?: number;
  username?: number;
  notes?: number;
}

export interface DetectedFormat {
  format: ImportFormat;
  map: ColumnMap;
  /** Bitwarden's item type column: only "login" rows are logins. */
  type?: number;
  /** Columns this vault has no place for (one-time code secrets, custom fields): counted, never copied elsewhere. */
  extras: number[];
}

export type ImportFileProblem = "too_large" | "not_utf8" | "bad_csv" | "too_many_rows" | "empty" | "no_rows";

export type ImportFile = { ok: true; header: string[]; rows: string[][] } | { ok: false; problem: ImportFileProblem };

export type RowProblem = VaultProblem | "origin_app" | "not_login" | "bad_row" | "duplicate_in_file";

export interface ImportCandidate {
  /** The record number in the file (the header is 1). */
  row: number;
  name: string;
  origins: string[];
  secrets: VaultSecrets;
  /** Addresses of this row that were left out, with why (a Bitwarden login can list several). */
  dropped: { site: string; problem: RowProblem }[];
  /** Saved logins that share an exact origin with this row. */
  existing: { id: string; name: string }[];
}

export interface ImportRefused {
  row: number;
  name: string;
  /** The address as written in the file, cut to IMPORT_LIMITS.siteShown. */
  site: string;
  problems: RowProblem[];
}

export interface ImportPlan {
  format: ImportFormat;
  candidates: ImportCandidate[];
  refused: ImportRefused[];
  /** Rows with a one-time code secret or custom fields, which are not imported. */
  extrasIgnored: number;
}

/** What HM-VAULT-03 shows: names, sites and counts. No secret field exists on it. */
export interface ImportPreview {
  format: ImportFormat;
  ready: { row: number; name: string; origins: string[]; dropped: { site: string; problem: RowProblem }[]; existing: { id: string; name: string }[] }[];
  refused: ImportRefused[];
  extrasIgnored: number;
}

/** Decodes and parses the picked bytes; the caller zeroes them afterward. */
export function readImportFile(bytes: Uint8Array): ImportFile {
  if (bytes.length > IMPORT_LIMITS.bytes) return { ok: false, problem: "too_large" };
  let text: string;
  try {
    text = utf8Decode(bytes);
  } catch {
    return { ok: false, problem: "not_utf8" };
  }
  const parsed = parseCsv(text, IMPORT_LIMITS.rows);
  if (!parsed.ok) return { ok: false, problem: parsed.problem === "too_many_rows" ? "too_many_rows" : "bad_csv" };
  const [header, ...rows] = parsed.rows;
  if (!header) return { ok: false, problem: "empty" };
  if (!rows.length) return { ok: false, problem: "no_rows" };
  return { ok: true, header, rows };
}

// --- Formats ------------------------------------------------------------------------------------------------------

const norm = (h: string) => h.trim().toLowerCase().replace(/\s+/g, " ");

/** Column names per role, in order of preference. Exports from these managers use the first names listed. */
const ROLE_NAMES = {
  site: ["url", "login_uri", "website", "web site", "uri", "site", "address", "login url"],
  password: ["password", "login_password", "pass"],
  name: ["name", "title"],
  username: ["username", "login_username", "user name", "user", "login", "email", "e-mail"],
  notes: ["note", "notes", "extra", "comments"],
} as const;

const EXTRA_NAMES = ["login_totp", "otpauth", "totp", "fields"];

/**
 * The format of a header, or undefined when it can't be read without guessing: no site or no password column, or a
 * first row that looks like data (an address or an email where a column name should be).
 */
export function detectFormat(header: readonly string[]): DetectedFormat | undefined {
  const h = header.map(norm);
  if (h.some((c) => c.includes("://") || c.includes("@"))) return undefined;
  const find = (names: readonly string[]) => {
    for (const name of names) {
      const i = h.indexOf(name);
      if (i >= 0) return i;
    }
    return undefined;
  };
  const site = find(ROLE_NAMES.site);
  const password = find(ROLE_NAMES.password);
  if (site === undefined || password === undefined) return undefined;
  const map: ColumnMap = { site, password };
  for (const role of ["name", "username", "notes"] as const) {
    const i = find(ROLE_NAMES[role]);
    if (i !== undefined) map[role] = i;
  }
  const extras = EXTRA_NAMES.map((n) => h.indexOf(n)).filter((i) => i >= 0);
  const has = (...names: string[]) => names.every((n) => h.includes(n));
  let format: ImportFormat = "generic";
  let type: number | undefined;
  if (has("login_uri", "login_password", "type")) {
    format = "bitwarden";
    type = h.indexOf("type");
  } else if (has("url", "username", "password", "guid", "formactionorigin")) format = "firefox";
  else if (has("title", "username", "password") && (has("url") || has("website"))) format = "onepassword";
  else if (has("name", "url", "username", "password") && h.length <= 5) format = "chrome";
  return { format, map, extras, ...(type !== undefined ? { type } : {}) };
}

// --- Rows ---------------------------------------------------------------------------------------------------------

const APP_SCHEME = /^(android|androidapp|iosapp|ios):\/\//i;
const cut = (s: string) => (s.length > IMPORT_LIMITS.siteShown ? `${s.slice(0, IMPORT_LIMITS.siteShown)}…` : s);
const hostOf = (origin: string) => origin.replace(/^https:\/\//, "");

function siteProblem(site: string): { ok: true; origin: string } | { ok: false; problem: RowProblem } {
  if (APP_SCHEME.test(site.trim())) return { ok: false, problem: "origin_app" };
  const r = parseOrigin(site);
  return r.ok ? r : { ok: false, problem: r.problem };
}

/**
 * Validates every row and lists, for each one that can be imported, the saved logins it may duplicate. A row with the
 * wrong number of fields is refused: its cells can't be trusted to be in their columns.
 */
export function planImport(file: { header: string[]; rows: string[][] }, detected: DetectedFormat, existing: readonly VaultEntry[]): ImportPlan {
  const { map } = detected;
  const width = file.header.length;
  const candidates: ImportCandidate[] = [];
  const refused: ImportRefused[] = [];
  const seen = new Set<string>();
  let extrasIgnored = 0;
  const byOrigin = new Map<string, { id: string; name: string }[]>();
  for (const e of existing) for (const o of e.origins) byOrigin.set(o, [...(byOrigin.get(o) ?? []), { id: e.id, name: e.name }]);

  file.rows.forEach((cells, index) => {
    const row = index + 2;
    const cell = (i: number | undefined) => (i === undefined ? "" : (cells[i] ?? ""));
    const rawSite = cell(map.site);
    const rawName = cell(map.name).trim();
    const refuse = (problems: RowProblem[]) => refused.push({ row, name: rawName, site: cut(rawSite.trim()), problems });
    // Its cells may be shifted (a password where the name should be): nothing from it is shown.
    if (cells.length !== width) return refused.push({ row, name: "", site: "", problems: ["bad_row"] });
    if (detected.type !== undefined && cell(detected.type).trim().toLowerCase() !== "login") return refuse(["not_login"]);

    // Only Bitwarden lists several addresses in one cell (comma separated); a single address may hold a comma.
    const sites = (detected.format === "bitwarden" ? rawSite.split(/[,\n]/) : [rawSite]).map((s) => s.trim()).filter(Boolean);
    const origins: string[] = [];
    const dropped: ImportCandidate["dropped"] = [];
    for (const s of sites) {
      const r = siteProblem(s);
      if (r.ok) {
        if (!origins.includes(r.origin)) origins.push(r.origin);
      } else dropped.push({ site: cut(s), problem: r.problem });
    }
    if (sites.length && !origins.length) return refuse([...new Set(dropped.map((d) => d.problem))]);

    const name = rawName || (origins[0] ? hostOf(origins[0]) : "");
    const v = validateItem({ name, origins, username: cell(map.username), secret: cell(map.password), notes: cell(map.notes) });
    if (!v.ok) return refuse(v.problems);
    if (detected.extras.some((i) => cell(i).trim() !== "")) extrasIgnored++;

    const key = JSON.stringify([[...v.origins].sort(), v.secrets.username, v.secrets.secret]);
    if (seen.has(key)) return refuse(["duplicate_in_file"]);
    seen.add(key);

    const matches = new Map<string, { id: string; name: string }>();
    for (const o of v.origins) for (const m of byOrigin.get(o) ?? []) matches.set(m.id, m);
    candidates.push({ row, name: v.name, origins: v.origins, secrets: v.secrets, dropped, existing: [...matches.values()] });
  });
  return { format: detected.format, candidates, refused, extrasIgnored };
}

/** The plan without its secrets: the only thing a screen receives. */
export function previewOf(plan: ImportPlan): ImportPreview {
  return {
    format: plan.format,
    ready: plan.candidates.map((c) => ({ row: c.row, name: c.name, origins: [...c.origins], dropped: c.dropped.map((d) => ({ ...d })), existing: c.existing.map((e) => ({ ...e })) })),
    refused: plan.refused.map((r) => ({ ...r, problems: [...r.problems] })),
    extrasIgnored: plan.extrasIgnored,
  };
}

/** What the user chose for a row that duplicates a saved login. Rows without a duplicate are always added. */
export type DuplicateChoice = "skip" | "replace" | "keep_both";

/** Q87: a duplicate is skipped unless the user picks otherwise, so an import never overwrites a login by default. */
export const DEFAULT_DUPLICATE_CHOICE: DuplicateChoice = "skip";
