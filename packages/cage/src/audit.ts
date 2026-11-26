import { ed25519 } from "@noble/curves/ed25519.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { canonicalJson, sha256Hex, type SignerPort } from "@hermit/core";
import type { Effect } from "./policy.ts";

export type AuditEvent =
  | "call_proposed" | "policy_decided" | "approval" | "executed" | "taint_added" | "memory_write"
  /** FR-ACT-04: the genesis of a new chain after the user cleared the log. */
  | "log_cleared"
  /** SL-24, US-NIGHT-03: a night shift job ran, failed, paused or was skipped (its reason is a code). */
  | "night_job"
  /**
   * SL-33: the user's own vault action (created, added, edited, deleted, revealed, copied, reset). `argsHash` is the
   * hash of the item id (`vaultItemHash`) and `reason` the action code; never a name, an origin or a secret.
   */
  | "vault"
  /** SL-37: the Keystore approval key was set up or set up again (`reason`: "approval_key.enrolled"). A code only. */
  | "approval_key"
  /**
   * SL-55 (US-CONN-05): the user installed or removed a connector. `argsHash` is the spec's hash (FR-CONN-08), the one
   * the fingerprint approved; `reason` the action code ("connector.installed", "connector.removed"). Never a key.
   */
  | "connector"
  /**
   * SL-38 (US-PAY-01, US-PAY-02): the user created, backed up, restored or started over the wallet. `argsHash` is the
   * hash of the wallet id (`walletIdHash`), `reason` the action code ("wallet.created"); never an address or a word.
   */
  | "wallet"
  /**
   * SL-53 (FR-WEB-08, US-WEB-11): the user's own act on a web task or a recipe: took over, resumed, stopped, saved or
   * removed a recipe, cleared a site's data. `argsHash` is the hash of the task or recipe id; `reason` the action code
   * ("web.taken_over", "web.stopped", "web.recipe_saved"). Never a value, an address or page text.
   */
  | "web_task"
  /**
   * SL-40 (US-PAY-06, PDR-011): the user changed the spending caps or saved or removed a payee on HM-PAY-05, behind a
   * fingerprint. `argsHash` is the hash of the new caps or of the payee id, `reason` the action code ("caps.changed",
   * "payee.saved", "payee.removed"); never a name or an address.
   */
  | "spending"
  /**
   * Multi-bot (HM-BOT-01 to 04): the user changed a bot or a permission mode. `sessionId` is the bot's id ("user" for the
   * global mode), `reason` the action code ("bot.created", "bot.granted", "bot.note_shared", "mode.dont_ask",
   * "mode.inherit"); never a name, a role or a note. It carries the bot it changed as `bot`, so Activity names it; the
   * global mode is about no bot and carries none.
   */
  | "bot";

/** Metadata only: never message bodies or raw arguments, only their hash. */
export interface AuditEntry {
  seq: number;
  ts: number;
  sessionId: string;
  event: AuditEvent;
  skill?: string;
  argsHash?: string;
  decision?: Effect;
  outcome?: "ok" | "error" | "denied" | "expired";
  /** log_cleared only: how many entries the clear removed (FR-ACT-04). */
  clearedCount?: number;
  /** night_job: why a job paused or was skipped ("paused.hot", SL-24); vault: the action ("vault.revealed", SL-33). A code, never text. */
  reason?: string;
  /**
   * SL-37 (US-CAGE-03): on the approval of a spend or credential call, the SHA-256 of the exact signed message and
   * the Keystore key's signature over it (DER, hex). Verifiable with the approval key's public part; never the payload.
   */
  payloadHash?: string;
  approvalSig?: string;
  /**
   * Multi-bot ("the signed log records bot ids"): the id of the bot whose turn wrote this entry, or the bot the user's own
   * act was about (a `bot` entry, a note deleted from its settings), so the log still says which bot it was after its
   * chats are gone. Absent on what no bot ran (the night shift, the screens' other acts, the global mode) and on every
   * entry written before bots.
   */
  bot?: string;
  /** The previous entry's hash; on a log_cleared genesis, the head hash of the chain it replaced. */
  prevHash: string;
  hash: string;
  sig: string;
}

export type AuditInput = Omit<AuditEntry, "seq" | "prevHash" | "hash" | "sig">;

export const GENESIS_HASH = "0".repeat(64);

