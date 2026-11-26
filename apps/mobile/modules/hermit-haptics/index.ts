import { NativeModule, requireOptionalNativeModule } from "expo";

declare class HermitHapticsNative extends NativeModule {
  /** Plays the system's feedback for `kind` on the activity's window; false when there is no window. */
  perform(kind: "confirm" | "reject" | "tick"): Promise<boolean>;
}

/** Touch feedback with no permission (View.performHapticFeedback). Android only; undefined in a build without it. */
export const HermitHaptics = requireOptionalNativeModule<HermitHapticsNative>("HermitHaptics") ?? undefined;
