import {
  argsHash, createProfileStore, createVaultStore, keyMatches, normalizeOrigin, openProfileValue, openSecrets, planFill, requestOrigin, TRUSTED_BROWSERS,
  vaultItemHash,
  type AutofillWebNode, type FillPlan, type FormKind, type OriginRefusal, type ProfileKind, type ProfileRow, type SessionState,
  type SignedApprovalRequest, type SqlPort, type ToolCall, type VaultCipherPort, type VaultKeyPort,
} from "@hermit/core";
import {
  decide, FILL_FORM, FILL_LOGIN, fillRules, loginRules,
  type AuditLog, type SignedApprovalBlock, type SignedApprovalExpected, type SignedApprovalFailure, type SignedApprovals,
} from "@hermit/cage";

/**
 * SL-35 (US-FORM-01, FR-FORM-01, Q79): filling another app's form from the profile, through the cage.
 * SL-36 (US-FORM-02, FR-VAULT-04): logging in with a vault login, through the same flow.
 *
 * Android's autofill service (apps/mobile/modules/hermit-autofill) offers a locked suggestion with no values. When the
 * user taps it, the service's activity hands the request to Hermit's sheet, which calls `prepare`: the requester
 * is identified again here with the same exact-origin rule (a trusted browser's web page, or an app by its signing
 * key), and the cage decides the call in the signed log.
 *
 * - A profile form (`fill_form`, HM-FORM-01): the profile plans which fields it may fill; the preview shows each field
 *   and value (a sensitive one masked). `approve` is a tap for plain fields and the vault's strong-biometric unwrap
 *   when any field is sensitive.
 * - A login (`fill_login`, HM-APPR-01): offered only when the vault item stores the requester's exact origin. It is a
 *   `credential`: the cage asks every time for a Keystore signature (SL-37) over the exact payload (the item's id
 *   hash, the origin and the requester's verified identity), which the native prompt shows from the payload itself.
 *   `approve` takes that signature; only after it verifies (once, before its expiry) does the vault's own fingerprint
 *   open the item. The preview names the item and who asks, never the username or the password.
 *
 * Only then do values exist, keyed by field, for the native module to hand back to Android. Submitting the form stays
 * the user's own tap. Nothing here is a skill or reaches the model. With nobody on screen (a night pass, a headless
 * task) the cage turns the ask into a deny, so nothing fills unattended.
 */

/** How long a preview waits for the user. The native activity gives up a little later (AutofillAuthActivity). */
export const FILL_TTL_MS = 120_000;

/** The most fields one request may carry; the native service offers at most this many (ProfileFills.MAX_FIELDS). */
export const FILL_MAX_FIELDS = 64;

/** The fill's own session: never the chat's, so it is never tainted by what the chat read. */
const FILL_SESSION = "autofill";

/** The trusted browsers by name, for the sheet ("in Chrome"). Brand names, not translated. */
const BROWSER_NAMES: Readonly<Record<string, string>> = {
  "com.android.chrome": "Chrome",
  "com.sec.android.app.sbrowser": "Samsung Internet",
  "org.mozilla.firefox": "Firefox",
};

/** The two fields of a login form. */
export type LoginKind = "username" | "password";

/** Who asks, as Android reported it, and the request's id. Never a value. */
interface NativeRequester {
  id: string;
  packageName: string;
  /** What the app calls itself (PackageManager's label): shown, never trusted. */
  appLabel?: string;
  certDigests: string[];
  web: AutofillWebNode[];
  /** The origin the native service matched; it must equal the one computed here. */
  origin: string;
}

/** SL-35: a form the profile fills, its fields by key and kind. */
export interface NativeProfileRequest extends NativeRequester {
  kind?: "profile";
  fields: Array<{ key: string; kind: FormKind }>;
}

