import * as Crypto from "expo-crypto";
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
export const fromHex = (s: string) => new Uint8Array((s.match(/../g) ?? []).map((h) => parseInt(h, 16)));

/** A 32-byte secret that needs no authentication (the audit seed). Created on first use. */
export async function plainSecret(key: string): Promise<Uint8Array> {
  const existing = await SecureStore.getItemAsync(key);
  if (existing) return fromHex(existing);
  const fresh = Crypto.getRandomBytes(32);
  await SecureStore.setItemAsync(key, hex(fresh));
  return fresh;
}

export class MissingSecretError extends Error {
  constructor(key: string) {
    super(`Secret ${key} is missing or was invalidated; it must be provisioned again behind a fingerprint.`);
    this.name = "MissingSecretError";
  }
}

/**
 * Reads a biometric-gated secret: the read itself shows the fingerprint prompt. It is never created here.
 * A missing or invalidated value (Android invalidates these when fingerprints change) throws, so the
 * caller fails closed instead of minting a key no one authenticated for.
 */
export async function gatedSecret(key: string, prompt: string): Promise<Uint8Array> {
  const value = await SecureStore.getItemAsync(key, { requireAuthentication: true, authenticationPrompt: prompt });
  if (!value) throw new MissingSecretError(key);
  return fromHex(value);
}

/**
 * Creates (or replaces) a biometric-gated secret, only after an explicit strong-biometric check with no
 * PIN fallback. Called from onboarding and from settings after fingerprints change, never from an approval.
 */
export async function provisionGatedSecret(key: string, prompt: string): Promise<boolean> {
  const auth = await LocalAuthentication.authenticateAsync({ promptMessage: prompt, biometricsSecurityLevel: "strong", disableDeviceFallback: true });
  if (!auth.success) return false;
  await SecureStore.setItemAsync(key, hex(Crypto.getRandomBytes(32)), { requireAuthentication: true, authenticationPrompt: prompt });
  return true;
}

/** A plain secret if it exists, without creating one (an erase resuming at launch must not mint a key). */
export async function existingPlainSecret(key: string): Promise<Uint8Array | undefined> {
  const value = await SecureStore.getItemAsync(key);
  return value ? fromHex(value) : undefined;
}

/** Removes a secret, gated or not, without reading it. Removing one already gone succeeds. */
export async function deleteSecret(key: string): Promise<void> {
  await SecureStore.deleteItemAsync(key);
}
