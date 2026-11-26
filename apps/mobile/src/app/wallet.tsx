// HM-PAY-01: the wallet (US-PAY-01 to US-PAY-04). The rules live in @hermit/runtime (createWallet); this screen draws
// its states: not in this build, ST-LOAD, ST-ERROR with retry, none (what the wallet is, Create with a fingerprint,
// Restore from recovery words, the "nobody can recover lost words" line), needs backup (the address, the balance and
// the backup banner), ready (address, balance, backed up); both with Receive (HM-PAY-04) and Transactions (HM-PAY-03,
// SL-39); lost (new fingerprints retired the key: Restore, or Start over with a destructive confirmation). The balance
// reads ST-LOAD, a value, or unavailable with Read again. Stable testnet, USD₮ only, said on every state with a wallet.
// Polish round (docs/design/polish/decisions.md): under the large title, one card with the balance and the test network
// said under it, Receive and Caps as the screen's one primary and a tonal button, and today's cap as a slim meter; the
// latest movements with relative times; the address cut in the middle with a copy button; the long explanation (test
// money, no recovery, the key) in an info sheet. No Send button, because paying is asked for in the chat.
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, StyleSheet, View } from "react-native";
import { formatMoney, type Money } from "@hermit/core";
import type { WalletBalance, WalletSummary, WalletTransfer } from "@hermit/runtime";
import { copyAddress } from "../adapters/wallet";
import { Btn, Card, Group, IconBtn, Label, Meter, Note, Page, Row, Stage, T } from "../components/kit";
import { Reveal } from "../components/motion";
import { InfoSheet } from "../components/Sheet";
import { TransferItem } from "../components/Transfer";
import { middle, splitAmount } from "../format";
import { useHermit } from "../hermit-context";
import { currentLocale, t } from "../i18n";
import { capMoney, LIST_MIN_DECIMALS } from "../wallet-view";
import { radius, s, shadow } from "../theme";
import { usePalette } from "../use-palette";

type View_ = { kind: "loading" } | { kind: "error" } | { kind: "not_in_build" } | WalletSummary;
type Note_ = "cancelled" | "unavailable" | "failed" | "not_on_screen";
type Balance = WalletBalance | { kind: "loading" };
type Caps = { perPayment: Money; perDay: Money; spentToday: Money };

const money = (m: Money) => formatMoney(m, currentLocale(), 2, LIST_MIN_DECIMALS);
/** Caps and limits: whole amounts without decimals ("20 de 50 USD₮"). */
const cap = (m: Money) => capMoney(m, currentLocale(), formatMoney);

