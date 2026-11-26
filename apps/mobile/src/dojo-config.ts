// Build-time configuration for what Dojo hosts (PDR-021, PDR-022). Q43 is resolved (Dojo sets up its Google Cloud and
// Microsoft Entra apps and its relay); until each value lands here it stays unset: HM-CONN-05 shows Dojo's relay as
// "Not available yet", and Gmail and Outlook sign in only with the user's own client ID. Every value is checked again
// by the runtime (an https address on a public host; a client ID of the provider's shape), so a typo fails closed.

/** Dojo's opt-in sign-in relay (US-CONN-10). */
export const DOJO_RELAY_URL: string | undefined = undefined;

/**
 * Dojo's OAuth client IDs (Q43), public identifiers, never secrets. Sign-in uses the user's own client ID from HM-CONN-05
 * first, then these.
 * - google: an "Android" OAuth client in Dojo's Google Cloud project for the package `io.dojocoding.hermit` with the
 *   release key's SHA-1, "Enable custom URI scheme" ticked in its Advanced settings (Q156); scope gmail.modify.
 *   Shape: `<digits>-<id>.apps.googleusercontent.com`.
 * - microsoft: the Application (client) ID of an Entra app for "Accounts in any organizational directory and personal
 *   Microsoft accounts", platform "Mobile and desktop applications" with the redirect `hermit://oauth/microsoft` (Q157), and
 *   the delegated Graph permissions offline_access, User.Read, Mail.ReadWrite and Mail.Send. Shape: a GUID.
 */
export const DOJO_CLIENT_IDS: { google?: string; microsoft?: string } = {};
