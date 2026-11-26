/*
 * Where each provider's sign-in comes back to the phone (FR-CONN-03; Google Q156, Microsoft Q157), one redirect per provider for every feature
 * that signs in to it (email first, then OAuth catalog connectors). Dependency-free on purpose: the app's Node tests
 * import this file to check that apps/mobile/app.json declares every scheme used here.
 * - google: an "Android" OAuth client has no redirect field, accepts no https or loopback redirect, and takes a custom
 *   scheme only with "Enable custom URI scheme" ticked in its Advanced settings (off by default for new clients since
 *   2023; Google's native-app guide calls custom schemes unsupported on Android). The scheme it checks is the package
 *   name, so the same redirect works for the user's own client ID and Dojo's. One slash and no host, as Google writes it.
 * - microsoft: `msauth://<package>/<signature hash>` is the redirect for MSAL and its broker; an app that uses neither
 *   registers a custom redirect on the "Mobile and desktop applications" platform: here the app's own scheme (`hermit`,
 *   APP_SCHEME), like the MCP and relay sign-ins (Q77, Q117).
 * Either can be caught by another app that registers the same scheme, and what it catches is useless: the code can only
 * be exchanged with this sign-in's PKCE verifier, which stays in Hermit's memory, and the state is checked first.
 * Moving to an app link once hermit.dojocoding.io serves assetlinks.json (Q77) is a change here and in app.json.
 */

/** The Android package (apps/mobile/app.json `android.package`): Google's Android OAuth clients redirect to it as a scheme. */
export const ANDROID_PACKAGE = "io.dojocoding.hermit";

export const APP_REDIRECT_URIS: Readonly<Record<string, string>> = Object.freeze({
  google: `${ANDROID_PACKAGE}:/oauth2redirect`,
  microsoft: "hermit://oauth/microsoft",
});

/** The redirect a provider's sign-in uses, or undefined for a provider the phone can't sign in to directly. */
export function appRedirectUri(provider: string): string | undefined {
  return Object.hasOwn(APP_REDIRECT_URIS, provider) ? APP_REDIRECT_URIS[provider] : undefined;
}
