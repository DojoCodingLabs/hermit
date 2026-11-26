import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { normalizeOrigin } from "./autofill-origin.ts";
import type { SqlPort } from "./ports.ts";
import { utf8Decode, type VaultCipherPort } from "./vault.ts";

/**
 * SL-35 (US-FORM-01, US-FORM-03, FR-FORM-01): the personal profile that fills forms in other apps, and the rule that
 * says what kind of detail a form field asks for.
 *
 * The profile lives in the vault (`profile_fields`, migration 13, inside the SQLCipher database). A field that is not
 * sensitive is stored as typed; a sensitive one (every ID number, and any field the user marks) is also sealed with
 * the vault key, so filling it needs the vault's strong-biometric unwrap. Nothing here reaches the model: no skill
 * reads the profile, and the autofill service gets the kinds the profile has, never a value.
 *
 * `classifyField` is mirrored in Kotlin (FieldKinds.kt in apps/mobile/modules/hermit-autofill). Both run the vectors in
 * test/profile-field-vectors.json and both assert their tables equal the vectors' tables, so change them together.
 */

/** What the profile stores, in the order HM-FORM-02 lists it. A full name is built from the given and family names. */
export const PROFILE_KINDS = [
  "given_name", "family_name", "email", "phone",
  "street_address", "address_line2", "city", "region", "postal_code", "country",
  "birth_date", "id_number", "tax_id", "passport_number",
] as const;

export type ProfileKind = (typeof PROFILE_KINDS)[number];

/** What a form field can ask for: a profile kind, or a full name. */
export type FormKind = ProfileKind | "full_name";

/** US-FORM-03, Q91: ID numbers are always sensitive; the user may mark any other field sensitive too. */
export const ALWAYS_SENSITIVE: ReadonlySet<ProfileKind> = new Set<ProfileKind>(["id_number", "tax_id", "passport_number"]);

export const PROFILE_LIMITS = { value: 200 } as const;

export const isProfileKind = (k: unknown): k is ProfileKind => typeof k === "string" && (PROFILE_KINDS as readonly string[]).includes(k);

export type ProfileProblem = "empty" | "too_long" | "bad_email" | "control_chars";

/** Trims the value and refuses what a form field can't take: nothing, too long, control characters (one line only). */
export function validateProfileValue(kind: ProfileKind, raw: string): { ok: true; value: string } | { ok: false; problem: ProfileProblem } {
  const value = raw.trim();
  if (!value) return { ok: false, problem: "empty" };
  if (value.length > PROFILE_LIMITS.value) return { ok: false, problem: "too_long" };
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) return { ok: false, problem: "control_chars" };
  if (kind === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return { ok: false, problem: "bad_email" };
  return { ok: true, value };
}

// --- What a form field asks for (shared vectors with the Kotlin service) --------------------------------------------

/**
 * A field as Android's AssistStructure describes it. Never its current value: only what says what the field is.
 * `html` holds the HTML attributes a browser reported, with lowercase names (type, autocomplete, name, id, placeholder,
 * label, aria-label). `inputType` is the raw android.text.InputType of a native field.
 */
export interface FieldDescriptor {
  hints: string[];
  html: Record<string, string>;
  idEntry?: string;
  hint?: string;
  inputType: number;
}

type Verdict = FormKind | "password" | "skip";

/**
 * Autofill hints and HTML autocomplete tokens, lowercased with everything but letters and digits removed. "skip" is a
 * field Hermit never fills from the profile (usernames, one-time codes, cards, which are not in this slice).
 */
export const HINT_KINDS: Readonly<Record<string, Verdict>> = {
  password: "password", currentpassword: "password", newpassword: "password",
  username: "skip", newusername: "skip", smsotpcode: "skip", onetimecode: "skip",
  creditcardnumber: "skip", creditcardsecuritycode: "skip", creditcardexpirationdate: "skip", ccnumber: "skip", cccsc: "skip", ccexp: "skip", ccname: "skip",
  personmiddlename: "skip", additionalname: "skip", organization: "skip",
  name: "full_name", personname: "full_name",
  givenname: "given_name", persongivenname: "given_name",
  familyname: "family_name", personfamilyname: "family_name",
  email: "email", emailaddress: "email",
  tel: "phone", phone: "phone", phonenumber: "phone", phonenational: "phone", telnational: "phone",
  postaladdress: "street_address", streetaddress: "street_address", postaladdressstreetaddress: "street_address", addressline1: "street_address",
  addressline2: "address_line2", extendedaddress: "address_line2", postaladdressextendedaddress: "address_line2",
  addresslevel2: "city", addresslocality: "city", postaladdresslocality: "city",
  addresslevel1: "region", addressregion: "region", postaladdressregion: "region",
  postalcode: "postal_code",
  country: "country", countryname: "country", addresscountry: "country", postaladdresscountry: "country",
  bday: "birth_date", birthdatefull: "birth_date",
};

