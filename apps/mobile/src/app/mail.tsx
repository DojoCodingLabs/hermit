// HM-MAIL-01: Email accounts (US-MAIL-01, US-MAIL-08, SL-48). The rules live in @hermit/mail (the service's view,
// sign-in and disconnect) behind ../adapters/mail; this screen draws the states of docs/prd/hermit-ui-states-and-edge-cases.md:
// ST-LOAD; ST-ERROR with retry; ST-EMPTY-FIRST (the crab, one line, the connect choices); ST-IDEAL (one group per account,
// in the order connected, its service and label, "Sign in again" in amber when the provider refused the token, then
// Disconnect as a coral row); the privacy line always (mail goes straight between the phone and the provider); the
// hand-off to the system browser (what Hermit asks for, the browser note), then ST-PENDING until the redirect returns;
// ST-ERROR per problem; ST-DISABLED for Gmail or Outlook with no client ID (a link to HM-CONN-05); any other provider
// over IMAP with an app password (../components/MailImapForm, Q46), disabled only in a build without the TLS sockets
// (Q158); disconnect, then what was deleted and whether the provider revoked.
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, Linking, View } from "react-native";
import { mailConnectErrorKey, mailSignInOption, type MailAccountRow, type MailAccountsScreen, type OAuthMailKind } from "@hermit/mail";
import { mailService } from "../adapters/mail";
import { Btn, Card, Empty, Failed, Footer, Group, Label, Loading, Note, Notice, Page, Row, T } from "../components/kit";
import { useHermit } from "../hermit-context";
import { t } from "../i18n";
import { MailImapForm } from "../components/MailImapForm";
import { takeMailSignIn } from "../oauth-flow";
import { s } from "../theme";

const PROVIDER_NAME: Record<OAuthMailKind, string> = { gmail: "Gmail", outlook: "Outlook" };
/** Whose page the sign-in opens on: Google's for Gmail, Microsoft's for Outlook. */
const SIGN_IN_PAGE: Record<OAuthMailKind, string> = { gmail: "Google", outlook: "Microsoft" };
const KINDS: readonly OAuthMailKind[] = ["gmail", "outlook"];

type SignInOption = ReturnType<typeof mailSignInOption>;
type Options = Record<OAuthMailKind, SignInOption>;
type Screen =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "list"; view: MailAccountsScreen; options: Options; draft: boolean }
  | { kind: "handoff"; provider: OAuthMailKind; option: SignInOption }
  | { kind: "waiting"; provider: OAuthMailKind }
  | { kind: "imap" };
type Said = { tone: "ok" | "bad" | "info"; key: string; vars?: Record<string, string> };

