import { Platform } from "react-native";
import * as Crypto from "expo-crypto";
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";
import { HermitVault } from "../../modules/hermit-vault";
import { deviceOnly, gatedNeedsMove } from "../backup-guard";

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
export const fromHex = (s: string) => new Uint8Array((s.match(/../g) ?? []).map((h) => parseInt(h, 16)));

/**
 * #126: the options for every SecureStore write. On iOS the item is WhenUnlockedThisDeviceOnly, so it never moves to
 * another phone through an iCloud or computer backup; on Android the options are passed through untouched.
 */
export function keychain<T extends object>(options?: T) {
  return deviceOnly(Platform.OS, SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY, options);
}

/** Only to put back a gated item whose move failed: the class it had before (expo-secure-store's default). */
const keychainAsBefore = <T extends object>(options: T) => ({ ...options, keychainAccessible: SecureStore.WHEN_UNLOCKED });

/** A 32-byte secret that needs no authentication (the audit seed). Created on first use. */
export async function plainSecret(key: string): Promise<Uint8Array> {
  const existing = await SecureStore.getItemAsync(key);
  if (existing) return fromHex(existing);
  const fresh = Crypto.getRandomBytes(32);
  await SecureStore.setItemAsync(key, hex(fresh), keychain());
  return fresh;
}

/**
 * #126, iOS: a gated item written before ThisDeviceOnly moves right after the user's own authenticated read, so it never
 * shows Face ID on its own. Changing it in place would ask for Face ID again, so it is deleted and added again with the
 * value just read (adding one shows no prompt), then its class is read back. If the add fails it is added back as it was.
 * Never throws: the approval that read it goes on either way.
 */
async function moveGated(key: string, value: string, prompt: string): Promise<void> {
  if (Platform.OS !== "ios") return;
  try {
    if (!gatedNeedsMove(await HermitVault.keychainAccessibility("app:auth", key))) return;
    await SecureStore.deleteItemAsync(key);
    try {
      await SecureStore.setItemAsync(key, value, keychain({ requireAuthentication: true, authenticationPrompt: prompt }));
    } catch (err) {
      // Put back as it was (the old default class), so a failed move never loses the key.
      await SecureStore.setItemAsync(key, value, keychainAsBefore({ requireAuthentication: true, authenticationPrompt: prompt }));
      throw err;
    }
    console.log(`[hermit:keychain] ${key} moved: ${await HermitVault.keychainAccessibility("app:auth", key)}`);
  } catch (err) {
    console.log(`[hermit:keychain] ${key} not moved: ${err instanceof Error ? err.message : String(err)}`);
  }
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
  await moveGated(key, value, prompt);
  return fromHex(value);
}

/**
 * Creates (or replaces) a biometric-gated secret, only after an explicit strong-biometric check with no
 * PIN fallback. Called from onboarding and from settings after fingerprints change, never from an approval.
 */
export async function provisionGatedSecret(key: string, prompt: string): Promise<boolean> {
  const auth = await LocalAuthentication.authenticateAsync({ promptMessage: prompt, biometricsSecurityLevel: "strong", disableDeviceFallback: true });
  if (!auth.success) return false;
  // iOS: replacing a gated item in place would ask for Face ID again, and may keep its old class; it is replaced anyway.
  if (Platform.OS === "ios") await SecureStore.deleteItemAsync(key);
  await SecureStore.setItemAsync(key, hex(Crypto.getRandomBytes(32)), keychain({ requireAuthentication: true, authenticationPrompt: prompt }));
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
