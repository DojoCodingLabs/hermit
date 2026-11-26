// Dev-only: the SL-17 wallet worklet spike (docs/research/wdk-worklet-spike.md). Open with hermit://wallet-debug.
// Starts Tether WDK in its own worklet (its own instance, not the product wallet's), creates a throwaway Stable testnet
// wallet sealed with a throwaway key this screen holds in memory only (never stored, never the wallet key), opens it,
// reads its USD₮0 balance, signs a test TransferWithAuthorization that is never sent, verifies it here, and checks
// that the worklet refuses what it must. States: no bundle in this build, not a debug build, idle, starting,
// running, failed.
import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Page } from "../components/kit";
import { getRandomBytes } from "expo-crypto";
import { createInWorklet, openWallet, readBalance, workletSigner, type WalletInfo } from "@hermit/payments";
import { startWalletWorklet, walletBundleAvailable, type WalletWorklet } from "../adapters/wallet-worklet";
import { t } from "../i18n";
import { radius } from "../theme";
import { usePalette } from "../use-palette";

const USDT0 = "0x78Cf24370174180738C5B8E352B6D14c83a6c9A9";
const TEST_PAYEE = "0x209693Bc6afc0C5328bA36FaF03C514EF312287C";

type Phase = "idle" | "starting" | "running";