export default function MailAccounts() {
  const router = useRouter();
  const { status } = useHermit();
  const relay = status.kind === "ready" ? status.hermit.relay : undefined;
  const mail = mailService();
  const [screen, setScreen] = useState<Screen>({ kind: "loading" });
  const [said, setSaid] = useState<Said>();
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!mail || !relay) return;
    // How a sign-in that came back while this screen was underneath ended (said once).
    const ended = takeMailSignIn();
    if (ended) setSaid(ended.ok ? { tone: "ok", key: "HM-MAIL-01.connected", vars: { address: ended.account.address } } : { tone: "bad", key: mailConnectErrorKey(ended.problem) });
    const pending = mail.pendingSignIn();
    if (pending) return setScreen({ kind: "waiting", provider: pending });
    try {
      const [view, choices] = await Promise.all([mail.view(), relay.signIn()]);
      const options = Object.fromEntries(KINDS.map((k) => [k, mailSignInOption(k, choices.settings, choices.config)])) as Options;
      setScreen({ kind: "list", view, options, draft: mail.draft()?.ref !== undefined });
    } catch {
      setScreen({ kind: "error" });
    }
  }, [mail, relay]);
  useFocusEffect(useCallback(() => void load(), [load]));

  const openBrowser = async (provider: OAuthMailKind, option: SignInOption) => {
    if (!mail) return;
    setSaid(undefined);
    try {
      const { url } = mail.startSignIn(provider, option);
      setScreen({ kind: "waiting", provider });
      await Linking.openURL(url);
    } catch {
      mail.cancelSignIn();
      setSaid({ tone: "bad", key: "HM-MAIL-01.error.unreachable" });
      void load();
    }
  };

  // Waiting, the user left the browser without finishing: the same sign-in opens again (one pending sign-in at a time).
  const openBrowserAgain = async (provider: OAuthMailKind) => {
    const choices = await relay?.signIn().catch(() => undefined);
    if (choices) void openBrowser(provider, mailSignInOption(provider, choices.settings, choices.config));
  };

  const stopWaiting = () => {
    mail?.cancelSignIn();
    setSaid({ tone: "info", key: "HM-MAIL-01.error.cancelled" });
    void load();
  };

  const disconnect = (row: MailAccountRow) =>
    Alert.alert(t("HM-MAIL-01.disconnectTitle", { address: row.address }), t("HM-MAIL-01.disconnectBody"), [
      { text: t("HM-MAIL-01.cancel"), style: "cancel" },
      {
        text: t("HM-MAIL-01.disconnect"),
        style: "destructive",
        onPress: () => {
          if (!mail) return;
          setBusy(true);
          void mail.disconnect(row.id)
            .then((r) => setSaid(r ? { tone: r.key === "HM-MAIL-01.disconnected" ? "ok" : "info", key: r.key } : undefined))
            .catch(() => setSaid({ tone: "bad", key: "HM-MAIL-01.loadError" }))
            .finally(() => {
              setBusy(false);
              void load();
            });
        },
      },
    ]);

  const privacy = <T v="body" color="soft">{t("HM-MAIL-01.privacy")}</T>;

  if (status.kind === "failed" || status.kind === "not_wired" || screen.kind === "error") {
    return (
      <Page title={t("HM-MAIL-01.title")} subtitle={privacy}>
        <Failed text={t("HM-MAIL-01.loadError")} onRetry={() => void load()} />
      </Page>
    );
  }
  if (!mail || screen.kind === "loading") {
    return (
      <Page title={t("HM-MAIL-01.title")} subtitle={privacy}>
        <Loading text={t("HM-MAIL-01.loading")} />
      </Page>
    );
  }

  if (screen.kind === "imap") {
    return (
      <MailImapForm
        connect={async (input) => {
          const r = await mail.connectImap(input);
          if (!r.ok) return r.problem;
          setSaid({ tone: "ok", key: "HM-MAIL-01.connected", vars: { address: r.account.address } });
          void load();
          return undefined;
        }}
        cancel={() => void load()}
      />
    );
  }

  if (screen.kind === "handoff") {
    const name = PROVIDER_NAME[screen.provider];
    return (
      <Page
        title={t("HM-MAIL-01.handoffTitle", { provider: name })}
        footer={
          <Footer>
            <Btn label={t("HM-MAIL-01.continue")} icon="globe" style={{ flexGrow: 1 }} onPress={() => void openBrowser(screen.provider, screen.option)} />
            <Btn label={t("HM-MAIL-01.cancel")} kind="text" onPress={() => void load()} />
          </Footer>
        }
      >
        <View style={{ gap: s.lg }}>
          <Card>
            <View style={{ gap: s.md }}>
              <Note icon="globe" text={t("HM-MAIL-01.browserNote", { provider: SIGN_IN_PAGE[screen.provider] })} textColor="text" v="body" />
              <Note icon="shield-check" text={t("HM-MAIL-01.asks")} textColor="text" v="body" />
            </View>
          </Card>
          <View style={{ paddingHorizontal: s.lg }}><Note icon="shield" text={t("HM-MAIL-01.privacy")} /></View>
        </View>
      </Page>
    );
  }

  if (screen.kind === "waiting") {
    return (
      <Page
        title={t("HM-MAIL-01.handoffTitle", { provider: PROVIDER_NAME[screen.provider] })}
        footer={
          <Footer>
            <Btn label={t("HM-MAIL-01.continue")} kind="secondary" icon="globe" style={{ flexGrow: 1 }} onPress={() => void openBrowserAgain(screen.provider)} />
            <Btn label={t("HM-MAIL-01.cancel")} kind="text" onPress={stopWaiting} />
          </Footer>
        }
      >
        <View style={{ gap: s.sm }}>
          <Loading text={t("HM-MAIL-01.connecting")} />
          <T v="body" color="soft" live="polite">{t("HM-MAIL-01.waiting")}</T>
        </View>
      </Page>
    );
  }

  const { view, options } = screen;
  const connectRow = (provider: OAuthMailKind) => {
    const option = options[provider];
    const label = t(provider === "gmail" ? "HM-MAIL-01.connectGmail" : "HM-MAIL-01.connectOutlook");
    if (!option.available) {
      // ST-DISABLED with its reason, and the one place that fixes it.
      return (
        <Row
          key={provider}
          icon="mail"
          iconColor="soft"
          title={label}
          sub={t("HM-MAIL-01.needsClientId")}
          chevron
          role="link"
          a11y={`${label}, ${t("HM-MAIL-01.needsClientId")}`}
          hint={t("HM-MAIL-01.addClientId")}
          onPress={() => router.push("/sign-in-options")}
        />
      );
    }
    return (
      <Row
        key={provider}
        icon="mail"
        title={label}
        sub={t(option.source === "own_client" ? "HM-MAIL-01.viaOwn" : "HM-MAIL-01.viaDojo")}
        chevron
        disabled={busy}
        onPress={() => {
          setSaid(undefined);
          setScreen({ kind: "handoff", provider, option });
        }}
      />
    );
  };

  const connect = (
    <>
      <Label>{t("HM-MAIL-01.connectTitle")}</Label>
      <Group>
        {KINDS.map(connectRow)}
        {mail.imapAvailable ? (
          <Row icon="mail" title={t("HM-MAIL-01.connectOther")} sub={t("HM-MAIL-01.otherSub")} chevron disabled={busy} onPress={() => {
            setSaid(undefined);
            setScreen({ kind: "imap" });
          }} />
        ) : (
          // ST-DISABLED that stays readable: the soft title, a plain tile, no chevron, and the reason in full contrast.
          <Row icon="mail" iconColor="soft" title={t("HM-MAIL-01.connectOther")} titleColor="textSoft" sub={t("HM-MAIL-01.otherSoon")} />
        )}
      </Group>
      {KINDS.some((k) => !options[k].available) ? (
        <View style={{ paddingHorizontal: s.lg, marginTop: s.sm }}><Note icon="info" text={t("HM-MAIL-01.error.needs_client_id")} /></View>
      ) : null}
    </>
  );

  const notice = said ? <View style={{ marginBottom: s.md }}><Notice tone={said.tone} text={t(said.key, said.vars)} /></View> : null;

  if (view.state === "empty") {
    return (
      <Page title={t("HM-MAIL-01.title")} subtitle={privacy}>
        {notice}
        <Empty pose="hello" title={t("HM-MAIL-01.emptyTitle")} body={t("HM-MAIL-01.empty")} />
        {connect}
      </Page>
    );
  }

  return (
    <Page title={t("HM-MAIL-01.title")} subtitle={privacy}>
      {notice}
      <Label style={{ marginTop: 0 }}>{t("HM-MAIL-01.accounts")}</Label>
      <View style={{ gap: s.md }}>
        {view.rows.map((row) => {
          const kind = row.provider === "imap" ? undefined : row.provider;
          return (
            <Group key={row.id}>
              <Row icon="mail" title={row.address} sub={row.label ? `${t(row.serviceKey)} · ${row.label}` : t(row.serviceKey)} />
              {row.signInAgain && (kind || mail.imapAvailable) ? (
                <Row
                  icon="log-in"
                  iconColor="amber"
                  title={<T v="bodyStrong" color="amber">{t("HM-MAIL-01.signInAgain")}</T>}
                  sub={t("HM-MAIL-01.signInAgainSub")}
                  a11y={t("HM-MAIL-01.signInAgainA11y", { address: row.address })}
                  disabled={busy || (kind ? !options[kind].available : false)}
                  // An IMAP account signs in again with a new app password on the same form.
                  onPress={() => setScreen(kind ? { kind: "handoff", provider: kind, option: options[kind] } : { kind: "imap" })}
                />
              ) : null}
              <Row icon="trash-2" iconColor="coral" title={<T v="bodyStrong" color="coral">{t("HM-MAIL-01.disconnect")}</T>} a11y={t("HM-MAIL-01.disconnectA11y", { address: row.address })} disabled={busy} onPress={() => disconnect(row)} />
            </Group>
          );
        })}
      </View>
      {screen.draft ? (
        <>
          <Label>{t("HM-MAIL-01.unsent")}</Label>
          <Group>
            <Row icon="pen-line" title={t("HM-MAIL-01.drafts")} sub={t("HM-MAIL-01.draftsSub")} chevron role="link" onPress={() => router.push("/mail-draft")} />
          </Group>
        </>
      ) : null}
      {connect}
    </Page>
  );
}
