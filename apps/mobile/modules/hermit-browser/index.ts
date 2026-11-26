import type { ComponentType, Ref } from "react";
import type { ViewProps } from "react-native";
import { NativeModule, requireNativeView, requireOptionalNativeModule } from "expo";

/** SL-53: one native event from the task's WebView. `event` only for `record` (the recorder's JSON, at most 4 KB). */
export interface BrowserNativeEvent {
  type: "started" | "load" | "blocked" | "request" | "record";
  url: string;
  event?: string;
}

declare class HermitBrowserNative extends NativeModule {
  /** Whether sites get their own WebView profiles, whether recording can run, and Hermit's own `android://<cert>@<package>`. */
  status(): { multiProfile: boolean; recorder: boolean; identity: string };
  /** Clears one site's profile (or the shared store without profiles). */
  clearSite(profile: string): Promise<boolean>;
}

/** The view's own calls, on its ref. */
export interface HermitBrowserViewRef {
  load(url: string): Promise<boolean>;
  evaluate(script: string): Promise<string>;
  currentUrl(): Promise<string>;
  /**
   * Runs the recorder script on the current page with a fresh token the native view generates and keeps (it replaces
   * the script's placeholder); only messages carrying it, from the main frame on the task's origin, come back.
   */
  injectRecorder(script: string): Promise<boolean>;
  clearCache(): Promise<void>;
}

export interface HermitBrowserViewProps extends ViewProps {
  ref?: Ref<HermitBrowserViewRef>;
  /** `site_<hash of the origin>`, set once before the first load. */
  profile?: string;
  /** The exact origin every main-frame navigation must stay on. */
  allowedOrigin?: string;
  recording?: boolean;
  onBrowserEvent?(e: { nativeEvent: BrowserNativeEvent }): void;
}

/** Android only, and optional: an APK built before this module gets null and HM-WEB-02 says the browser isn't there. */
export const HermitBrowser = requireOptionalNativeModule<HermitBrowserNative>("HermitBrowser");

export const HermitBrowserView: ComponentType<HermitBrowserViewProps> | null = HermitBrowser ? requireNativeView<HermitBrowserViewProps>("HermitBrowser") : null;
