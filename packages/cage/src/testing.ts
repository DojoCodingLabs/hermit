import { p256 } from "@noble/curves/nist.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { spkiFromPublicKey } from "./signed-approval.ts";

/**
 * Tests only (`@hermit/cage/testing`, never imported by the app): a software P-256 key that behaves like the Keystore
 * approval key (SHA256withECDSA over the UTF-8 message, DER, S not normalized), so packages can test the signed
 * approval path end to end. A software key is never accepted on the phone: the native module enrolls only keys kept
 * in StrongBox or the TEE, and the cage trusts only the key the Keystore reports and the enrollment pinned.
 */
export function softwareApprovalKey(seedByte: number): { spki: string; sign(message: string): string } {
  const sk = p256.utils.randomSecretKey(new Uint8Array(48).fill(seedByte));
  return {
    spki: spkiFromPublicKey(p256.getPublicKey(sk, false)),
    sign: (message) => bytesToHex(p256.sign(utf8ToBytes(message), sk, { prehash: true, format: "der", lowS: false })),
  };
}