/**
 * Hashes a fixed tuple, with null for absent optional fields, so an entry hashes
 * the same before and after a SQLite round trip (where missing columns come back NULL).
 * The cleared count, the night reason, the signed approval's hash and signature and the bot are appended only when
 * present, so every entry written before SL-32, SL-24, SL-37 and bots hashes as it did. The reason goes in as a one-key
 * object, so it can never read as a count.
 */
function entryHash(e: Omit<AuditEntry, "hash" | "sig">): string {
  const tuple: unknown[] = [e.seq, e.ts, e.sessionId, e.event, e.skill ?? null, e.argsHash ?? null, e.decision ?? null, e.outcome ?? null];
  if (e.clearedCount !== undefined) tuple.push(e.clearedCount);
  if (e.reason !== undefined) tuple.push({ reason: e.reason });
  // SL-37: the same rule, so every older entry hashes as it did; a one-key object each, so neither reads as the other.
  if (e.payloadHash !== undefined) tuple.push({ payloadHash: e.payloadHash });
  if (e.approvalSig !== undefined) tuple.push({ approvalSig: e.approvalSig });
  // Multi-bot: the same rule again, so entries from before bots verify as they did and the bot can't be changed.
  if (e.bot !== undefined) tuple.push({ bot: e.bot });
  return sha256Hex(e.prevHash + canonicalJson(tuple));
}

export async function appendEntry(prev: AuditEntry | null, input: AuditInput, signer: SignerPort): Promise<AuditEntry> {
  return signEntry({ ...input, seq: (prev?.seq ?? 0) + 1, prevHash: prev?.hash ?? GENESIS_HASH }, signer);
}

/**
 * FR-ACT-04, PDR-012: the genesis of the chain that replaces a cleared one. It links to the old head
 * (the zero hash if there was none) and carries the count; the hash and signature cover both.
 */
export async function clearedGenesis(
  oldHead: AuditEntry | null,
  count: number,
  input: Pick<AuditInput, "ts" | "sessionId">,
  signer: SignerPort,
): Promise<AuditEntry> {
  return signEntry(
    { ts: input.ts, sessionId: input.sessionId, event: "log_cleared", clearedCount: count, seq: 1, prevHash: oldHead?.hash ?? GENESIS_HASH },
    signer,
  );
}

async function signEntry(unsigned: Omit<AuditEntry, "hash" | "sig">, signer: SignerPort): Promise<AuditEntry> {
  const hash = entryHash(unsigned);
  const sig = bytesToHex(await signer.sign(hexToBytes(hash)));
  return { ...unsigned, hash, sig };
}

/** Recomputes every hash, checks sequence and linkage, and verifies every signature. */
export function verifyChain(
  entries: AuditEntry[],
  publicKey: Uint8Array,
): { ok: true } | { ok: false; badSeq: number; reason: string } {
  let prevHash = GENESIS_HASH;
  for (const [i, e] of entries.entries()) {
    const expectedSeq = i + 1;
    const { hash, sig, ...unsigned } = e;
    if (e.seq !== expectedSeq) return { ok: false, badSeq: expectedSeq, reason: `expected seq ${expectedSeq}, found ${e.seq}` };
    // A log_cleared genesis links to the replaced chain's head, which is gone; its signature vouches for the link.
    const isClearedGenesis = i === 0 && e.event === "log_cleared" && /^[0-9a-f]{64}$/.test(e.prevHash);
    if (!isClearedGenesis && e.prevHash !== prevHash) return { ok: false, badSeq: e.seq, reason: "broken link to previous entry" };
    if (entryHash(unsigned) !== hash) return { ok: false, badSeq: e.seq, reason: "entry was modified" };
    let signed: boolean;
    try {
      signed = ed25519.verify(hexToBytes(sig), hexToBytes(hash), publicKey);
    } catch {
      return { ok: false, badSeq: e.seq, reason: "malformed entry" };
    }
    if (!signed) return { ok: false, badSeq: e.seq, reason: "bad signature" };
    prevHash = hash;
  }
  return { ok: true };
}

/** Software signer from a 32-byte seed (kept in secure storage on the phone). */
export function ed25519Signer(seed: Uint8Array): SignerPort {
  return {
    publicKey: async () => ed25519.getPublicKey(seed),
    sign: async (message) => ed25519.sign(message, seed),
  };
}
