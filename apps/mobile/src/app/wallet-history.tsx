// HM-PAY-03: transactions (US-PAY-03). USD₮ transfers to and from the wallet's public address, newest first, read
// from Stable testnet's RPC by @hermit/runtime's wallet service (Q127: USD₮0's Transfer logs, a few block windows per
// page, about a week back). States: ST-LOAD, unavailable with Read again, not in this build, none, empty, the list,
// Load older (ST-LOAD on the button, a note when it fails), the floor note. Each row: received, sent or to your own
// address, the exact amount in USD₮, the user's own contact name or the full address, "unknown sender" for incoming
// money from an address the user hasn't saved, the time (or the block), and the signed-log link when Hermit made it.
// Nothing shown here is text from the chain: other tokens are dropped before they reach the screen.
// Polish round: one grouped list of TransferItem rows (an arrow in a tile and a sign, never color alone; names first,
// the address cut in the middle, the time relative to now), an amber badge and the warning on an unknown sender, and
// "Made by Hermit" to the signed log. What is read and from where sits in an info sheet.
import { useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import type { HistoryCursor, WalletTransfer } from "@hermit/runtime";
import { Btn, Group, IconBtn, Page, T } from "../components/kit";
import { InfoSheet } from "../components/Sheet";
import { TransferItem } from "../components/Transfer";
import { useHermit } from "../hermit-context";
import { t } from "../i18n";
import { s } from "../theme";
import { usePalette } from "../use-palette";

type View_ =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | { kind: "not_in_build" }
  | { kind: "none" }
  | { kind: "list"; items: WalletTransfer[]; next?: HistoryCursor; more: "idle" | "loading" | "failed" };

export default function WalletHistory() {
  const p = usePalette();
  const { status } = useHermit();
  const wallet = status.kind === "ready" ? status.hermit.wallet : undefined;
  const [view, setView] = useState<View_>({ kind: "loading" });
  const [info, setInfo] = useState(false);
  /** Drops an answer that arrives after the screen started over. */
  const generation = useRef(0);

  const load = useCallback(async () => {
    if (status.kind === "failed") return setView({ kind: "unavailable" });
    if (status.kind !== "ready") return;
    if (!wallet) return setView({ kind: "not_in_build" });
    const gen = ++generation.current;
    setView({ kind: "loading" });
    const page = await wallet.history().catch(() => ({ kind: "unavailable" }) as const);
    if (gen !== generation.current) return;
    if (page.kind !== "page") return setView({ kind: page.kind });
    setView({ kind: "list", items: page.items, ...(page.next ? { next: page.next } : {}), more: "idle" });
  }, [status.kind, wallet]);

  useFocusEffect(useCallback(() => void load(), [load]));

  const older = async () => {
    if (!wallet || view.kind !== "list" || !view.next || view.more === "loading") return;
    const gen = generation.current;
    const cursor = view.next;
    setView({ ...view, more: "loading" });
    const page = await wallet.history(cursor).catch(() => ({ kind: "unavailable" }) as const);
    if (gen !== generation.current) return;
    setView((v) => {
      if (v.kind !== "list") return v;
      if (page.kind !== "page") return { ...v, more: "failed" };
      const seen = new Set(v.items.map((i) => `${i.txHash}:${i.logIndex}`));
      const items = [...v.items, ...page.items.filter((i) => !seen.has(`${i.txHash}:${i.logIndex}`))];
      return { kind: "list", items, ...(page.next ? { next: page.next } : {}), more: "idle" };
    });
  };

  if (view.kind === "loading") {
    return (
      <Page title={t("HM-PAY-03.title")}>
        <View style={{ alignItems: "center", gap: s.md, paddingTop: s.x3 }} accessibilityLiveRegion="polite">
          <ActivityIndicator color={p.mark} />
          <T v="body" color="soft">{t("HM-PAY-03.loading")}</T>
        </View>
      </Page>
    );
  }

  if (view.kind !== "list") {
    const key = view.kind === "unavailable" ? "HM-PAY-03.unavailable" : view.kind === "none" ? "HM-PAY-03.none" : "HM-PAY-01.notInBuild";
    return (
      <Page title={t("HM-PAY-03.title")}>
        <View style={{ gap: s.lg }}>
          <T v="body" role="text">{t(key)}</T>
          {view.kind === "unavailable" ? <Btn label={t("HM-PAY-03.retry")} icon="refresh-cw" onPress={() => void load()} /> : null}
        </View>
      </Page>
    );
  }

  const now = Date.now();
  return (
    <Page title={t("HM-PAY-03.title")} action={<IconBtn icon="info" label={t("HM-PAY-03.info.open")} tone="textSoft" onPress={() => setInfo(true)} />}>
      {view.items.length ? (
        <Group lead="tile">
          {view.items.map((item) => <TransferItem key={`${item.txHash}:${item.logIndex}`} item={item} now={now} logLink />)}
        </Group>
      ) : (
        <T v="body" color="soft">{t("HM-PAY-03.empty")}</T>
      )}
      <View style={{ gap: s.md, paddingTop: s.xl }}>
        {view.next ? (
          <Btn label={view.more === "loading" ? t("HM-PAY-03.loadingOlder") : t("HM-PAY-03.older")} kind="secondary" full busy={view.more === "loading"} onPress={() => void older()} />
        ) : (
          <T v="footnote" color="soft" style={{ paddingHorizontal: s.lg }}>{t("HM-PAY-03.floor")}</T>
        )}
        {view.more === "failed" ? <T v="small" color="coral" live="polite">{t("HM-PAY-03.olderFailed")}</T> : null}
      </View>
      <InfoSheet visible={info} onClose={() => setInfo(false)} title={t("HM-PAY-03.info.title")} paragraphs={[t("HM-PAY-03.onlyUsdt"), t("HM-PAY-03.source"), t("HM-PAY-01.testnet")]} />
    </Page>
  );
}
