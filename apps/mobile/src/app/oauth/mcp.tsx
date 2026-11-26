// HM-CONN-03, the sign-in coming back (SL-54, Q77): the browser opens hermit://oauth/mcp?code=...&state=..., the router
// lands here, and the exact URL goes to the runtime, which checks the redirect, the state and the issuer before the code
// is used. Then back to HM-CONN-03 with the review. A redirect with no sign-in under way is refused there.
import * as ExpoLinking from "expo-linking";
import { useRouter } from "expo-router";
import { useEffect, useRef } from "react";
import { MCP_REDIRECT_URI } from "@hermit/runtime";
import { Loading, Page } from "../../components/kit";
import { useHermit } from "../../hermit-context";
import { currentDraft, finishDraft } from "../../mcp-flow";
import { t } from "../../i18n";

export default function McpRedirect() {
  const router = useRouter();
  const url = ExpoLinking.useURL();
  const { status } = useHermit();
  const mcp = status.kind === "ready" ? status.hermit.mcp : undefined;
  const done = useRef(false);

  useEffect(() => {
    if (done.current || !mcp || !url || !url.startsWith(`${MCP_REDIRECT_URI}?`)) return;
    done.current = true;
    const draftId = currentDraft();
    void (async () => {
      finishDraft(draftId ? await mcp.finishSignIn(draftId, url).catch(() => ({ kind: "refused" as const, problem: "sign_in_failed" as const })) : { kind: "refused", problem: "unknown_draft" });
      router.replace("/mcp");
    })();
  }, [mcp, url, router]);

  return (
    <Page title={t("HM-CONN-03.title")} back={false}>
      <Loading text={t("HM-CONN-03.finishing")} />
    </Page>
  );
}