/** SL-36: a login form, and the vault item the user picked in the suggestion, by its id hash (`vaultItemHash`). */
export interface NativeLoginRequest extends NativeRequester {
  kind: "login";
  item: string;
  fields: Array<{ key: string; kind: LoginKind }>;
}

/** What the native module hands over. Never a value. */
export type NativeFillRequest = NativeProfileRequest | NativeLoginRequest;

export type Requester =
  | { kind: "web"; origin: string; secure: boolean; browser: string }
  /** `key`: the signing certificate digest, the app's verified identity; `label` is only what it calls itself. */
  | { kind: "app"; packageName: string; label?: string; key: string };

/** A field on HM-FORM-01. `value` only when not sensitive: a sensitive value is never in a preview. */
export interface FillLine {
  key: string;
  kind: FormKind;
  sensitive: boolean;
  value?: string;
}

export type FillRefusal =
  | OriginRefusal | "origin_changed" | "nothing_to_fill" | "blocked" | "not_on_screen" | "bad_request"
  /** SL-36: no vault login stores this requester's exact origin (or the picked one no longer does). */
  | "no_login"
  /** SL-36: no vault, or its key can't open anything. */
  | "no_vault"
  /** SL-36: the approval key isn't set up, was retired, or the phone has no strong biometric (SL-37). */
  | "key_none" | "key_lost" | "no_biometric";

export type FillPrepared =
  | { kind: "preview"; id: string; requester: Requester; lines: FillLine[]; skipped: FillPlan["skipped"]; requireBiometric: boolean; expiresAt: number }
  /**
   * SL-36: a login's approval sheet (HM-APPR-01). `name` is the item's; `fields` which of the two fill. `signed` is
   * what the Keystore approval key signs inside its fingerprint prompt, which shows the site and requester from it.
   */
  | { kind: "login"; id: string; requester: Requester; name: string; fields: LoginKind[]; expiresAt: number; signed: SignedApprovalRequest }
  | { kind: "refused"; reason: FillRefusal };

export type FillApproved =
  | { kind: "fill"; values: Record<string, string> }
  /**
   * The fingerprint was cancelled: nothing filled, the preview stays for another try. For a login it is the vault's
   * fingerprint after a spent signature, so `signed` is a fresh payload to sign.
   */
  | { kind: "cancelled"; signed?: SignedApprovalRequest }
  | { kind: "expired" }
  /** What was shown is no longer what would fill (the profile or the login changed since the preview). */
  | { kind: "changed" }
  | { kind: "lost" }
  | { kind: "not_on_screen" }
  /** SL-36: the approval wasn't a valid Keystore signature over this login's payload. Nothing filled. */
  | { kind: "not_signed"; reason: SignedApprovalBlock | SignedApprovalFailure | "replayed" }
  | { kind: "gone" };

export interface FormFill {
  prepare(req: NativeFillRequest): Promise<FillPrepared>;
  /** `signature`: for a login, the Keystore key's signature over the preview's `signed.message`. */
  approve(id: string, prompt: string, signature?: string): Promise<FillApproved>;
  deny(id: string): Promise<void>;
  /** Whether the native module handed the values to Android: the log's `executed` entry. */
  delivered(id: string, ok: boolean): Promise<void>;
}

export interface FormFillDeps {
  sql: SqlPort;
  audit: AuditLog;
  key: VaultKeyPort;
  cipher: VaultCipherPort;
  now(): number;
  newId(): string;
  /** True only while Hermit is in the foreground with its screen showing. */
  onScreen(): boolean;
  /** SL-36: the approval key's signed approvals (SL-37). Without it a login is refused (`key_none`). */
  signed?: SignedApprovals;
}

interface ProfilePending {
  kind: "profile";
  call: ToolCall;
  plan: FillPlan;
  /** The profile rows the preview was built from, as stored: a change since then refuses the fill. */
  rows: Map<ProfileKind, ProfileRow>;
  requireBiometric: boolean;
  expiresAt: number;
}

