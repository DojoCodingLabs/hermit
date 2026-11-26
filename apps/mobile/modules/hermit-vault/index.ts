import { NativeModule, requireNativeModule } from "expo";

declare class HermitVaultNative extends NativeModule {
  /** A wrapped value and its Keystore key both exist (checked without a fingerprint prompt). */
  hasWrappedKey(service: string, key: string): Promise<boolean>;
  /** Delete everything: empties and deletes these private SharedPreferences files (idempotent). */
  deletePreferences(names: string[]): Promise<void>;
  /** Destroys the Keystore keys expo-secure-store made for `service` (SecureStore's delete leaves them). */
  destroyKeystoreKey(service: string): Promise<void>;
  /** FLAG_SECURE on the activity's window: no screenshots, recordings or Recents preview. False without an activity. */
  setSecureScreen(on: boolean): Promise<boolean>;
  /** Copies `text` as a sensitive clip and clears it after `clearAfterMs` unless something else was copied since (Q82). */
  copySensitive(text: string, clearAfterMs: number): Promise<void>;
  /**
   * SL-39 (HM-PAY-04): copies public text (a wallet address) as a plain clip, marked not sensitive, with no clear
   * timer. It replaces any pending sensitive copy, whose timer then leaves the clipboard alone.
   */
  copyPlain(text: string): Promise<void>;
  /** Clears a copy still waiting for its timer, now. */
  clearPendingCopy(): Promise<void>;
  /** SL-34: the system document picker for one CSV; null when the user backs out. Needs no storage permission. */
  pickCsv(): Promise<PickedDocument | null>;
  /** The picked file's bytes, read into memory only; rejects with ERR_TOO_LARGE past `maxBytes`, ERR_UNREADABLE otherwise. */
  readDocument(uri: string, maxBytes: number): Promise<Uint8Array>;
  /** Deletes the picked file through the picker's grant; false when its provider refuses or can't. */
  deleteDocument(uri: string): Promise<boolean>;
}

export interface PickedDocument {
  uri: string;
  name: string | null;
  size: number | null;
  /** The provider says it can delete this file (DocumentsContract FLAG_SUPPORTS_DELETE). */
  canDelete: boolean;
}

/** SL-33: the vault's native pieces. Android only. */
export const HermitVault = requireNativeModule<HermitVaultNative>("HermitVault");
