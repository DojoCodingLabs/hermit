// FR-CONN-03 (Q156, Q157): a provider's sign-in comes back to the app on its redirect (packages/connectors' APP_REDIRECT_URIS:
// app/oauth2redirect.tsx for Google, app/oauth/microsoft.tsx for Microsoft). The route hands the exact URL here, and the
// feature whose sign-in is under way finishes it: email today (SL-48). An OAuth catalog connector adds its own branch the
// same way: a pending sign-in of its own, checked with readAppRedirect and finished with finishAppSignIn. A redirect
// nobody is waiting for is refused without a request. In memory only; nothing secret is kept here.
import type { MailConnectResult } from "@hermit/mail";
import { mailService } from "./adapters/mail";

let mailResult: MailConnectResult | undefined;

/** Finishes the sign-in the URL belongs to; returns the screen to go back to. */
export async function finishOAuthRedirect(url: string): Promise<"/mail" | "/"> {
  const mail = mailService();
  if (mail?.pendingSignIn()) {
    mailResult = await mail.finishSignIn(url).catch((): MailConnectResult => ({ ok: false, problem: "exchange_failed" }));
    return "/mail";
  }
  return "/";
}

/** HM-MAIL-01 shows how the sign-in ended, once. */
export function takeMailSignIn(): MailConnectResult | undefined {
  const r = mailResult;
  mailResult = undefined;
  return r;
}
