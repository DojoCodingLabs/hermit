// Preview only: stands in for apps/mobile/src/oauth-flow.ts. HM-MAIL-01's "connected" shot shows how a sign-in ended
// as if the provider's redirect had just come back; the return screen stays on its pending state.
import { fakeMailResult } from "../fake/mail";

let result = fakeMailResult;
export const finishOAuthRedirect = () => new Promise<"/mail">(() => {});
export function takeMailSignIn() {
  const r = result;
  result = undefined;
  return r;
}
