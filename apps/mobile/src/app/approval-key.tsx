// HM-APPR-01, approval key (SL-37, US-CAGE-03): the Keystore key that signs money and password approvals. The rules
// live in @hermit/runtime (approvalKeyView, createApprovalKey); this screen draws its states: ST-LOAD; ST-ERROR with
// retry; not available in this build; no fingerprint on the phone (how to add one); not set up (what it is, Set up
// with a fingerprint); lost (new fingerprints retired it: payments and passwords are blocked until it is set up
// again); ready (kept in StrongBox or the secure hardware, Set up again); after a try: done, cancelled, locked out,
// no secure hardware, or failed, each saying what changed.
// Design pass: the key's state first, as a card with its icon (sea glass when it signs, coral when retired), how it
// works under it, and Set up with fingerprint pinned at the foot.
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { View } from "react-native";
import type { ApprovalKeyEnrollFailure, ApprovalKeyView } from "@hermit/runtime";
import { trackPrompt } from "../adapters/app-lock";
import { Icon, type IconName } from "../components/Icon";
import { Btn, Card, Failed, Footer, Loading, Note as NoteLine, Notice, Page, T } from "../components/kit";
import { useHermit } from "../hermit-context";
import { currentLocale, t } from "../i18n";
import { s } from "../theme";
import { usePalette } from "../use-palette";

type Screen = { kind: "loading" } | { kind: "error" } | ApprovalKeyView;
type Note = ApprovalKeyEnrollFailure | "done";

export default function ApprovalKey() {
  const p = usePalette();
  const { status } = useHermit();
  const service = status.kind === "ready" ? status.hermit.approvalKey : undefined;
  const [view, setView] = useState<Screen>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note>();

  const load = useCallback(async () => {
    if (status.kind === "failed") return setView({ kind: "error" });
    if (status.kind !== "ready") return;
    if (!service) return setView({ kind: "unavailable" });
    try {
      setView(await service.view());
    } catch {
      setView({ kind: "error" });
    }
  }, [service, status.kind]);

  useFocusEffect(useCallback(() => void load(), [load]));

  const enroll = async () => {
    if (!service) return;
    setBusy(true);
    setNote(undefined);
    try {
      const out = await trackPrompt(() => service.enroll(currentLocale()));
      setNote(out.ok ? "done" : out.reason);
      await load();
    } catch {
      setNote("failed");
    } finally {
      setBusy(false);
    }
  };

  if (view.kind === "loading") {
    return (
      <Page title={t("HM-APPR-01.key.title")}>
        <Loading text={t("HM-APPR-01.key.loading")} />
      </Page>
    );
  }

  if (view.kind === "error") {
    return (
      <Page title={t("HM-APPR-01.key.title")}>
        <Failed text={t("HM-APPR-01.key.error")} onRetry={() => { setView({ kind: "loading" }); void load(); }} />
      </Page>
    );
  }

  const canEnroll = view.kind === "not_set_up" || view.kind === "lost" || view.kind === "ready";
  const lost = view.kind === "lost";
  return (
    <Page
      title={t("HM-APPR-01.key.title")}
      footer={canEnroll ? (
        <Footer>
          <Btn label={t(view.kind === "not_set_up" ? "HM-APPR-01.key.setUp" : "HM-APPR-01.key.setUpAgain")} icon="fingerprint" kind={view.kind === "ready" ? "secondary" : "primary"} busy={busy} style={{ flexGrow: 1 }} onPress={() => void enroll()} />
        </Footer>
      ) : undefined}
    >
      {/* The key's state first, in words with its icon: sea glass when it signs, coral when it was retired. */}
      <Card {...(lost ? { tone: "coral" as const } : view.kind === "ready" ? { tone: "hermit" as const } : {})}>
        <View style={{ gap: s.sm }}>
          <View style={{ flexDirection: "row", gap: s.sm, alignItems: "center" }}>
            <Icon name={STATE_ICON[view.kind]} size={24} color={lost ? p.coral : p.mark} />
            <T v="lead" role="header" style={{ flex: 1 }}>{t(`HM-APPR-01.key.${view.kind}Title`)}</T>
          </View>
          <T v="body" color="soft">{t(`HM-APPR-01.key.${view.kind}Body`)}</T>
          {view.kind === "ready" ? <NoteLine icon="lock" text={t(`HM-APPR-01.key.level.${view.level}`)} textColor="text" /> : null}
        </View>
      </Card>
      <View style={{ marginTop: s.lg, gap: s.md }}>
        <NoteLine icon="fingerprint" text={t("HM-APPR-01.key.howItWorks")} />
        {note ? <Notice tone={note === "done" ? "ok" : "bad"} text={t(`HM-APPR-01.key.note.${note}`)} /> : null}
      </View>
    </Page>
  );
}

const STATE_ICON: Record<ApprovalKeyView["kind"], IconName> = {
  unavailable: "ban", no_biometric: "fingerprint", not_set_up: "key-round", lost: "shield-alert", ready: "shield-check",
};