export default function Wallet() {
  const p = usePalette();
  const router = useRouter();
  const { status } = useHermit();
  const wallet = status.kind === "ready" ? status.hermit.wallet : undefined;
  const payments = status.kind === "ready" ? status.hermit.payments : undefined;
  const [view, setView] = useState<View_>({ kind: "loading" });
  const [balance, setBalance] = useState<Balance>({ kind: "loading" });
  const [caps, setCaps] = useState<Caps>();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note_>();
  const [info, setInfo] = useState(false);

  // The latest movements: the history's first page, read with the balance; nothing shows when it can't be read.
  const [recent, setRecent] = useState<WalletTransfer[]>();
  const readRecent = useCallback(async () => {
    if (!wallet) return;
    const page = await wallet.history().catch(() => undefined);
    setRecent(page && page.kind === "page" ? page.items : undefined);
  }, [wallet]);

  const readBalance = useCallback(async () => {
    if (!wallet) return;
    setBalance({ kind: "loading" });
    setBalance(await wallet.balance().catch((): WalletBalance => ({ kind: "unavailable" })));
  }, [wallet]);

  const load = useCallback(async () => {
    if (status.kind === "failed") return setView({ kind: "error" });
    if (status.kind !== "ready") return;
    if (!wallet) return setView({ kind: "not_in_build" });
    try {
      const s = await wallet.summary();
      setView(s);
      if (s.kind === "wallet" && s.status !== "lost") {
        void readBalance();
        void readRecent();
      }
      // W1: the caps in force and what the last 24 hours used, beside the balance (only when this build can pay).
      if (payments) void payments.caps().then((c) => setCaps({ perPayment: c.caps.perPayment, perDay: c.caps.perDay, spentToday: c.spentToday }), () => setCaps(undefined));
    } catch {
      setView({ kind: "error" });
    }
  }, [status.kind, wallet, payments, readBalance, readRecent]);

  useFocusEffect(useCallback(() => void load(), [load]));

  const create = async () => {
    if (!wallet) return;
    setBusy(true);
    setNote(undefined);
    try {
      const r = await wallet.create(t("HM-PAY-01.createPrompt"));
      if (r.kind === "created") {
        await load();
        router.push({ pathname: "/wallet-words", params: { mode: "backup" } });
        return;
      }
      if (r.kind !== "exists") setNote(r.kind);
      await load();
    } catch {
      setNote("failed");
    } finally {
      setBusy(false);
    }
  };

  const askStartOver = () =>
    Alert.alert(t("HM-PAY-01.startOverTitle"), t("HM-PAY-01.startOverBody"), [
      { text: t("HM-PAY-01.startOverCancel"), style: "cancel" },
      {
        text: t("HM-PAY-01.startOverConfirm"),
        style: "destructive",
        onPress: () => void wallet?.startOver().then(load, () => setNote("failed")),
      },
    ]);

  const noteView = note ? <T v="body" color="coral" live="polite">{t(`HM-PAY-01.note.${note}`)}</T> : null;
  const restore = () => router.push({ pathname: "/wallet-words", params: { mode: "restore" } });

  if (view.kind === "loading") {
    return (
      <Page title={t("HM-PAY-01.title")}>
        <View style={{ alignItems: "center", gap: s.md, paddingTop: s.x3 }} accessibilityLiveRegion="polite">
          <ActivityIndicator color={p.mark} />
          <T v="body" color="soft">{t("HM-PAY-01.loading")}</T>
        </View>
      </Page>
    );
  }

  if (view.kind === "error" || view.kind === "not_in_build") {
    return (
      <Page title={t("HM-PAY-01.title")}>
        <View style={{ gap: s.lg }}>
          <T v="body" role="text">{t(view.kind === "error" ? "HM-PAY-01.error" : "HM-PAY-01.notInBuild")}</T>
          {view.kind === "error" ? <Btn label={t("common.retry")} icon="refresh-cw" onPress={() => { setView({ kind: "loading" }); void load(); }} /> : null}
        </View>
      </Page>
    );
  }

  if (view.kind === "none") {
    return (
      <Page title={t("HM-PAY-01.noneTitle")}>
        <View style={{ gap: s.lg }}>
          <Stage pose="idle" width={112} />
          <T v="body" color="soft">{t("HM-PAY-01.noneBody")}</T>
          <T v="small" color="soft">{t("HM-PAY-01.testnet")}</T>
          {noteView}
          <Btn label={t("HM-PAY-01.create")} icon="fingerprint" full busy={busy} onPress={() => void create()} />
          <Btn label={t("HM-PAY-01.restore")} kind="secondary" icon="key-round" full onPress={restore} />
          <T v="footnote" color="soft">{t("HM-PAY-01.noRecovery")}</T>
        </View>
      </Page>
    );
  }

  if (view.status === "lost") {
    return (
      <Page title={t("HM-PAY-01.lostTitle")}>
        <View style={{ gap: s.lg }}>
          <Stage pose="error" width={112} />
          <T v="body" color="soft">{t("HM-PAY-01.lostBody")}</T>
          <Address address={view.address} />
          {noteView}
          <Btn label={t("HM-PAY-01.restore")} icon="key-round" full onPress={restore} />
          <Btn label={t("HM-PAY-01.startOver")} kind="coralOutline" icon="trash-2" full onPress={askStartOver} />
          <T v="footnote" color="soft">{t("HM-PAY-01.noRecovery")}</T>
        </View>
      </Page>
    );
  }

  const balanceText = balance.kind === "balance" ? money(balance.usdt) : undefined;
  const amount = balanceText ? splitAmount(balanceText) : undefined;
  const words = () => router.push({ pathname: "/wallet-words", params: { mode: "backup" } });
  return (
    <Page title={t("HM-PAY-01.title")} action={<IconBtn icon="info" label={t("HM-PAY-01.info.open")} tone="textSoft" onPress={() => setInfo(true)} />}>
      {view.status === "needs_backup" ? (
        // W3: back up before money goes in; amber, the "needs you" color, never an error.
        <Card tone="amber" style={{ gap: s.sm, marginBottom: s.lg }}>
          <Note icon="triangle-alert" tone="amber" text={t("HM-PAY-01.backupTitle")} textColor="text" v="bodyStrong" />
          <T v="small" color="soft">{t("HM-PAY-01.backupBody")}</T>
          <Btn label={t("HM-PAY-01.backup")} kind="amber" icon="key-round" onPress={words} />
        </Card>
      ) : null}

      {/* W1: one card under the large title, like Rabby's: the balance with the test network said under it, Receive and
          Caps, and today's cap as a slim meter with its numbers. */}
      <Reveal>
        <View style={{ backgroundColor: p.raised, borderRadius: radius.card, boxShadow: shadow(p, "raised"), padding: s.lg }}>
          <T v="footnoteStrong" color="soft">{t("HM-PAY-01.balanceTitle")}</T>
          {balance.kind === "loading" ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: s.sm, minHeight: 62 }} accessibilityLiveRegion="polite">
              <ActivityIndicator size="small" color={p.accent} />
              <T v="body" color="soft">{t("HM-PAY-01.balanceLoading")}</T>
            </View>
          ) : amount ? (
            <View style={{ flexDirection: "row", alignItems: "baseline", flexWrap: "wrap", columnGap: s.sm }} accessible accessibilityLabel={balanceText} accessibilityLiveRegion="polite">
              <T v="amount">{amount.figures}</T>
              {amount.unit ? <T v="lead" color="soft">{amount.unit}</T> : null}
            </View>
          ) : (
            <View style={{ gap: s.sm, paddingVertical: s.sm }}>
              <T v="body" color="text" live="polite">{t("HM-PAY-01.balanceUnavailable")}</T>
              <Btn label={t("HM-PAY-01.refresh")} kind="secondary" icon="refresh-cw" small onPress={() => void readBalance()} />
            </View>
          )}
          <T v="small" color="soft">{t("HM-PAY-01.testnetShort")}</T>

          <View style={{ flexDirection: "row", gap: s.sm, marginTop: s.lg, flexWrap: "wrap" }}>
            <View style={{ flex: 1, minWidth: 140 }}><Btn label={t("HM-PAY-01.receive")} icon="qr-code" full onPress={() => router.push("/wallet-receive")} /></View>
            {/* SL-40: HM-PAY-05, only when this build can pay (the wallet bundle and the approval key). */}
            {payments ? <View style={{ flex: 1, minWidth: 140 }}><Btn label={t("HM-PAY-05.short")} a11y={t("HM-PAY-01.caps")} kind="secondary" icon="sliders-horizontal" full onPress={() => router.push("/wallet-caps")} /></View> : null}
          </View>

          {caps ? (
            <View style={{ gap: s.md, marginTop: s.lg, paddingTop: s.lg, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: p.hairline }}>
              <View style={{ gap: s.sm }} accessible accessibilityLabel={`${t("HM-PAY-01.capToday")}: ${t("HM-PAY-01.capUsed", { used: cap(caps.spentToday), cap: cap(caps.perDay) })}`}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", gap: s.sm, flexWrap: "wrap" }}>
                  <T v="small" color="soft">{t("HM-PAY-01.capToday")}</T>
                  <T v="smallStrong" tabular>{t("HM-PAY-01.capUsed", { used: splitAmount(cap(caps.spentToday)).figures, cap: cap(caps.perDay) })}</T>
                </View>
                <Meter used={Number(caps.spentToday.amount)} cap={Number(caps.perDay.amount)} over={caps.spentToday.amount >= caps.perDay.amount} />
              </View>
              <View style={{ flexDirection: "row", justifyContent: "space-between", gap: s.sm, flexWrap: "wrap" }} accessible accessibilityLabel={`${t("HM-PAY-05.perPayment")}: ${cap(caps.perPayment)}`}>
                <T v="small" color="soft">{t("HM-PAY-05.perPayment")}</T>
                <T v="smallStrong" tabular>{cap(caps.perPayment)}</T>
              </View>
            </View>
          ) : null}
        </View>
      </Reveal>

      {/* The latest movements, as Rabby and Apple Wallet show them on the home; the whole list is one tap away. */}
      {recent && recent.length ? (
        <Reveal delay={80}>
          <Label>{t("HM-PAY-01.recent")}</Label>
          <Group lead="tile">
            {recent.slice(0, 3).map((item) => <TransferItem key={`${item.txHash}:${item.logIndex}`} item={item} now={Date.now()} brief />)}
            <Row icon="history" title={t("HM-PAY-01.seeAll")} chevron role="link" onPress={() => router.push("/wallet-history")} />
          </Group>
        </Reveal>
      ) : null}

      <Reveal delay={140}>
        <Label>{t("HM-PAY-01.thisWallet")}</Label>
        <Group>
          {recent && recent.length ? null : <Row icon="history" title={t("HM-PAY-01.history")} chevron onPress={() => router.push("/wallet-history")} />}
          <AddressRow address={view.address} />
          <Row
            icon="key-round"
            iconColor={view.status === "ready" ? "accent" : "amber"}
            title={t("HM-PAY-01.words")}
            trailing={<T v="small" color={view.status === "ready" ? "soft" : "amber"}>{view.status === "ready" ? t("HM-PAY-01.backedUpShort") : t("HM-PAY-01.backupShort")}</T>}
            {...(view.status === "needs_backup" ? { chevron: true, onPress: words } : {})}
          />
        </Group>
        {payments ? <View style={{ marginTop: s.lg, paddingHorizontal: s.lg }}><Note icon="message-circle" text={t("HM-PAY-01.payInChat")} /></View> : null}
        <View style={{ marginTop: s.md, paddingHorizontal: s.lg }}><Note icon="key-round" tone="textSoft" text={t("HM-PAY-01.noRecoveryShort")} /></View>
      </Reveal>

      <InfoSheet visible={info} onClose={() => setInfo(false)} title={t("HM-PAY-01.info.title")} paragraphs={[t("HM-PAY-01.testnet"), t("HM-PAY-01.info.key"), t("HM-PAY-01.noRecovery")]} />
    </Page>
  );
}

/** The address cut in the middle, with a copy button beside it (the address is public; the clip is a plain one). */
function AddressRow({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await copyAddress(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };
  return (
    <Row
      icon="wallet"
      title={
        // TalkBack reads the whole address once; the eye gets its start and end.
        <View accessible accessibilityLabel={`${t("HM-PAY-01.addressTitle")}: ${address}`} style={{ gap: 2 }}>
          <T v="bodyStrong">{t("HM-PAY-01.addressTitle")}</T>
          <T v="mono" color="soft" selectable>{middle(address)}</T>
        </View>
      }
      trailing={copied ? <T v="small" color="link" live="polite">{t("common.copied")}</T> : <IconBtn icon="copy" label={t("HM-PAY-04.copy")} tone="accent" onPress={() => void copy()} />}
    />
  );
}

function Address({ address }: { address: string }) {
  return (
    <View style={{ gap: 4 }}>
      <T v="small" color="soft" role="header">{t("HM-PAY-01.addressTitle")}</T>
      <T v="mono" selectable>{address}</T>
    </View>
  );
}
