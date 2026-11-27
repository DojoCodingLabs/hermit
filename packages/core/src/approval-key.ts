import type { Money } from "./money.ts";

/**
 * SL-37 (US-CAGE-03, FR-CAGE-06, ADR-007): money and password approvals are signed by a non-exportable Android
 * Keystore key (EC P-256) inside a native module. The user's strong biometric unlocks exactly one signature over
 * exactly one payload; the cage verifies it with the key's public part before anything runs.
 *
 * The types live here because the approval port carries them; the logic (building, verifying, nonces) is in
 * `@hermit/cage` (`signed-approval.ts`).
 */

/** Domain separation: the first line of every signed approval message. A signature over anything else never verifies. */
export const SIGNED_APPROVAL_DOMAIN = "hermit.approval.v1";

/** Domain of the enrollment proof (a fresh strong biometric over a random challenge, never an approval). */
export const APPROVAL_KEY_ENROLL_DOMAIN = "hermit.approval-key.enroll.v1";

/** The risks whose approvals must carry a Keystore signature (FR-CAGE-06). */
export type SignedRisk = "spend" | "credential";

export const SIGNED_RISKS: readonly SignedRisk[] = ["spend", "credential"];

/**
 * What a spend or credential approval signs beyond the args hash, read by code from the exact arguments
 * (`SkillDef.approvalTerms`), never from model prose. Spend: amount and recipient. Credential: the site.
 */
export interface SignedApprovalTerms {
  amount?: Money;
  recipient?: string;
  origin?: string;
  /**
   * SL-36: a login. `item` is the vault item's id hash (`vaultItemHash`, 64 hex), never the id or its name;
   * `requester` is who receives the values by its verified identity, `android://<cert>@<package>` (the trusted
   * browser for a web page, the app itself for an app). Credential only.
   */
  item?: string;
  requester?: string;
}

/**
 * CT-07 for spend and credential: the canonical payload the Keystore key signs. Every field is a string or an
 * integer so it reads the same in Kotlin and TypeScript; the amount is base units as a decimal string (USD₮ only,
 * PDR-027). `nonce` is 32 random bytes in hex, used once; `expiresAt` is the approval sheet's own expiry.
 */
export interface SignedApprovalPayload {
  domain: typeof SIGNED_APPROVAL_DOMAIN;
  v: 1;
  risk: SignedRisk;
  skill: string;
  requestId: string;
  argsHash: string;
  nonce: string;
  /** Epoch ms. */
  issuedAt: number;
  /** Epoch ms. */
  expiresAt: number;
  amount?: { value: string; asset: "USDT"; network: string };
  recipient?: string;
  origin?: string;
  /** SL-36: the vault item's id hash (64 hex). */
  item?: string;
  /** SL-36: who receives the values, `android://<cert>@<package>`. */
  requester?: string;
}

/** What the approval sheet hands to the native signer: the payload and the exact message bytes (UTF-8) it signs. */
export interface SignedApprovalRequest {
  payload: SignedApprovalPayload;
  message: string;
}

/**
 * Where the key is kept: Android's StrongBox or TEE, or an iPhone's Secure Enclave. Software keys are refused at
 * enrollment, so there is no "software" level.
 */
export const APPROVAL_KEY_LEVELS = ["strongbox", "tee", "secure_enclave"] as const;
export type ApprovalKeyLevel = (typeof APPROVAL_KEY_LEVELS)[number];

/**
 * The Keystore key as the native module sees it, read without a prompt.
 * - none: never set up (or erased).
 * - lost: retired because a fingerprint (or on iOS a face or a finger) was added or removed (Android's
 *   `KeyPermanentlyInvalidatedException`, iOS's `.biometryCurrentSet`).
 * - no_biometric: the phone has no strong biometric enrolled, so a key that needs one can't be made or used.
 * - ready: usable; `publicKey` is the X.509 SubjectPublicKeyInfo in lowercase hex.
 */
export type ApprovalKeyState =
  | { state: "none" }
  | { state: "lost" }
  | { state: "no_biometric" }
  | { state: "ready"; publicKey: string; level: ApprovalKeyLevel };

/** The Keystore approval key (apps/mobile/modules/hermit-approval-key). A fake in tests. */
export interface ApprovalKeyPort {
  state(): Promise<ApprovalKeyState>;
  /**
   * Replaces any key with a new one and proves it with a fresh strong biometric: the new key signs `message`
   * (an enrollment challenge) inside BiometricPrompt. Cancelled or failed: it throws and no key is left. The prompt's
   * words are the native module's own, in `locale`; no display text crosses from JavaScript.
   */
  enroll(message: string, locale: "en" | "es-419"): Promise<{ publicKey: string; level: ApprovalKeyLevel; signature: string }>;
  /** Delete everything (SL-26): destroys the key. Idempotent. */
  destroy(): Promise<void>;
}
