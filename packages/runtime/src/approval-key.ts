import { APPROVAL_KEY_LEVELS, type ApprovalKeyLevel, type ApprovalKeyPort, type ApprovalKeyState, type SqlPort } from "@hermit/core";
import { createNonceStore, createSignedApprovals, enrollmentMessage, verifyEnrollment, type AuditLog, type SignedApprovals } from "@hermit/cage";

const bytesToHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

/**
 * SL-37 (US-CAGE-03, FR-CAGE-06): the approval key behind money and password approvals, as the app sees it.
 *
 * - The screen's state comes from the Keystore (read without a prompt) and the public key pinned at enrollment.
 *   A Keystore key that isn't the pinned one is treated as lost, never trusted.
 * - Setting it up (again) is a fresh strong biometric: the new key signs a random challenge inside the prompt, and
 *   only a signature that verifies with the new key's public part pins it. A lost key (new fingerprints enrolled)
 *   blocks money and passwords until this is done.
 * - The signed log gets a code only ("approval_key.enrolled"), never the key.
 */

/** Where the pinned public key lives (ENT-Setting). Erased with the database. */
export const APPROVAL_KEY_SETTING = "approval.key";

export interface EnrolledApprovalKey {
  publicKey: string;
  level: ApprovalKeyLevel;
  enrolledAt: number;
}

export type ApprovalKeyView =
  /** This build has no approval key module. */
  | { kind: "unavailable" }
  | { kind: "no_biometric" }
  | { kind: "not_set_up" }
  /** Retired by a fingerprint change (or replaced under the app): money and passwords are blocked until set up again. */
  | { kind: "lost" }
  | { kind: "ready"; level: ApprovalKeyLevel };

export type ApprovalKeyEnrollFailure = "cancelled" | "lockout" | "no_biometric" | "no_secure_hardware" | "failed";

export function approvalKeyView(state: ApprovalKeyState | undefined, enrolled: EnrolledApprovalKey | undefined): ApprovalKeyView {
  if (!state) return { kind: "unavailable" };
  if (state.state === "no_biometric") return { kind: "no_biometric" };
  if (!enrolled) return { kind: "not_set_up" };
  if (state.state !== "ready" || state.publicKey.toLowerCase() !== enrolled.publicKey.toLowerCase()) return { kind: "lost" };
  return { kind: "ready", level: state.level };
}

function parseEnrolled(raw: string | undefined): EnrolledApprovalKey | undefined {
  if (!raw) return undefined;
  try {
    const v = JSON.parse(raw) as Partial<EnrolledApprovalKey>;
    if (typeof v.publicKey !== "string" || !APPROVAL_KEY_LEVELS.includes(v.level as ApprovalKeyLevel) || typeof v.enrolledAt !== "number") return undefined;
    return { publicKey: v.publicKey, level: v.level as ApprovalKeyLevel, enrolledAt: v.enrolledAt };
  } catch {
    return undefined;
  }
}

const FAILURES: readonly ApprovalKeyEnrollFailure[] = ["cancelled", "lockout", "no_biometric", "no_secure_hardware"];

export interface ApprovalKeyService {
  view(): Promise<ApprovalKeyView>;
  /** A new key behind a fresh strong biometric. Any failure leaves money and passwords blocked, as they were. */
  enroll(locale: "en" | "es-419"): Promise<{ ok: true; view: ApprovalKeyView } | { ok: false; reason: ApprovalKeyEnrollFailure }>;
  /** What the loop verifies spend and credential approvals with (nonces in SQLite, the pinned key). */
  signedApprovals(): SignedApprovals;
}

export function createApprovalKey(deps: {
  port: ApprovalKeyPort;
  settings: { get(key: typeof APPROVAL_KEY_SETTING): Promise<string | undefined>; set(key: typeof APPROVAL_KEY_SETTING, value: string): Promise<void> };
  audit: Pick<AuditLog, "append">;
  randomBytes(n: number): Uint8Array;
  now(): number;
  /** Where used nonces are kept (migration 13), so a replay after a restart is still a replay. */
  sql: SqlPort;
}): ApprovalKeyService {
  const enrolled = async () => parseEnrolled(await deps.settings.get(APPROVAL_KEY_SETTING));
  const readState = () => deps.port.state().catch((): ApprovalKeyState => ({ state: "lost" }));
  let signed: SignedApprovals | undefined;
  return {
    async view() {
      const [state, pin] = await Promise.all([readState(), enrolled()]);
      return approvalKeyView(state, pin);
    },
    async enroll(locale) {
      const message = enrollmentMessage(bytesToHex(deps.randomBytes(32)), deps.now());
      let made;
      try {
        made = await deps.port.enroll(message, locale);
      } catch (e) {
        const code = (e as { code?: string }).code as ApprovalKeyEnrollFailure | undefined;
        return { ok: false, reason: code && FAILURES.includes(code) ? code : "failed" };
      }
      if (!verifyEnrollment(message, made.signature, made.publicKey)) {
        await deps.port.destroy().catch(() => {});
        return { ok: false, reason: "failed" };
      }
      const pin: EnrolledApprovalKey = { publicKey: made.publicKey.toLowerCase(), level: made.level, enrolledAt: deps.now() };
      await deps.settings.set(APPROVAL_KEY_SETTING, JSON.stringify(pin));
      await deps.audit.append({ ts: deps.now(), sessionId: "user", event: "approval_key", reason: "approval_key.enrolled" });
      return { ok: true, view: approvalKeyView(await readState(), pin) };
    },
    signedApprovals() {
      signed ??= createSignedApprovals({
        key: { state: readState },
        enrolledKey: async () => (await enrolled())?.publicKey,
        nonces: createNonceStore(deps.sql),
        randomNonce: () => bytesToHex(deps.randomBytes(32)),
        now: deps.now,
      });
      return signed;
    },
  };
}
