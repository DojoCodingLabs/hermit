import { appRedirectUri, readAppRedirect, type AppRedirect } from "@hermit/connectors";
import type { OAuthMailKind } from "./connect.ts";

/*
 * Where a Gmail or Outlook sign-in comes back: the provider's own redirect from the shared phone sign-in in
 * @hermit/connectors (`APP_REDIRECT_URIS`, Q156 and Q157), so a catalog connector that signs in to Google or Microsoft later uses
 * the same one: `io.dojocoding.hermit:/oauth2redirect` for Google, `hermit://oauth/microsoft` for Microsoft.
 */
export const MAIL_REDIRECT_URIS: Readonly<Record<OAuthMailKind, string>> = Object.freeze({
  gmail: appRedirectUri("google")!,
  outlook: appRedirectUri("microsoft")!,
});

/** The callback's parameters, only when `url` is exactly this provider's redirect followed by a query. */
export function readMailRedirect(kind: OAuthMailKind, url: string): AppRedirect | undefined {
  return readAppRedirect(MAIL_REDIRECT_URIS[kind], url);
}