/**
 * The words of a field's id, hint, name, placeholder and label, in order: the first rule with a whole word in `any`,
 * or with every word of one group in `all`, decides. Passwords and the skipped fields come first, and the more
 * specific kinds before the general ones ("email address" is an email, "address line 2" is not the street).
 */
export const WORD_RULES: ReadonlyArray<{ kind: Verdict; any: string[]; all: string[][] }> = [
  { kind: "password", any: ["password", "passwd", "pwd", "contrasena", "clave", "pin"], all: [] },
  { kind: "skip", any: ["username", "usuario", "login", "otp", "captcha", "search", "buscar", "coupon", "cupon", "promo", "company", "empresa", "organization", "card", "tarjeta", "cvv", "cvc"], all: [] },
  { kind: "passport_number", any: ["passport", "pasaporte"], all: [] },
  { kind: "tax_id", any: ["rfc", "nit", "rut", "cuit", "cuil", "ruc", "taxid", "vat", "nif"], all: [["tax", "id"], ["tax", "number"]] },
  { kind: "id_number", any: ["dni", "cedula", "curp", "ssn", "nationalid", "documento", "dui", "identificacion", "identification"], all: [["national", "id"], ["id", "number"], ["identity", "number"]] },
  { kind: "email", any: ["email", "mail", "correo", "emailaddress"], all: [] },
  { kind: "phone", any: ["phone", "tel", "telephone", "telefono", "mobile", "celular", "movil", "cell", "whatsapp"], all: [] },
  { kind: "birth_date", any: ["birthday", "birthdate", "dob", "nacimiento", "cumpleanos"], all: [["birth", "date"], ["date", "birth"]] },
  { kind: "postal_code", any: ["zip", "zipcode", "postal", "postcode", "postalcode", "cp"], all: [] },
  { kind: "country", any: ["country", "pais"], all: [] },
  { kind: "region", any: ["state", "province", "provincia", "region", "estado", "county"], all: [] },
  { kind: "city", any: ["city", "ciudad", "town", "locality", "municipio", "localidad", "canton"], all: [] },
  { kind: "address_line2", any: ["address2", "line2", "apartment", "apt", "suite", "unit", "interior", "depto"], all: [["address", "2"], ["line", "2"], ["direccion", "2"]] },
  { kind: "street_address", any: ["address", "street", "direccion", "calle", "addr", "address1", "line1", "domicilio"], all: [] },
  { kind: "full_name", any: ["fullname", "nombrecompleto"], all: [["full", "name"], ["nombre", "completo"]] },
  { kind: "family_name", any: ["lastname", "surname", "familyname", "apellido", "apellidos", "lname"], all: [["last", "name"], ["family", "name"]] },
  { kind: "given_name", any: ["firstname", "givenname", "fname", "nombre", "nombres"], all: [["first", "name"], ["given", "name"]] },
  { kind: "full_name", any: ["name"], all: [] },
];

/** HTML input types that never take a profile value. */
const SKIP_HTML_TYPES = new Set(["hidden", "submit", "button", "reset", "checkbox", "radio", "file", "image", "range", "color", "search"]);

// android.text.InputType
const CLASS_MASK = 0x0f;
const VARIATION_MASK = 0xff0;
const CLASS_TEXT = 1;
const CLASS_NUMBER = 2;
const CLASS_PHONE = 3;

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Lowercase words without accents, split at camelCase, digits and punctuation. Mirrored in FieldKinds.kt. */
export function fieldTokens(texts: ReadonlyArray<string | undefined>): string[] {
  const out: string[] = [];
  for (const raw of texts) {
    if (!raw) continue;
    const s = raw
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/([a-z])([0-9])/g, "$1 $2")
      .replace(/([0-9])([a-z])/g, "$1 $2");
    for (const w of s.split(/[^a-z0-9]+/)) if (w) out.push(w);
  }
  return out;
}

const decided = (v: Verdict): FormKind | "password" | undefined => (v === "skip" ? undefined : v);