interface LoginPending {
  kind: "login";
  call: ToolCall;
  itemId: string;
  origin: string;
  /** The item as the preview saw it: an edit since then refuses the fill. */
  updatedAt: number;
  fields: Array<{ key: string; kind: LoginKind }>;
  expected: SignedApprovalExpected;
  signed: SignedApprovalRequest;
  expiresAt: number;
}

type Pending = ProfilePending | LoginPending;

const FORM_KINDS: ReadonlySet<string> = new Set([
  "given_name", "family_name", "full_name", "email", "phone", "street_address", "address_line2", "city", "region", "postal_code", "country",
  "birth_date", "id_number", "tax_id", "passport_number",
]);
const LOGIN_KINDS: ReadonlySet<string> = new Set(["username", "password"]);
const REF = /^[0-9a-f]{64}$/;

const requesterOk = (r: NativeRequester) =>
  typeof r.id === "string" && typeof r.packageName === "string" && typeof r.origin === "string" &&
  Array.isArray(r.certDigests) && r.certDigests.every((d) => typeof d === "string") &&
  Array.isArray(r.web) && r.web.every((w) => typeof w?.domain === "string" && (w.scheme === undefined || typeof w.scheme === "string"));

const fieldsOk = (fields: unknown, kinds: ReadonlySet<string>, max: number) =>
  Array.isArray(fields) && fields.length > 0 && fields.length <= max &&
  fields.every((f: { key?: unknown; kind?: unknown }) => typeof f?.key === "string" && typeof f.kind === "string" && kinds.has(f.kind)) &&
  new Set(fields.map((f: { key: string }) => f.key)).size === fields.length;

const wellFormed = (r: NativeFillRequest) =>
  requesterOk(r) &&
  (r.kind === "login"
    ? typeof r.item === "string" && REF.test(r.item) && fieldsOk(r.fields, LOGIN_KINDS, 2)
    : fieldsOk(r.fields, FORM_KINDS, FILL_MAX_FIELDS));

const sameRow = (a: ProfileRow | undefined, b: ProfileRow | undefined) =>
  a !== undefined && b !== undefined && a.sensitive === b.sensitive && (a.sensitive ? a.sealed === (b as typeof a).sealed : a.value === (b as typeof a).value);

const plainValue = (sources: readonly ProfileKind[], rows: ReadonlyMap<ProfileKind, ProfileRow>) =>
  sources.map((s) => rows.get(s)).map((r) => (r && !r.sensitive ? r.value : "")).filter(Boolean).join(" ");

const KEY_BLOCKS: ReadonlySet<string> = new Set(["key_none", "key_lost", "no_biometric"]);

