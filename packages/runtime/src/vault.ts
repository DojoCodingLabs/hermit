import {
  createVaultStore, DEFAULT_DUPLICATE_CHOICE, detectFormat, generatePassword, keyCheck, keyMatches, openSecrets, planImport, previewOf, readImportFile,
  sealSecrets, sha256Hex, validateItem, VAULT_CLIPBOARD_CLEAR_MS, VAULT_KEY_BYTES, VAULT_REVEAL_MS, vaultItemHash,
  type DuplicateChoice, type GeneratorOptions, type ImportFileProblem, type ImportPlan, type ImportPreview, type SecureRandom, type SqlPort,
  type VaultCipherPort, type VaultEntry, type VaultItemInput, type VaultKeyPort, type VaultProblem, type VaultSecrets,
} from "@hermit/core";
import type { AuditLog } from "@hermit/cage";
import { lockedAfter, PROMPT_GRACE_MS } from "./app-lock.ts";

/**
 * SL-33 (US-VAULT-01, US-VAULT-02, US-VAULT-04, FR-VAULT-01, FR-VAULT-02): the vault service HM-VAULT-01 and
 * HM-VAULT-02 call. It is never a skill and is never on the model's menu: nothing here reaches a prompt.
 *
 * - Unlocking is a fingerprint that proves the wrapped key opens this vault (the key check), then lists names and
 *   origins. The key is not kept: every reveal, copy and save unwraps it again behind a fresh fingerprint and zeroes
 *   it right after, so the vault key lives in memory only for the one operation.
 * - It locks when the app lock engages, when the app goes to the background (except a brief trip caused by Hermit's
 *   own fingerprint prompt) and after VAULT_IDLE_MS without use (Q83).
 * - Reveal and copy need the app on screen, so an unattended run (the night shift) never gets a secret.
 * - Every action is signed in the log as a `vault` entry with the hash of the item id and an action code only.
 * - Import (SL-34, US-VAULT-03): the picked file's bytes are read, then zeroed; the parsed rows stay in this closure
 *   only (never the database, a log or a file) until the user imports, cancels or the vault locks, which drops them.
 *   The screen gets names and sites only. One fingerprint seals every row, written in one transaction, and the log
 *   gets one summary entry with counts.
 */

/** Q83: the vault locks after this long without use (conservative; the app lock's own grace is longer). */
export const VAULT_IDLE_MS = 120_000;

/** Vault actions are the user's own, from the vault screens, not part of any chat session. */
const VAULT_SESSION = "user";

export interface VaultLockState {
  unlocked: boolean;
  /** The last use while unlocked, for the idle rule. */
  activeAt?: number;
  /** When the app left the screen while a fingerprint prompt was open. */
  hiddenAt?: number;
  /** Hermit's own fingerprint prompts currently open. */
  prompts: number;
}

export type VaultLockEvent =
  | { type: "unlocked"; at: number }
  /** A use of the vault while unlocked (keeps it open). */
  | { type: "active"; at: number }
  /** A clock reading (the screen's timer and every call): locks once idle too long. */
  | { type: "tick"; at: number }
  | { type: "background"; at: number }
  | { type: "foreground"; at: number }
  | { type: "prompt_open" }
  | { type: "prompt_close" }
  /** US-SET-09: the app lock engaged. */
  | { type: "app_locked" }
  | { type: "lock" };

export function initialVaultLock(): VaultLockState {
  return { unlocked: false, prompts: 0 };
}

const locked = (s: VaultLockState): VaultLockState => ({ unlocked: false, prompts: s.prompts });

/** Pure lock rules. Times are wall clock, so a clock set backwards reads as idle and locks (fails closed). */
export function vaultLockReducer(s: VaultLockState, e: VaultLockEvent): VaultLockState {
  switch (e.type) {
    case "unlocked":
      return { unlocked: true, activeAt: e.at, prompts: s.prompts };
    case "active":
    case "tick": {
      if (!s.unlocked) return s;
      if (lockedAfter(e.at - (s.activeAt ?? e.at), VAULT_IDLE_MS)) return locked(s);
      return e.type === "active" ? { ...s, activeAt: e.at } : s;
    }
    case "background":
      if (!s.unlocked) return s;
      // The phone's fingerprint prompt can send Hermit to the background: wait to see how long it was away.
      return s.prompts > 0 ? (s.hiddenAt === undefined ? { ...s, hiddenAt: e.at } : s) : locked(s);
    case "foreground": {
      if (!s.unlocked || s.hiddenAt === undefined) return s;
      if (lockedAfter(e.at - s.hiddenAt, PROMPT_GRACE_MS)) return locked(s);
      const next = { ...s };
      delete next.hiddenAt;
      return next;
    }
    case "prompt_open":
      return { ...s, prompts: s.prompts + 1 };
    case "prompt_close":
      return { ...s, prompts: Math.max(0, s.prompts - 1) };
    case "app_locked":
    case "lock":
      return locked(s);
  }
}

