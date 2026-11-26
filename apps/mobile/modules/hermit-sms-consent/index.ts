import { NativeModule, requireOptionalNativeModule } from "expo";
import type { SmsNext } from "../../src/sms-code";

declare class HermitSmsConsentNative extends NativeModule {
  /** SL-56b: starts Android's SMS User Consent listener; false without Play services. */
  start(): Promise<boolean>;
  /** Waits for the caught message, then shows Android's dialog for it. */
  next(timeoutMs: number): Promise<SmsNext>;
  stop(): void;
}

/** The SMS User Consent API (SL-56b). Null on an APK built without the module. Android only. */
export const HermitSmsConsent = requireOptionalNativeModule<HermitSmsConsentNative>("HermitSmsConsent");
