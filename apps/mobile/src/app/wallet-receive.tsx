// HM-PAY-04: receive (US-PAY-04). The wallet's public address, its QR code (made on the phone by @hermit/core's encoder,
// no network call), Copy the address (a plain clip, not marked sensitive: the address is public) and the network,
// stated first and in full: Stable testnet USD₮0 only. States: ST-LOAD, ST-ERROR with retry, not in this build, none,
// lost (no code: restore first), needs backup (the code, with the backup banner), ready. Nothing here needs a fingerprint.
// Design pass: the network warning first in amber, the code ink on paper in both themes, the address in groups of four.
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, useWindowDimensions, View } from "react-native";
import { encodeQr } from "@hermit/core";
import type { WalletSummary } from "@hermit/runtime";
import { copyAddress } from "../adapters/wallet";
import { Btn, Card, Label, Note, Page, T, WholeAddress } from "../components/kit";
import { useHermit } from "../hermit-context";
import { t } from "../i18n";
import { radius, s, shadow } from "../theme";
import { usePalette } from "../use-palette";
import { qrCells, receiveQrText } from "../wallet-view";

type View_ = { kind: "loading" } | { kind: "error" } | { kind: "not_in_build" } | WalletSummary;

/** The address in groups of four after 0x, for reading aloud or comparing by eye; Copy copies it whole. */

export default function WalletReceive() {
  const p = usePalette();
  const router = useRouter();
  const { status } = useHermit();
  const wallet = status.kind === "ready" ? status.hermit.wallet : undefined;
  const [view, setView] = useState<View_>({ kind: "loading" });
  const [copied, setCopied] = useState<"copied" | "copyFailed">();

  const load = useCallback(async () => {
    if (status.kind === "failed") return setView({ kind: "error" });
    if (status.kind !== "ready") return;
    if (!wallet) return setView({ kind: "not_in_build" });
    try {
      setView(await wallet.summary());
    } catch {
      setView({ kind: "error" });
    }
  }, [status.kind, wallet]);

  useFocusEffect(useCallback(() => void load(), [load]));

  const copy = async (address: string) => {
    try {
      await copyAddress(address);
      setCopied("copied");
    } catch {
      setCopied("copyFailed");
    }
  };

  const network = (
    <Card tone="amber" style={{ gap: s.xs }}>
      <View accessibilityRole="summary" style={{ gap: s.xs }}>
        <Note icon="triangle-alert" tone="amber" text={t("HM-PAY-04.network")} textColor="text" v="bodyStrong" />
        <T v="small" color="soft">{t("HM-PAY-04.networkBody")}</T>
      </View>
    </Card>
  );

  if (view.kind === "loading") {
    return (
      <Page title={t("HM-PAY-04.title")}>
        <View style={{ alignItems: "center", gap: s.md, paddingTop: s.x3 }} accessibilityLiveRegion="polite">
          <ActivityIndicator color={p.mark} />
          <T v="body" color="soft">{t("HM-PAY-04.loading")}</T>
        </View>
      </Page>
    );
  }

  if (view.kind === "error" || view.kind === "not_in_build" || view.kind === "none") {
    const key = view.kind === "error" ? "HM-PAY-04.error" : view.kind === "none" ? "HM-PAY-04.none" : "HM-PAY-01.notInBuild";
    return (
      <Page title={t("HM-PAY-04.title")}>
        <View style={{ gap: s.lg }}>
          <T v="body" role="text">{t(key)}</T>
          {view.kind === "error" ? <Btn label={t("common.retry")} icon="refresh-cw" onPress={() => { setView({ kind: "loading" }); void load(); }} /> : null}
          {view.kind === "none" ? <Btn label={t("HM-PAY-01.title")} icon="wallet" onPress={() => router.replace("/wallet")} /> : null}
        </View>
      </Page>
    );
  }

  if (view.status === "lost") {
    return (
      <Page title={t("HM-PAY-04.title")}>
        <View style={{ gap: s.lg }}>
          {network}
          <T v="body" color="coral" role="text">{t("HM-PAY-04.lost")}</T>
          <Btn label={t("HM-PAY-01.restore")} icon="key-round" full onPress={() => router.push({ pathname: "/wallet-words", params: { mode: "restore" } })} />
        </View>
      </Page>
    );
  }

  return (
    <Page title={t("HM-PAY-04.title")}>
      {network}
      {view.status === "needs_backup" ? (
        <Card tone="amber" style={{ gap: s.sm, marginTop: s.md }}>
          <T v="body">{t("HM-PAY-04.backupFirst")}</T>
          <Btn label={t("HM-PAY-04.backup")} kind="amber" icon="key-round" onPress={() => router.push({ pathname: "/wallet-words", params: { mode: "backup" } })} />
        </Card>
      ) : null}
      <View style={{ marginTop: s.xl }}>
        <Qr address={view.address} />
      </View>
      <Label>{t("HM-PAY-04.addressTitle")}</Label>
      <View style={{ backgroundColor: p.raised, borderRadius: radius.card, padding: s.lg, gap: s.md, boxShadow: shadow(p, "raised") }}>
        <WholeAddress address={view.address} v="mono" color="text" />
        <Btn label={t("HM-PAY-04.copy")} icon="copy" full onPress={() => void copy(view.address)} />
        {copied ? <T v="small" color={copied === "copied" ? "soft" : "coral"} live="polite">{t(`HM-PAY-04.${copied}`)}</T> : null}
      </View>
      <T v="caption" color="soft" style={{ marginTop: s.md, paddingHorizontal: s.lg }}>{t("HM-PAY-01.testnet")}</T>
    </Page>
  );
}

/** Ink modules on paper with a quiet zone, whatever the theme: scanners need dark on light. */
function Qr({ address }: { address: string }) {
  const p = usePalette();
  const { width } = useWindowDimensions();
  const cells = useMemo(() => qrCells(encodeQr(receiveQrText(address))), [address]);
  const unit = Math.max(2, Math.floor(Math.min(width - 96, 288) / cells.side));
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={t("HM-PAY-04.qrLabel")}
      style={{ padding: s.lg, backgroundColor: p.qrPaper, alignSelf: "center", borderRadius: radius.card }}
    >
      <View style={{ width: unit * cells.side, height: unit * cells.side }}>
        {cells.rects.map((r) => (
          <View key={`${r.x}:${r.y}`} style={{ position: "absolute", left: r.x * unit, top: r.y * unit, width: r.w * unit, height: unit, backgroundColor: p.qrInk }} />
        ))}
      </View>
    </View>
  );
}