export interface VaultDeps {
  sql: SqlPort;
  audit: AuditLog;
  key: VaultKeyPort;
  cipher: VaultCipherPort;
  random: SecureRandom;
  now(): number;
  newId(): string;
  /** True only while the app is in the foreground and its screen is showing (AppState "active"). */
  onScreen(): boolean;
  /** Called when an unlocked vault locks, except by going to the background: the app clears a pending copy. */
  onLocked?(): void;
}

/** "lost": the wrapped key was invalidated (new fingerprints) or is gone; only a reset starts over. */
export type VaultStatus = "none" | "locked" | "unlocked" | "lost";

type Refusal = { kind: "locked" } | { kind: "lost" } | { kind: "cancelled" } | { kind: "gone" };
export type VaultList = { kind: "items"; items: VaultEntry[] } | { kind: "locked" } | { kind: "lost" };
export type VaultSave = { kind: "saved"; id: string } | { kind: "invalid"; problems: VaultProblem[] } | Refusal;
export type VaultReveal = { kind: "revealed"; secrets: VaultSecrets; hideAt: number } | { kind: "not_on_screen" } | Refusal;
export type VaultCopy = { kind: "copy"; value: string; clearAfterMs: number } | { kind: "not_on_screen" } | Refusal;

export type VaultAction = "created" | "added" | "edited" | "deleted" | "revealed" | "copied" | "reset" | "imported";

export type VaultImportPrepare =
  | { kind: "preview"; preview: ImportPreview }
  | { kind: "refused"; problem: ImportFileProblem | "unknown_format" }
  | { kind: "locked" }
  | { kind: "lost" };

export interface VaultImportCounts {
  added: number;
  replaced: number;
  /** Duplicates of saved logins the user chose to skip. */
  skipped: number;
  /** Rows refused by validation, non-logins and repeats inside the file. */
  refused: number;
}

export type VaultImportCommit =
  | { kind: "imported"; counts: VaultImportCounts }
  | { kind: "nothing_pending" }
  | { kind: "locked" }
  | { kind: "lost" }
  | { kind: "cancelled" };

export interface Vault {
  status(): Promise<VaultStatus>;
  /** A new vault: a fresh random key, wrapped behind a fingerprint. Leaves it unlocked. */
  create(prompt: string): Promise<"created" | "cancelled" | "unavailable" | "exists">;
  unlock(prompt: string): Promise<"unlocked" | "cancelled" | "lost" | "none">;
  lock(): void;
  /** The app feeds AppState changes and the app lock here. */
  event(e: VaultLockEvent): void;
  /** For the screens: true while unlocked (runs the idle rule first). */
  isUnlocked(): boolean;
  list(): Promise<VaultList>;
  entry(id: string): Promise<{ kind: "entry"; entry: VaultEntry } | Refusal>;
  /** Adds (no `id`) or edits (`id`) a login; an invalid one asks for no fingerprint. */
  save(input: VaultItemInput & { id?: string }, prompt: string): Promise<VaultSave>;
  /** The screen hides the secrets again at `hideAt` (US-VAULT-02). */
  reveal(id: string, prompt: string): Promise<VaultReveal>;
  /** The value to put on the clipboard as sensitive; the app clears it after `clearAfterMs` (Q82). */
  copy(id: string, field: "username" | "secret", prompt: string): Promise<VaultCopy>;
  remove(id: string): Promise<"deleted" | "gone" | "locked">;
  /** A lost vault starts over: every item, the key check and the wrapped key (with its Keystore key) go. */
  reset(): Promise<void>;
  generate(options: GeneratorOptions): string;
  /**
   * SL-34: reads a picked CSV (zeroing `bytes` whatever happens) and holds its rows in memory for `commitImport`.
   * Replaces any import already pending.
   */
  prepareImport(bytes: Uint8Array): Promise<VaultImportPrepare>;
  /** One fingerprint for the whole import. `choices` is keyed by row number; a duplicate without one is skipped (Q87). */
  commitImport(choices: Readonly<Record<number, DuplicateChoice>>, prompt: string): Promise<VaultImportCommit>;
  /** Drops a pending import's rows. */
  cancelImport(): void;
}

