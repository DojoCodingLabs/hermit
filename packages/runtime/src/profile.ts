import {
  ALWAYS_SENSITIVE, createProfileStore, createVaultStore, keyMatches, profileIndex, sealProfileValue, validateProfileValue,
  type FormKind, type ProfileKind, type ProfileProblem, type SqlPort, type VaultCipherPort, type VaultKeyPort,
} from "@hermit/core";
import type { AuditLog } from "@hermit/cage";

/**
 * SL-35 (US-FORM-03): the personal profile HM-FORM-02 edits. It is never a skill and is never on the model's menu.
 *
 * A field that is not sensitive is stored as typed in the encrypted database and listed on the screen. A sensitive one
 * (every ID number, and any field the user marks) is sealed with the vault key behind the vault's own fingerprint, and
 * is never shown again: the screen says it is saved and protected, and only a fill (HM-FORM-01) opens it.
 * Every change is signed in the log as the user's own act (`profile.saved`, `profile.deleted`), without the kind or
 * the value, and pushes the kinds-only index the autofill service reads.
 */

export interface ProfileDeps {
  sql: SqlPort;
  audit: AuditLog;
  key: VaultKeyPort;
  cipher: VaultCipherPort;
  now(): number;
  /** The kinds the profile can fill and which are sensitive, never a value: the app hands it to the autofill service. */
  onIndex?(index: { kinds: FormKind[]; sensitive: FormKind[] }): void | Promise<void>;
}

/** A row of HM-FORM-02. `value` only for a field that is not sensitive. `locked`: an ID number, always sensitive. */
export interface ProfileFieldView {
  kind: ProfileKind;
  sensitive: boolean;
  locked: boolean;
  value?: string;
}

export type ProfileSave =
  | { kind: "saved" }
  | { kind: "invalid"; problem: ProfileProblem }
  /** A sensitive field needs the vault (its key seals the value): HM-FORM-02 links to HM-VAULT-01. */
  | { kind: "no_vault" }
  | { kind: "lost" }
  | { kind: "cancelled" };

export interface Profile {
  list(): Promise<ProfileFieldView[]>;
  /** `sensitive` is the user's mark; ID numbers are sensitive whatever it says. */
  save(kind: ProfileKind, value: string, sensitive: boolean, prompt: string): Promise<ProfileSave>;
  remove(kind: ProfileKind): Promise<"deleted" | "gone">;
  index(): Promise<{ kinds: FormKind[]; sensitive: FormKind[] }>;
  /** Pushes the index again (at launch, after the vault starts over). */
  sync(): Promise<void>;
}

const PROFILE_SESSION = "user";

export function createProfile(deps: ProfileDeps): Profile {
  const store = createProfileStore(deps.sql);
  const vaultStore = createVaultStore(deps.sql);

  const log = (action: "saved" | "deleted") =>
    deps.audit.append({ ts: deps.now(), sessionId: PROFILE_SESSION, event: "vault", skill: "profile", outcome: "ok", reason: `profile.${action}` });

  const index = async () => profileIndex(await store.list());
  const sync = async () => {
    if (deps.onIndex) await deps.onIndex(await index());
  };

  /** Seals with the vault key behind its fingerprint, checking the key is this vault's; the key is zeroed after. */
  async function seal(kind: ProfileKind, value: string, prompt: string): Promise<{ sealed: string } | ProfileSave> {
    const check = await vaultStore.keyCheck();
    if (!check) return { kind: "no_vault" };
    if (!(await deps.key.exists())) return { kind: "lost" };
    const got = await deps.key.unwrap(prompt);
    if (got.kind === "cancelled") return { kind: "cancelled" };
    if (got.kind === "lost") return { kind: "lost" };
    try {
      if (!(await keyMatches(deps.cipher, got.key, check))) return { kind: "lost" };
      return { sealed: await sealProfileValue(deps.cipher, got.key, kind, value) };
    } finally {
      got.key.fill(0);
    }
  }

  return {
    async list() {
      return (await store.list()).map((r): ProfileFieldView => {
        const locked = ALWAYS_SENSITIVE.has(r.kind);
        return r.sensitive ? { kind: r.kind, sensitive: true, locked } : { kind: r.kind, sensitive: false, locked, value: r.value };
      });
    },
    async save(kind, raw, sensitiveMark, prompt) {
      const v = validateProfileValue(kind, raw);
      if (!v.ok) return { kind: "invalid", problem: v.problem };
      const sensitive = sensitiveMark || ALWAYS_SENSITIVE.has(kind);
      if (sensitive) {
        const r = await seal(kind, v.value, prompt);
        if (!("sealed" in r)) return r;
        await store.put({ kind, sensitive: true, sealed: r.sealed }, deps.now());
      } else {
        await store.put({ kind, sensitive: false, value: v.value }, deps.now());
      }
      await log("saved");
      await sync();
      return { kind: "saved" };
    },
    async remove(kind) {
      if (!(await store.remove(kind))) return "gone";
      await log("deleted");
      await sync();
      return "deleted";
    },
    index,
    sync,
  };
}