export default function WalletDebug() {
  const p = usePalette();
  const running = useRef<WalletWorklet | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [info, setInfo] = useState<WalletInfo>();
  const [balance, setBalance] = useState<{ usdt0: bigint; native: bigint }>();
  const [timings, setTimings] = useState({ start: 0, open: 0, balance: 0, sign: 0 });
  const [signed, setSigned] = useState(false);
  const [refusals, setRefusals] = useState<[string, string][]>([]);
  const [error, setError] = useState<string>();

  useEffect(() => () => void running.current?.stop(), []);

  if (!__DEV__) return null;
  if (!walletBundleAvailable()) {
    return (
      <Page title={t("HM-DEV-02.title")}>
        <View style={styles.body}>
          <Text style={[styles.text, { color: p.blocked }]}>{t("HM-DEV-02.unavailable")}</Text>
        </View>
      </Page>
    );
  }

  const fail = (err: unknown) => setError(String((err as Error)?.message ?? err));

  const start = async () => {
    setError(undefined);
    setPhase("starting");
    try {
      const t0 = Date.now();
      const w = startWalletWorklet();
      running.current = w;
      const t1 = Date.now();
      // Throwaway: a random key in this screen's memory, a wallet sealed with it and opened again for the signing test.
      const key = getRandomBytes(32);
      const made = await createInWorklet(w.client, { id: "debug", key, words: 12 });
      const opened = await openWallet(w.client, { id: "debug", key, sealed: made.sealed });
      key.fill(0);
      const t2 = Date.now();
      const b = await readBalance(w.client, opened.address);
      setTimings((x) => ({ ...x, start: t1 - t0, open: t2 - t1, balance: Date.now() - t2 }));
      setInfo(opened);
      setBalance(b);
      setPhase("running");
    } catch (err) {
      fail(err);
      setPhase("idle");
    }
  };

  const refresh = async () => {
    if (!running.current) return;
    try {
      const t0 = Date.now();
      if (!info) return;
      setBalance(await readBalance(running.current.client, info.address));
      setTimings((x) => ({ ...x, balance: Date.now() - t0 }));
    } catch (err) {
      fail(err);
    }
  };

  const sign = async () => {
    const w = running.current;
    if (!w || !info) return;
    setError(undefined);
    setSigned(false);
    const typedData = {
      domain: { name: "USD₮0", version: "1", chainId: 2201, verifyingContract: USDT0 },
      primaryType: "TransferWithAuthorization" as const,
      message: { from: info.address, to: TEST_PAYEE, value: "10000", validAfter: "0", validBefore: "1800000000", nonce: "0x" + "00".repeat(31) + "2a" },
    };
    try {
      const t0 = Date.now();
      await workletSigner(w.client, info.address).signTypedData(typedData);
      setTimings((x) => ({ ...x, sign: Date.now() - t0 }));
      setSigned(true);
      // What the worklet itself must refuse, sent raw so the app-side checks don't stop them first.
      const cases: [string, Record<string, unknown> | undefined, string][] = [
        ["otherChain", { domain: { ...typedData.domain, chainId: 988 }, message: typedData.message }, "signTransferWithAuthorization"],
        ["otherPayer", { domain: typedData.domain, message: { ...typedData.message, from: TEST_PAYEE } }, "signTransferWithAuthorization"],
        ["extraField", { domain: typedData.domain, message: { ...typedData.message, extra: "1" } }, "signTransferWithAuthorization"],
      ];
      const out: [string, string][] = [];
      for (const [name, params, method] of cases) {
        const code = await w.client.call(method as "signTransferWithAuthorization", params).then(
          () => "SIGNED (should have refused)",
          (e: { code?: string }) => e.code ?? "error",
        );
        out.push([name, code]);
      }
      setRefusals(out);
    } catch (err) {
      fail(err);
    }
  };

  const stop = async () => {
    await running.current?.stop();
    running.current = null;
    setPhase("idle");
    setInfo(undefined);
    setBalance(undefined);
    setSigned(false);
    setRefusals([]);
  };

  const button = (label: string, onPress: () => void, primary = false) => (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={[styles.button, primary ? { backgroundColor: p.accent, borderColor: p.accent } : { borderColor: p.border }]}>
      <Text style={{ color: primary ? p.onAccent : p.text, fontWeight: "600" }}>{label}</Text>
    </Pressable>
  );

  return (
    <Page title={t("HM-DEV-02.title")}>
      <View style={styles.body}>
        <Text style={[styles.section, { color: p.text }]} accessibilityRole="header">{t("HM-DEV-02.title")}</Text>
        <Text style={[styles.text, { color: p.textSoft }]}>{t("HM-DEV-02.intro")}</Text>
        {phase === "idle" ? button(t("HM-DEV-02.start"), start, true) : null}
        {phase === "starting" ? <Text style={[styles.state, { color: p.textSoft }]} accessibilityLiveRegion="polite">{t("HM-DEV-02.starting")}</Text> : null}
        {phase === "running" && info && balance ? (
          <>
            <Text style={[styles.mono, { color: p.text }]}>{t("HM-DEV-02.address", { address: info.address, path: info.path })}</Text>
            <Text style={[styles.text, { color: p.text }]}>{t("HM-DEV-02.balance", { usdt0: balance.usdt0.toString(), native: balance.native.toString() })}</Text>
            {button(t("HM-DEV-02.refresh"), refresh)}
            {button(t("HM-DEV-02.sign"), sign, true)}
            {signed ? <Text style={[styles.state, { color: p.accent }]} accessibilityLiveRegion="polite">{t("HM-DEV-02.signed")}</Text> : null}
            {refusals.length > 0 ? <Text style={[styles.section, { color: p.text }]} accessibilityRole="header">{t("HM-DEV-02.refuseTitle")}</Text> : null}
            {refusals.map(([name, code]) => (
              <Text key={name} style={[styles.mono, { color: p.text }]}>{t("HM-DEV-02.refused", { case: name, code })}</Text>
            ))}
            <Text style={[styles.mono, { color: p.textSoft }]}>{t("HM-DEV-02.timings", timings)}</Text>
            {button(t("HM-DEV-02.stop"), stop)}
          </>
        ) : null}
        {error ? <Text style={[styles.text, { color: p.blocked }]} accessibilityLiveRegion="polite">{t("HM-DEV-02.failed", { message: error })}</Text> : null}
      </View>
    </Page>
  );
}

const styles = StyleSheet.create({
  body: { padding: 20, gap: 10, paddingBottom: 48 },
  section: { fontSize: 13, fontWeight: "600", marginTop: 16 },
  text: { fontSize: 14, lineHeight: 20 },
  state: { fontSize: 15, fontWeight: "600" },
  mono: { fontSize: 12, fontFamily: "monospace" },
  button: { alignSelf: "flex-start", minHeight: 48, justifyContent: "center", borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 16, paddingVertical: 8 },
});