export function createVault(deps: VaultDeps): Vault {
  const store = createVaultStore(deps.sql);
  let lock = initialVaultLock();
  let lost = false;
  /** SL-34: the rows of a picked file, secrets included. Only here, and only until import, cancel or lock. */
  let pending: ImportPlan | undefined;
  const dropImport = () => {
    if (!pending) return;
    // JavaScript strings can't be overwritten; dropping every reference lets the engine collect them.
    pending.candidates.length = 0;
    pending.refused.length = 0;
    pending = undefined;
  };
  const apply = (e: VaultLockEvent) => {
    const was = lock.unlocked;
    lock = vaultLockReducer(lock, e);
    if (was && !lock.unlocked) dropImport();
    // Q82: a lock clears a copy still waiting for its timer, except the trip to another app the copy was made for
    // (the paste happens there; the 30 s timer still clears it).
    if (was && !lock.unlocked && e.type !== "background") deps.onLocked?.();
  };
  const unlocked = () => {
    apply({ type: "tick", at: deps.now() });
    return lock.unlocked;
  };
  const used = () => apply({ type: "active", at: deps.now() });

  const log = (action: VaultAction, id?: string, summary?: { reason: string; argsHash: string }) =>
    deps.audit.append({
      ts: deps.now(), sessionId: VAULT_SESSION, event: "vault", skill: "vault", outcome: "ok", reason: summary?.reason ?? `vault.${action}`,
      ...(summary ? { argsHash: summary.argsHash } : id !== undefined ? { argsHash: vaultItemHash(id) } : {}),
    });

  /** Hermit's own prompt: a brief trip to the background while it is open doesn't lock. */
  async function prompted<T>(f: () => Promise<T>): Promise<T> {
    apply({ type: "prompt_open" });
    try {
      return await f();
    } finally {
      apply({ type: "prompt_close" });
    }
  }

  /** Unwraps the key behind a fingerprint, checks it is this vault's, runs `f`, and zeroes the key whatever happens. */
  async function withKey<T>(prompt: string, f: (key: Uint8Array) => Promise<T>): Promise<T | { kind: "cancelled" } | { kind: "lost" }> {
    const got = await prompted(() => deps.key.unwrap(prompt));
    if (got.kind === "cancelled") return { kind: "cancelled" };
    if (got.kind === "lost") return markLost();
    try {
      const check = await store.keyCheck();
      if (!check || !(await keyMatches(deps.cipher, got.key, check))) return markLost();
      return await f(got.key);
    } finally {
      got.key.fill(0);
    }
  }

  function markLost(): { kind: "lost" } {
    lost = true;
    apply({ type: "lock" });
    return { kind: "lost" };
  }

  async function status(): Promise<VaultStatus> {
    const check = await store.keyCheck();
    if (!check) return "none";
    if (lost || !(await deps.key.exists())) return "lost";
    return unlocked() ? "unlocked" : "locked";
  }

  /** The common gate: an existing, unlocked, not lost vault. */
  async function gate(): Promise<{ kind: "locked" } | { kind: "lost" } | undefined> {
    const s = await status();
    if (s === "lost") return { kind: "lost" };
    if (s !== "unlocked") return { kind: "locked" };
    return undefined;
  }

  async function secretsOf(id: string, prompt: string): Promise<{ kind: "ok"; secrets: VaultSecrets } | Refusal> {
    const sealed = await store.sealed(id);
    if (sealed === undefined) return { kind: "gone" };
    const r = await withKey(prompt, async (key) => ({ kind: "ok" as const, secrets: await openSecrets(deps.cipher, key, id, sealed) }));
    return r;
  }

  return {
    status,
    async create(prompt) {
      if ((await store.keyCheck()) && (await deps.key.exists())) return "exists";
      const key = deps.random(VAULT_KEY_BYTES);
      try {
        if (key.length !== VAULT_KEY_BYTES) throw new Error("The random source returned the wrong length.");
        const stored = await prompted(() => deps.key.store(key, prompt));
        if (stored !== "stored") return stored;
        // A vault whose key was lost is wiped before the fresh one starts, so no old blob stays behind.
        await store.wipe();
        await store.setKeyCheck(await keyCheck(deps.cipher, key), deps.now());
      } finally {
        key.fill(0);
      }
      lost = false;
      apply({ type: "unlocked", at: deps.now() });
      await log("created");
      return "created";
    },
    async unlock(prompt) {
      const s = await status();
      if (s === "none") return "none";
      if (s === "lost") return "lost";
      if (s === "unlocked") return "unlocked";
      const r = await withKey(prompt, async () => "ok" as const);
      if (r !== "ok") return r.kind;
      apply({ type: "unlocked", at: deps.now() });
      return "unlocked";
    },
    lock: () => apply({ type: "lock" }),
    event: apply,
    isUnlocked: unlocked,
    async list() {
      const refused = await gate();
      if (refused) return refused;
      used();
      return { kind: "items", items: await store.list() };
    },
    async entry(id) {
      const refused = await gate();
      if (refused) return refused;
      used();
      const entry = await store.entry(id);
      return entry ? { kind: "entry", entry } : { kind: "gone" };
    },
    async save(input, prompt) {
      const refused = await gate();
      if (refused) return refused;
      const v = validateItem(input);
      if (!v.ok) return { kind: "invalid", problems: v.problems };
      if (input.id !== undefined && !(await store.entry(input.id))) return { kind: "gone" };
      const id = input.id ?? deps.newId();
      const r = await withKey(prompt, async (key) => {
        await store.put({ id, name: v.name, origins: v.origins, sealed: await sealSecrets(deps.cipher, key, id, v.secrets) }, deps.now());
        return "ok" as const;
      });
      if (r !== "ok") return r;
      used();
      await log(input.id === undefined ? "added" : "edited", id);
      return { kind: "saved", id };
    },
    async reveal(id, prompt) {
      if (!deps.onScreen()) return { kind: "not_on_screen" };
      const refused = await gate();
      if (refused) return refused;
      const r = await secretsOf(id, prompt);
      if (r.kind !== "ok") return r;
      // A fingerprint prompt can take a while: the screen must still be showing when the secret is handed over.
      if (!deps.onScreen()) return { kind: "not_on_screen" };
      used();
      await log("revealed", id);
      return { kind: "revealed", secrets: r.secrets, hideAt: deps.now() + VAULT_REVEAL_MS };
    },
    async copy(id, field, prompt) {
      if (!deps.onScreen()) return { kind: "not_on_screen" };
      const refused = await gate();
      if (refused) return refused;
      const r = await secretsOf(id, prompt);
      if (r.kind !== "ok") return r;
      if (!deps.onScreen()) return { kind: "not_on_screen" };
      used();
      await log("copied", id);
      return { kind: "copy", value: r.secrets[field], clearAfterMs: VAULT_CLIPBOARD_CLEAR_MS };
    },
    async remove(id) {
      if (await gate()) return "locked";
      used();
      if (!(await store.remove(id))) return "gone";
      await log("deleted", id);
      return "deleted";
    },
    async reset() {
      await store.wipe();
      await deps.key.destroy();
      lost = false;
      apply({ type: "lock" });
      await log("reset");
    },
    generate: (options) => generatePassword(options, deps.random),
    async prepareImport(bytes) {
      try {
        dropImport();
        const refused = await gate();
        if (refused) return refused;
        used();
        const file = readImportFile(bytes);
        if (!file.ok) return { kind: "refused", problem: file.problem };
        const format = detectFormat(file.header);
        if (!format) return { kind: "refused", problem: "unknown_format" };
        pending = planImport(file, format, await store.list());
        file.rows.length = 0;
        return { kind: "preview", preview: previewOf(pending) };
      } finally {
        bytes.fill(0);
      }
    },
    async commitImport(choices, prompt) {
      const refused = await gate();
      if (refused) return refused;
      const plan = pending;
      if (!plan) return { kind: "nothing_pending" };
      const saved = new Set((await store.list()).map((e) => e.id));
      const writes: { id: string; candidate: ImportPlan["candidates"][number] }[] = [];
      const counts: VaultImportCounts = { added: 0, replaced: 0, skipped: 0, refused: plan.refused.length };
      for (const c of plan.candidates) {
        const live = c.existing.filter((e) => saved.has(e.id));
        if (!live.length) {
          writes.push({ id: deps.newId(), candidate: c });
          counts.added++;
          continue;
        }
        const choice = choices[c.row] ?? DEFAULT_DUPLICATE_CHOICE;
        // Replace needs exactly one saved login to replace; with several, the user keeps both or skips.
        if (choice === "replace" && live.length === 1) {
          writes.push({ id: live[0]!.id, candidate: c });
          counts.replaced++;
        } else if (choice === "keep_both") {
          writes.push({ id: deps.newId(), candidate: c });
          counts.added++;
        } else counts.skipped++;
      }
      const r = await withKey(prompt, async (key) => {
        const sealed: { id: string; name: string; origins: string[]; sealed: string }[] = [];
        for (const w of writes) {
          sealed.push({ id: w.id, name: w.candidate.name, origins: w.candidate.origins, sealed: await sealSecrets(deps.cipher, key, w.id, w.candidate.secrets) });
        }
        await store.putAll(sealed, deps.now());
        return "ok" as const;
      });
      if (r !== "ok") return r;
      dropImport();
      used();
      const reason = `vault.imported added=${counts.added} replaced=${counts.replaced} skipped=${counts.skipped} refused=${counts.refused}`;
      // The summary is bound to the items it wrote by a hash of their hashes, never their ids or names.
      await log("imported", undefined, { reason, argsHash: sha256Hex(writes.map((w) => vaultItemHash(w.id)).sort().join("\n")) });
      return { kind: "imported", counts };
    },
    cancelImport: dropImport,
  };
}
