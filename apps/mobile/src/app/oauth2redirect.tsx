// Q156: a Google sign-in comes back here, on `io.dojocoding.hermit:/oauth2redirect?code=...&state=...` (the package-name
// scheme Google's Android clients take). OAuthReturn hands the exact URL to finishOAuthRedirect, which checks the state
// before any request. A redirect no sign-in is waiting for is refused there.
import { APP_REDIRECT_URIS } from "@hermit/runtime";
import { OAuthReturn } from "../components/OAuthReturn";

export default function GoogleSignInReturn() {
  return <OAuthReturn redirectUri={APP_REDIRECT_URIS.google!} />;
}
