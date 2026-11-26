import { ed25519Signer } from "@hermit/cage";
import { SECRET_KEYS, type SignerPort } from "@hermit/core";
import { plainSecret } from "./secure";

/** The signed log's device key (FR-ACT-01). No prompt: every step signs silently; it never leaves the store. */
export async function deviceSigner(): Promise<SignerPort> {
  return ed25519Signer(await plainSecret(SECRET_KEYS.auditSeed));
}
