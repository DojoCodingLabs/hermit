import { approvalProof, verifyApprovalProof } from "@hermit/cage";
import { SECRET_KEYS, type ApprovalOutcome, type ApprovalRequest } from "@hermit/core";
import { gatedSecret, provisionGatedSecret } from "./secure";

/**
 * US-APPR-02 / FR-CAGE-03 (ADR-007, JS key until W5): the approval key lives in SecureStore behind
 * requireAuthentication, so reading it IS the fingerprint check. The key signs the request's args hash
 * and id; the runtime verifies that proof once and the key is forgotten.
 */
const KEY = SECRET_KEYS.approval;
let unlocked: Uint8Array | undefined;

export async function authenticateApproval(req: ApprovalRequest, prompt: string): Promise<{ biometric: boolean; proof: string }> {
  // The read is the fingerprint prompt. Cancelled, failed, missing or invalidated: it throws and the sheet denies.
  const key = await gatedSecret(KEY, prompt);
  unlocked = key;
  return { biometric: true, proof: approvalProof(key, req.call.argsHash, req.id) };
}

/** Onboarding (and settings, after fingerprints change): create the approval key behind a strong-biometric check. */
export function provisionApprovalKey(prompt: string): Promise<boolean> {
  return provisionGatedSecret(KEY, prompt);
}

/** Passed to the runtime as verifyApproval: true only for a proof made with the key just unlocked. */
export function verifyApproval(req: ApprovalRequest, outcome: Extract<ApprovalOutcome, { kind: "approved" }>): boolean {
  const key = unlocked;
  unlocked = undefined;
  return key !== undefined && outcome.proof !== undefined && verifyApprovalProof(key, req.call.argsHash, req.id, outcome.proof);
}
