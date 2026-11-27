import { NativeModule, requireNativeModule } from "expo";
import type { ApprovalKeyLevel } from "@hermit/core";

/**
 * The only thing JavaScript chooses about the system prompt: which of the module's own languages it speaks. The title,
 * the labels and every fact (amount, recipient, network, site) are the module's, read from the signed message.
 */
export type PromptLocale = "en" | "es-419";

declare class HermitApprovalKeyNative extends NativeModule {
  /** The key without a prompt: none, lost (retired by a biometric change), no_biometric, or ready with its public part. */
  state(): Promise<{ state: "none" | "lost" | "no_biometric" } | { state: "ready"; publicKey: string; level: ApprovalKeyLevel }>;
  /** A new key, proven by a fresh strong biometric over `message` (an enrollment challenge). Rejects with a code. */
  enroll(message: string, locale: PromptLocale): Promise<{ publicKey: string; level: ApprovalKeyLevel; signature: string }>;
  /**
   * One signature over one approval `message`, inside BiometricPrompt (Android) or Face ID or Touch ID (iOS). Rejects
   * with `code`: cancelled, lockout, lost, expired, no_biometric, bad_message, busy, no_activity or failed.
   */
  sign(message: string, locale: PromptLocale): Promise<string>;
  /** Delete everything (SL-26). Idempotent. */
  destroy(): Promise<void>;
}

/** SL-37: the key that signs money and password approvals: Android Keystore, or the Secure Enclave on an iPhone. */
export const HermitApprovalKey = requireNativeModule<HermitApprovalKeyNative>("HermitApprovalKey");