/** The kind a field asks for, "password" for a password field, or undefined when Hermit never fills it. */
export function classifyField(d: FieldDescriptor): FormKind | "password" | undefined {
  // 1. Android's autofill hints.
  const hints = d.hints.map(squash);
  if (hints.some((h) => h.includes("password"))) return "password";
  for (const h of hints) {
    const v = HINT_KINDS[h];
    if (v) return decided(v);
  }
  // 2. HTML autocomplete, from its last token ("section-a shipping postal-code").
  // JavaScript's \s includes the Unicode spaces (no-break, ideographic); FieldKinds.kt spells out the same class.
  const auto = (d.html.autocomplete ?? "").split(/\s+/u).map(squash).filter(Boolean);
  if (auto.some((h) => h.includes("password"))) return "password";
  for (const h of [...auto].reverse()) {
    const v = HINT_KINDS[h];
    if (v) return decided(v);
  }
  // 3. HTML input type.
  const type = (d.html.type ?? "").toLowerCase();
  if (type === "password") return "password";
  if (SKIP_HTML_TYPES.has(type)) return undefined;
  if (type === "email") return "email";
  if (type === "tel") return "phone";
  // 4. A native field's input type.
  const cls = d.inputType & CLASS_MASK;
  const variation = d.inputType & VARIATION_MASK;
  if (cls === CLASS_NUMBER && variation === 0x10) return "password";
  if (cls === CLASS_TEXT) {
    if (variation === 0x80 || variation === 0x90 || variation === 0xe0) return "password";
    if (variation === 0x20 || variation === 0xd0) return "email";
    if (variation === 0x60) return "full_name";
    if (variation === 0x70) return "street_address";
  }
  if (cls === CLASS_PHONE) return "phone";
  // 5. The words around it.
  const words = fieldTokens([d.idEntry, d.hint, d.html.name, d.html.id, d.html.placeholder, d.html.label, d.html["aria-label"]]);
  const set = new Set(words);
  for (const rule of WORD_RULES) {
    if (rule.any.some((w) => set.has(w)) || rule.all.some((group) => group.every((w) => set.has(w)))) return decided(rule.kind);
  }
  return undefined;
}

// --- Sealing (sensitive fields) -------------------------------------------------------------------------------------

/** Binds a sealed value to its kind: a blob copied onto another field fails to open. */
export const profileAad = (kind: ProfileKind) => utf8ToBytes(`hermit.profile.field.v1\u0000${kind}`);

export async function sealProfileValue(cipher: VaultCipherPort, key: Uint8Array, kind: ProfileKind, value: string): Promise<string> {
  const plain = utf8ToBytes(JSON.stringify({ v: 1, value }));
  try {
    return bytesToHex(await cipher.seal(key, plain, profileAad(kind)));
  } finally {
    plain.fill(0);
  }
}

export async function openProfileValue(cipher: VaultCipherPort, key: Uint8Array, kind: ProfileKind, sealed: string): Promise<string> {
  const plain = await cipher.open(key, hexToBytes(sealed), profileAad(kind));
  try {
    const o = JSON.parse(utf8Decode(plain)) as { v: number; value: string };
    if (o.v !== 1 || typeof o.value !== "string") throw new Error("Unknown profile value format.");
    return o.value;
  } finally {
    plain.fill(0);
  }
}

// --- Storage --------------------------------------------------------------------------------------------------------

export type ProfileRow =
  | { kind: ProfileKind; sensitive: false; value: string; updatedAt: number }
  | { kind: ProfileKind; sensitive: true; sealed: string; updatedAt: number };

export type ProfilePut = { kind: ProfileKind; sensitive: false; value: string } | { kind: ProfileKind; sensitive: true; sealed: string };

interface Row { kind: string; sensitive: number; value: string | null; sealed: string | null; updated_at: number }

const rowOf = (r: Row): ProfileRow | undefined => {
  if (!isProfileKind(r.kind)) return undefined;
  if (r.sensitive === 1 && r.sealed !== null) return { kind: r.kind, sensitive: true, sealed: r.sealed, updatedAt: r.updated_at };
  if (r.sensitive === 0 && r.value !== null) return { kind: r.kind, sensitive: false, value: r.value, updatedAt: r.updated_at };
  return undefined;
};

const order = (k: ProfileKind) => PROFILE_KINDS.indexOf(k);

