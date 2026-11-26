import { NativeModule, requireNativeModule } from "expo";

/**
 * The only thing JavaScript chooses about the system prompt: which of the module's own languages it speaks. The title,
 * the labels and every fact (amount, recipient, network, site) are the module's, read from the signed message.
 */
export type PromptLocale = "en" | "es-419";

declare class HermitApprovalKeyNative extends NativeModule {
  /** The key without a prompt: none, lost (retired by a fingerprint change), no_biometric, or ready with its public part. */
  state(): Promise<{ state: "none" | "lost" | "no_biometric" } | { state: "ready"; publicKey: string; level: "strongbox" | "tee" }>;
  /** A new key, proven by a fresh strong biometric over `message` (an enrollment challenge). Rejects with a code. */
  enroll(message: string, locale: PromptLocale): Promise<{ publicKey: string; level: "strongbox" | "tee"; signature: string }>;
  /**
   * One signature over one approval `message`, inside BiometricPrompt. Rejects with `code`: cancelled, lockout, lost,
   * expired, no_biometric, bad_message, busy, no_activity or failed.
   */
  sign(message: string, locale: PromptLocale): Promise<string>;
  /** Delete everything (SL-26). Idempotent. */
  destroy(): Promise<void>;
}

/** SL-37: the Keystore key that signs money and password approvals. Android only. */
export const HermitApprovalKey = requireNativeModule<HermitApprovalKeyNative>("HermitApprovalKey");
