import { NativeModule, requireOptionalNativeModule } from "expo";

export interface AutofillStatus {
  /** Android offers autofill on this phone. */
  supported: boolean;
  /** Hermit is the selected autofill service. */
  selected: boolean;
  /** A debuggable build: only these record the last request for hermit://autofill-debug. */
  debug: boolean;
  sdk: number;
}

declare class HermitAutofillNative extends NativeModule {
  status(): AutofillStatus;
  /** Which page opened: Android's picker, the Passwords, passkeys and autofill page, or the settings home. */
  openSettings(): "picker" | "credential_settings" | "settings";
  /** SL-35: the kinds the profile can fill and which are sensitive. Never a value. */
  setProfileIndex(kinds: string[], sensitive: string[]): void;
  /** SL-36: the vault logins as JSON (LoginIndexEntry[]): id hash, name and exact origins. Never a username or a password. */
  setLoginIndex(json: string): void;
  /** SL-35: the fill waiting for HM-FORM-01 as JSON (NativeFillRequest), or null when it ended. Never a value. */
  pendingFill(id: string): string | null;
  /** SL-35: hands the approved values (by field key) to Android and goes back to the form. False when it ended. */
  completeFill(id: string, values: Record<string, string>): boolean;
  /** SL-35: nothing is filled; back to the form. False when it ended. */
  cancelFill(id: string): boolean;
  /** JSON of the last fill request: package, certificate digests, web origins, kinds found, verdict. Never a value. Debug builds only. */
  lastRequest(): string | null;
}

/**
 * Hermit's Android autofill service (SL-20, SL-35). Android only. Optional, so a phone still on an APK built before
 * this module (JS from Metro) gets null instead of a crash.
 */
export const HermitAutofill = requireOptionalNativeModule<HermitAutofillNative>("HermitAutofill");