export function createFormFill(deps: FormFillDeps): FormFill {
  const profile = createProfileStore(deps.sql);
  const vaultStore = createVaultStore(deps.sql);
  const pending = new Map<string, Pending>();
  const approved = new Map<string, ToolCall>();

  type LogEntry = {
    event: "call_proposed" | "policy_decided" | "approval" | "executed";
    decision?: "allow" | "ask" | "deny";
    outcome?: "ok" | "error" | "denied" | "expired";
    reason?: string;
    payloadHash?: string;
    approvalSig?: string;
  };
  const log = (call: ToolCall, entry: LogEntry) =>
    deps.audit.append({ ts: deps.now(), sessionId: FILL_SESSION, skill: call.skill, argsHash: call.argsHash, ...entry });

  /** Previews nobody approved or denied in time leave the map, signed as expired. */
  async function sweep() {
    const at = deps.now();
    for (const [id, p] of [...pending]) {
      if (at <= p.expiresAt) continue;
      pending.delete(id);
      await log(p.call, { event: "approval", decision: "ask", outcome: "expired" });
    }
  }

  function requesterOf(req: NativeFillRequest, origin: string): Requester {
    if (origin.startsWith("android://")) {
      return { kind: "app", packageName: req.packageName, key: req.certDigests[0]!, ...(req.appLabel ? { label: req.appLabel.slice(0, 80) } : {}) };
    }
    return { kind: "web", origin, secure: origin.startsWith("https://"), browser: BROWSER_NAMES[req.packageName] ?? req.packageName };
  }

  /** The cage's session for a fill: never tainted, unattended when nobody is on screen. */
  const fillSession = (): SessionState => ({ id: FILL_SESSION, taint: [], unattended: !deps.onScreen() });

  async function prepareProfile(req: NativeProfileRequest, origin: string): Promise<FillPrepared> {
    const stored = await profile.list();
    const rows = new Map(stored.map((r) => [r.kind, r]));
    const plan = planFill({ origin, fields: req.fields, profile: stored });
    if (!plan.fields.length) return { kind: "refused", reason: "nothing_to_fill" };

    const sensitive = plan.fields.some((f) => f.sensitive);
    const args = { requester: origin, fields: plan.fields.map((f) => ({ key: f.key, kind: f.kind })), sensitive };
    const call: ToolCall = { id: deps.newId(), skill: FILL_FORM, args, argsHash: argsHash(args), repairs: [] };
    const session = fillSession();
    await log(call, { event: "call_proposed" });
    const decision = decide(call, "send", session, fillRules());
    await log(call, { event: "policy_decided", decision: decision.effect });
    if (decision.effect === "deny") return { kind: "refused", reason: session.unattended ? "not_on_screen" : "blocked" };

    const id = call.id;
    const expiresAt = deps.now() + FILL_TTL_MS;
    pending.set(id, { kind: "profile", call, plan, rows, requireBiometric: decision.requireBiometric, expiresAt });
    return {
      kind: "preview",
      id,
      requester: requesterOf(req, origin),
      lines: plan.fields.map((f) => (f.sensitive ? { key: f.key, kind: f.kind, sensitive: true } : { key: f.key, kind: f.kind, sensitive: false, value: plainValue(f.sources, rows) })),
      skipped: plan.skipped,
      requireBiometric: decision.requireBiometric,
      expiresAt,
    };
  }

  async function prepareLogin(req: NativeLoginRequest, origin: string): Promise<FillPrepared> {
    // The item the user picked must store this exact origin; what the native index said is checked, not believed.
    const entry = (await vaultStore.list()).find((e) => vaultItemHash(e.id) === req.item);
    if (!entry || !entry.origins.some((o) => normalizeOrigin(o) === origin)) return { kind: "refused", reason: "no_login" };
    if (!(await vaultStore.keyCheck())) return { kind: "refused", reason: "no_vault" };

    // Who receives the values, by verified identity: the trusted browser for a page, the app itself for an app.
    const requester = origin.startsWith("android://") ? origin : `android://${req.certDigests[0]!}@${req.packageName}`;
    const fields = req.fields.map((f) => ({ key: f.key, kind: f.kind }));
    const args = { item: req.item, origin, requester, fields };
    const call: ToolCall = { id: deps.newId(), skill: FILL_LOGIN, args, argsHash: argsHash(args), repairs: [] };
    const session = fillSession();
    await log(call, { event: "call_proposed" });
    const decision = decide(call, "credential", session, loginRules());
    await log(call, { event: "policy_decided", decision: decision.effect });
    if (decision.effect === "deny") return { kind: "refused", reason: session.unattended ? "not_on_screen" : "blocked" };

    const expiresAt = deps.now() + FILL_TTL_MS;
    const expected: SignedApprovalExpected = { risk: "credential", skill: FILL_LOGIN, requestId: call.id, argsHash: call.argsHash, terms: { origin, item: req.item, requester } };
    const prepared = deps.signed
      ? await deps.signed.prepare({ ...expected, expiresAt }).catch(() => ({ ok: false as const, reason: "key_lost" as const }))
      : { ok: false as const, reason: "key_none" as const };
    if (!prepared.ok) {
      await log(call, { event: "approval", decision: "ask", outcome: "denied", reason: `signed.${prepared.reason}` });
      return { kind: "refused", reason: KEY_BLOCKS.has(prepared.reason) ? (prepared.reason as FillRefusal) : "blocked" };
    }

    pending.set(call.id, { kind: "login", call, itemId: entry.id, origin, updatedAt: entry.updatedAt, fields, expected, signed: prepared.request, expiresAt });
    return {
      kind: "login",
      id: call.id,
      requester: requesterOf(req, origin),
      name: entry.name,
      fields: [...new Set(fields.map((f) => f.kind))],
      expiresAt,
      signed: prepared.request,
    };
  }

  async function approveProfile(id: string, p: ProfilePending, prompt: string, retry: <T extends FillApproved>(r: T) => T): Promise<FillApproved> {
    // What was shown is what fills: every row the preview used must be exactly as it was.
    const now = new Map((await profile.list()).map((r) => [r.kind, r]));
    const sources = new Set(p.plan.fields.flatMap((f) => f.sources));
    if ([...sources].some((k) => !sameRow(p.rows.get(k), now.get(k)))) {
      await log(p.call, { event: "approval", decision: "ask", outcome: "error", reason: "fill.changed" });
      return { kind: "changed" };
    }

    const opened = new Map<ProfileKind, string>();
    if (p.requireBiometric) {
      const check = await vaultStore.keyCheck();
      if (!check) return { kind: "lost" };
      // The vault's Keystore key needs a strong biometric for every use: this unwrap is the fill's fingerprint.
      const got = await deps.key.unwrap(prompt);
      if (got.kind === "cancelled") return retry({ kind: "cancelled" });
      if (got.kind === "lost") return { kind: "lost" };
      try {
        if (!(await keyMatches(deps.cipher, got.key, check))) return { kind: "lost" };
        for (const k of sources) {
          const r = now.get(k);
          if (r?.sensitive) opened.set(k, await openProfileValue(deps.cipher, got.key, k, r.sealed));
        }
      } finally {
        got.key.fill(0);
      }
    }
    // A fingerprint can take a while: Hermit must still be on screen when the values are handed over.
    if (!deps.onScreen()) return retry({ kind: "not_on_screen" });

    const values: Record<string, string> = {};
    for (const f of p.plan.fields) {
      const parts = f.sources.map((s) => {
        const r = now.get(s)!;
        return r.sensitive ? opened.get(s) ?? "" : r.value;
      });
      const value = parts.filter(Boolean).join(" ");
      if (value) values[f.key] = value;
    }
    approved.set(id, p.call);
    await log(p.call, { event: "approval", decision: "ask", outcome: "ok" });
    return { kind: "fill", values };
  }

  async function approveLogin(id: string, p: LoginPending, prompt: string, signature: string | undefined): Promise<FillApproved> {
    // The approval is the Keystore signature over exactly this payload, verified with the pinned key, once.
    const checked = deps.signed
      ? await deps.signed.verify(p.signed, signature, p.expected).catch(() => ({ ok: false as const, reason: "key_lost" as const }))
      : { ok: false as const, reason: "key_none" as const };
    if (!checked.ok) {
      await log(p.call, { event: "approval", decision: "ask", outcome: "denied", reason: `signed.${checked.reason}` });
      return { kind: "not_signed", reason: checked.reason };
    }
    await log(p.call, { event: "approval", decision: "ask", outcome: "ok", payloadHash: checked.payloadHash, ...(signature ? { approvalSig: signature } : {}) });

    const failed = async <T extends FillApproved>(reason: string, r: T): Promise<T> => {
      await log(p.call, { event: "executed", outcome: "error", reason });
      return r;
    };
    // What was approved is what fills: the same item, unchanged, still storing this exact origin.
    const entry = await vaultStore.entry(p.itemId);
    if (!entry || entry.updatedAt !== p.updatedAt || !entry.origins.some((o) => normalizeOrigin(o) === p.origin)) return failed("login.changed", { kind: "changed" });
    const [check, sealed] = await Promise.all([vaultStore.keyCheck(), vaultStore.sealed(p.itemId)]);
    if (!check || !sealed) return failed("vault.lost", { kind: "lost" });

    // The vault key needs its own strong biometric for every use (Q86): the second fingerprint opens the item.
    const got = await deps.key.unwrap(prompt);
    if (got.kind === "cancelled") {
      // The signature is spent (its nonce is used): another try signs a fresh payload for the same call.
      await log(p.call, { event: "executed", outcome: "error", reason: "vault.cancelled" });
      if (deps.now() > p.expiresAt || !deps.signed) return { kind: "expired" };
      const again = await deps.signed.prepare({ ...p.expected, expiresAt: p.expiresAt }).catch(() => ({ ok: false as const, reason: "key_lost" as const }));
      if (!again.ok) return { kind: "not_signed", reason: again.reason === "key_none" || again.reason === "no_biometric" ? again.reason : "key_lost" };
      pending.set(id, { ...p, signed: again.request });
      return { kind: "cancelled", signed: again.request };
    }
    if (got.kind === "lost") return failed("vault.lost", { kind: "lost" });
    let secrets;
    try {
      if (!(await keyMatches(deps.cipher, got.key, check))) return failed("vault.lost", { kind: "lost" });
      secrets = await openSecrets(deps.cipher, got.key, p.itemId, sealed);
    } catch {
      return failed("vault.lost", { kind: "lost" });
    } finally {
      got.key.fill(0);
    }
    // A fingerprint can take a while: Hermit must still be on screen when the values are handed over.
    if (!deps.onScreen()) return failed("fill.not_on_screen", { kind: "not_on_screen" });

    const values: Record<string, string> = {};
    for (const f of p.fields) {
      const value = f.kind === "username" ? secrets.username : secrets.secret;
      if (value) values[f.key] = value;
    }
    approved.set(id, p.call);
    return { kind: "fill", values };
  }

  return {
    async prepare(req) {
      await sweep();
      if (!wellFormed(req)) return { kind: "refused", reason: "bad_request" };
      // The same exact-origin rule as the service, again here: the native side's answer is checked, not believed.
      const from = requestOrigin({ packageName: req.packageName, certDigests: req.certDigests, web: req.web }, TRUSTED_BROWSERS);
      if (!from.ok) return { kind: "refused", reason: from.reason };
      if (from.origin !== req.origin) return { kind: "refused", reason: "origin_changed" };
      return req.kind === "login" ? prepareLogin(req, from.origin) : prepareProfile(req, from.origin);
    },

    async approve(id, prompt, signature) {
      // Claimed at once, before any await: a second approve of the same preview (a double tap) finds nothing.
      const p = pending.get(id);
      if (!p) return { kind: "gone" };
      pending.delete(id);
      // Only a cancelled fingerprint or a trip off screen before anything was spent leaves the preview for another try.
      const retry = <T extends FillApproved>(r: T): T => {
        if (deps.now() <= p.expiresAt) pending.set(id, p);
        return r;
      };
      if (deps.now() > p.expiresAt) {
        await log(p.call, { event: "approval", decision: "ask", outcome: "expired" });
        return { kind: "expired" };
      }
      if (!deps.onScreen()) return retry({ kind: "not_on_screen" });
      return p.kind === "login" ? approveLogin(id, p, prompt, signature) : approveProfile(id, p, prompt, retry);
    },

    async deny(id) {
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      await log(p.call, { event: "approval", decision: "ask", outcome: "denied" });
    },

    async delivered(id, ok) {
      const call = approved.get(id);
      if (!call) return;
      approved.delete(id);
      await log(call, { event: "executed", outcome: ok ? "ok" : "error" });
    },
  };
}
