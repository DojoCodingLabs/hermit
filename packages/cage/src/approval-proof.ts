import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

/**
 * Proof that the user approved this exact action: HMAC with the biometric-gated
 * approval key (read only after BiometricPrompt) over the argsHash and request id.
 */
export function approvalProof(key: Uint8Array, argsHash: string, requestId: string): string {
  return bytesToHex(hmac(sha256, key, utf8ToBytes(`${argsHash}\n${requestId}`)));
}

export function verifyApprovalProof(key: Uint8Array, argsHash: string, requestId: string, proof: string): boolean {
  const expected = approvalProof(key, argsHash, requestId);
  if (proof.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ proof.charCodeAt(i);
  return diff === 0;
}
