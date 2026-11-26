// Q157: a Microsoft sign-in comes back here, on `hermit://oauth/microsoft?code=...&state=...` (a custom redirect on the
// "Mobile and desktop applications" platform). OAuthReturn hands the exact URL to finishOAuthRedirect, which checks the
// state before any request. A redirect no sign-in is waiting for is refused there.
import { APP_REDIRECT_URIS } from "@hermit/runtime";
import { OAuthReturn } from "../../components/OAuthReturn";

export default function MicrosoftSignInReturn() {
  return <OAuthReturn redirectUri={APP_REDIRECT_URIS.microsoft!} />;
}