/** ENT-ProfileField (`profile_fields`), migration 13: one row per kind. */
export function createProfileStore(sql: SqlPort) {
  return {
    async list(): Promise<ProfileRow[]> {
      const rows = (await sql.query<Row>("SELECT kind, sensitive, value, sealed, updated_at FROM profile_fields")).map(rowOf).filter((r): r is ProfileRow => r !== undefined);
      return rows.sort((a, b) => order(a.kind) - order(b.kind));
    },
    async get(kind: ProfileKind): Promise<ProfileRow | undefined> {
      const [row] = await sql.query<Row>("SELECT kind, sensitive, value, sealed, updated_at FROM profile_fields WHERE kind = ?", [kind]);
      return row ? rowOf(row) : undefined;
    },
    async put(field: ProfilePut, at: number): Promise<void> {
      await sql.exec(
        `INSERT INTO profile_fields (kind, sensitive, value, sealed, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(kind) DO UPDATE SET sensitive = excluded.sensitive, value = excluded.value, sealed = excluded.sealed, updated_at = excluded.updated_at`,
        [field.kind, field.sensitive ? 1 : 0, field.sensitive ? null : field.value, field.sensitive ? field.sealed : null, at],
      );
    },
    async remove(kind: ProfileKind): Promise<boolean> {
      const before = await sql.query<{ n: number }>("SELECT COUNT(*) AS n FROM profile_fields WHERE kind = ?", [kind]);
      await sql.exec("DELETE FROM profile_fields WHERE kind = ?", [kind]);
      return (before[0]?.n ?? 0) > 0;
    },
  };
}

export type ProfileStore = ReturnType<typeof createProfileStore>;

// --- Planning a fill ------------------------------------------------------------------------------------------------

/** A field the autofill service found, by its key in the request (its position), and the kind it asks for. */
export interface FormField {
  key: string;
  kind: FormKind;
}

export interface PlannedField {
  key: string;
  kind: FormKind;
  /** Sensitive when any profile field it is built from is: it needs the fingerprint. */
  sensitive: boolean;
  /** The profile kinds its value is built from (a full name: the given and family names). */
  sources: ProfileKind[];
}

export interface FillPlan {
  fields: PlannedField[];
  /** Fields the profile could fill but this requester may not get. */
  skipped: Array<{ key: string; kind: FormKind; reason: "needs_secure_page" }>;
}

const sourcesOf = (kind: FormKind, have: ReadonlyMap<ProfileKind, boolean>): ProfileKind[] =>
  kind === "full_name" ? (["given_name", "family_name"] as const).filter((k) => have.has(k)) : have.has(kind) ? [kind] : [];

/**
 * Which fields of a form the profile fills for this requester. The origin must be exactly an origin (the autofill
 * rule's canonical form: a trusted browser's web page, or an app by its signing key); anything else gets nothing.
 * An http page never gets a sensitive field (Q92). Each key is planned once.
 */
export function planFill(input: { origin: string; fields: readonly FormField[]; profile: ReadonlyArray<{ kind: ProfileKind; sensitive: boolean }> }): FillPlan {
  const plan: FillPlan = { fields: [], skipped: [] };
  if (!input.origin || normalizeOrigin(input.origin) !== input.origin) return plan;
  const secure = !input.origin.startsWith("http://");
  const have = new Map(input.profile.map((p) => [p.kind, p.sensitive]));
  const seen = new Set<string>();
  for (const f of input.fields) {
    if (seen.has(f.key)) continue;
    seen.add(f.key);
    const sources = sourcesOf(f.kind, have);
    if (!sources.length) continue;
    const sensitive = sources.some((s) => have.get(s) === true);
    if (sensitive && !secure) plan.skipped.push({ key: f.key, kind: f.kind, reason: "needs_secure_page" });
    else plan.fields.push({ key: f.key, kind: f.kind, sensitive, sources });
  }
  return plan;
}

/**
 * What the autofill service may know before anything is approved: which kinds the profile can fill and which of them
 * are sensitive. Kinds only, never a value. Sorted, so the stored index changes only when the profile does.
 */
export function profileIndex(profile: ReadonlyArray<{ kind: ProfileKind; sensitive: boolean }>): { kinds: FormKind[]; sensitive: FormKind[] } {
  const kinds = new Set<FormKind>();
  const sensitive = new Set<FormKind>();
  for (const p of profile) {
    kinds.add(p.kind);
    if (p.sensitive) sensitive.add(p.kind);
    if (p.kind === "given_name" || p.kind === "family_name") {
      kinds.add("full_name");
      if (p.sensitive) sensitive.add("full_name");
    }
  }
  return { kinds: [...kinds].sort(), sensitive: [...sensitive].sort() };
}
