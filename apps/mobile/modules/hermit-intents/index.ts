import { NativeModule, requireNativeModule } from "expo";
import type { IntentOutcome } from "@hermit/core";

declare class HermitIntentsNative extends NativeModule {
  /** Takes an IntentSpec as JSON. */
  open(specJson: string): Promise<IntentOutcome>;
}

/** Opens other apps prefilled (SL-58, FR-APP-01). Android only. */
export const HermitIntents = requireNativeModule<HermitIntentsNative>("HermitIntents");
