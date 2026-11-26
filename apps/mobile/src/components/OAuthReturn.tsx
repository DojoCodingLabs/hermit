// FR-CONN-03: the screen a provider's sign-in lands on (app/oauth2redirect.tsx for Google, app/oauth/microsoft.tsx for
// Microsoft). It takes the exact URL Android handed the app, only when it starts with that provider's redirect, gives it
// to finishOAuthRedirect once, and goes back to the screen that started the sign-in. ST-PENDING while it finishes.
import * as ExpoLinking from "expo-linking";
import { useRouter } from "expo-router";
import { useEffect, useRef } from "react";
import { finishOAuthRedirect } from "../oauth-flow";
import { t } from "../i18n";
import { Loading, Page } from "./kit";

export function OAuthReturn({ redirectUri }: { redirectUri: string }) {
  const router = useRouter();
  const url = ExpoLinking.useURL();
  const done = useRef(false);

  useEffect(() => {
    if (done.current || !url || !url.startsWith(`${redirectUri}?`)) return;
    done.current = true;
    // Back to the screen that started it (the one under this route), or to it fresh after a cold start.
    void finishOAuthRedirect(url).then((to) => router.dismissTo(to));
  }, [url, redirectUri, router]);

  return (
    <Page title={t("HM-MAIL-01.title")} back={false}>
      <Loading text={t("HM-MAIL-01.finishing")} />
    </Page>
  );
}
