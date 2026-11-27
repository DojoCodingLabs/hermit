import { AppState, Platform } from "react-native";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { VAULT_KEY, type SecureRandom, type VaultCipherPort, type VaultKeyPort } from "@hermit/core";
import { HermitVault, type PickedDocument } from "../../modules/hermit-vault";
import { fromHex, keychain } from "./secure";
import { trackPrompt } from "./app-lock";

/**
 * SL-33 (FR-VAULT-01): the vault's phone adapters.
 *
 * The vault key is a random 32-byte key stored only through expo-secure-store with `requireAuthentication` under its
 * own keychain service. On Android that wraps it with an AES-GCM Keystore key that needs a strong biometric for every
 * use (no validity window, no PIN), can't be exported and is invalidated when fingerprints are added: a read then
 * returns null, which is "lost". Sealing uses expo-crypto's native AES-GCM, so no new crypto dependency.
 */

const VAULT_KEY_LENGTH = 32;
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

/**
 * A random 32-byte key wrapped by its own strong-biometric Keystore key, under its own keychain service. The vault key
 * (SL-33) and the wallet key (SL-38) are both made this way, each under its own service, so neither unwraps the other.
 */
export function wrappedKeyPort(entry: { key: string; service: string }): VaultKeyPort {
  const OPTIONS = { keychainService: entry.service } as const;
  return {
    // A SecureStore read of this entry always prompts, so the module checks for it natively, without one.
    exists: () => HermitVault.hasWrappedKey(entry.service, entry.key),
    async store(key, prompt) {
      // iOS: no hardware-backed wrapped key exists there yet, so no vault or wallet key is ever made (fails closed).
      if (Platform.OS !== "android") return "unavailable";
      if (!SecureStore.canUseBiometricAuthentication()) return "unavailable";
      try {
        // trackPrompt: the app lock must not read the prompt's trip away as the user leaving.
        await trackPrompt(() => SecureStore.setItemAsync(entry.key, hex(key), keychain({ ...OPTIONS, requireAuthentication: true, authenticationPrompt: prompt })));
        return "stored";
      } catch {
        return "cancelled";
      }
    },
    async unwrap(prompt) {
      let value: string | null;
      try {
        value = await trackPrompt(() => SecureStore.getItemAsync(entry.key, { ...OPTIONS, requireAuthentication: true, authenticationPrompt: prompt }));
      } catch {
        // Cancelled, locked out, timed out: nothing is unwrapped, nothing is lost.
        return { kind: "cancelled" };
      }
      if (value === null) return { kind: "lost" };
      const key = fromHex(value);
      return key.length === VAULT_KEY_LENGTH ? { kind: "key", key } : { kind: "lost" };
    },
    async destroy() {
      await SecureStore.deleteItemAsync(entry.key, { ...OPTIONS, requireAuthentication: true });
      await HermitVault.destroyKeystoreKey(entry.service);
    },
  };
}

export const vaultKeyPort: VaultKeyPort = wrappedKeyPort(VAULT_KEY);


/** expo-crypto 58's native AES-256-GCM; sealed = iv(12) ‖ ciphertext ‖ tag(16), the layout the tests use. */
export const vaultCipher: VaultCipherPort = {
  async seal(key, plaintext, aad) {
    const k = await Crypto.AESEncryptionKey.import(key);
    const sealed = await Crypto.aesEncryptAsync(plaintext, k, { nonce: { length: 12 }, tagLength: 16, additionalData: aad });
    return sealed.combined();
  },
  async open(key, sealed, aad) {
    const k = await Crypto.AESEncryptionKey.import(key);
    const data = Crypto.AESSealedData.fromCombined(sealed, { ivLength: 12, tagLength: 16 });
    return Crypto.aesDecryptAsync(data, k, { additionalData: aad });
  },
};

export const vaultRandom: SecureRandom = (n) => Crypto.getRandomBytes(n);

/** Reveal and copy only while Hermit is on screen. */
export const vaultOnScreen = () => AppState.currentState === "active";

/** A copy still waiting for its timer is cleared now (unless something else was copied since). */
export const clearPendingCopy = () => HermitVault.clearPendingCopy().catch(() => {});

/** The vault port for createHermit. Locking (Lock now, the app lock, idle) clears a pending copy. */
export const vaultPorts = { key: vaultKeyPort, cipher: vaultCipher, random: vaultRandom, onScreen: vaultOnScreen, onLocked: () => void clearPendingCopy() };

/** Delete everything's `destroy_vault_key` step (idempotent). */
export const destroyVaultKey = () => vaultKeyPort.destroy();

/** A sensitive clip, cleared by the native timer after `clearAfterMs` unless replaced (Q82). */
export const copySensitive = (value: string, clearAfterMs: number) => HermitVault.copySensitive(value, clearAfterMs);

/** FLAG_SECURE while a vault screen is mounted: no screenshots, recordings or Recents preview. */
export const secureScreen = (on: boolean) => HermitVault.setSecureScreen(on).catch(() => false);

export type { PickedDocument };

/** SL-34: the system document picker for the import's CSV. No storage permission: the picker grants this one file. */
export async function pickCsvFile(): Promise<{ kind: "picked"; file: PickedDocument } | { kind: "cancelled" } | { kind: "no_picker" }> {
  try {
    const file = await HermitVault.pickCsv();
    return file ? { kind: "picked", file } : { kind: "cancelled" };
  } catch {
    return { kind: "no_picker" };
  }
}

/** The picked file's bytes, read straight into memory (no cache copy); the vault service zeroes them once parsed. */
export async function readCsvFile(uri: string, maxBytes: number): Promise<{ kind: "bytes"; bytes: Uint8Array } | { kind: "too_large" } | { kind: "unreadable" }> {
  try {
    return { kind: "bytes", bytes: await HermitVault.readDocument(uri, maxBytes) };
  } catch (e) {
    return (e as { code?: string }).code === "ERR_TOO_LARGE" ? { kind: "too_large" } : { kind: "unreadable" };
  }
}

/** Deletes the picked file through the picker's grant, after the user confirms; false when its provider can't. */
export const deleteCsvFile = (uri: string) => HermitVault.deleteDocument(uri).catch(() => false);
