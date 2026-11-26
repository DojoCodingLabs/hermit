// HM-PAY-05: spending caps and saved payees (US-PAY-06, US-PAY-05, PDR-011). The rules live in @hermit/runtime's
// payments service: the caps' checks, the payee's checks (a whole 0x address, its EIP-55 checksum when mixed case, not
// the wallet's own, not saved twice), a strong-biometric fingerprint before anything changes, and a log entry by hash.
// States: ST-LOAD, ST-ERROR with retry, not in this build (no wallet bundle or no approval key), ready with the caps in
// force (Hermit's defaults until changed, said so), what the last 24 hours used, the payees, and a note after each try.
// No skill writes here: the model can never add a payee or raise a cap. Design pass (W4): the two caps side by side with
// what the last 24 hours used as a meter, then payees as people, names first.
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { formatMoney, usdt, type Money, type Payee } from "@hermit/core";
import { useHermit } from "../hermit-context";
import { currentLocale, t } from "../i18n";
import { capMoney } from "../wallet-view";
import { baseUnitsText, capsAmount } from "../pay-view";
import { Avatar, Btn, Group, Input, Label, Meter, Note as NoteLine, Page, T, WholeAddress } from "../components/kit";
import { radius, s, shadow } from "../theme";
import { usePalette } from "../use-palette";

type Ready = { kind: "ready"; custom: boolean; spentToday: Money; payees: Payee[] };
type View_ = { kind: "loading" } | { kind: "error" } | { kind: "not_in_build" } | Ready;
/** A copy key under HM-PAY-05, with its variables. */
type Note = { key: string; vars?: Record<string, string>; bad?: boolean };

export default function WalletCaps() {
  const p = usePalette();
  const { status } = useHermit();
  const payments = status.kind === "ready" ? status.hermit.payments : undefined;
  const [view, setView] = useState<View_>({ kind: "loading" });
  const [perPayment, setPerPayment] = useState("");
  const [perDay, setPerDay] = useState("");
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [capsNote, setCapsNote] = useState<Note>();
  const [payeeNote, setPayeeNote] = useState<Note>();
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (status.kind === "failed") return setView({ kind: "error" });
    if (status.kind !== "ready") return;
    if (!payments) return setView({ kind: "not_in_build" });
    try {
      const [c, payees] = await Promise.all([payments.caps(), payments.payees()]);
      setPerPayment(baseUnitsText(c.caps.perPayment.amount));
      setPerDay(baseUnitsText(c.caps.perDay.amount));
      setView({ kind: "ready", custom: c.custom, spentToday: c.spentToday, payees });
    } catch {
      setView({ kind: "error" });
    }
  }, [status.kind, payments]);

  useFocusEffect(useCallback(() => void load(), [load]));

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  const saveCaps = () => run(async () => {
    if (!payments) return;
    const a = capsAmount(perPayment);
    const b = capsAmount(perDay);
    if (a === undefined || b === undefined) return setCapsNote({ key: "HM-PAY-05.problem.amount", bad: true });
    try {
      const r = await payments.setCaps({ perPayment: usdt(a), perDay: usdt(b) }, t("HM-PAY-05.capsPrompt"));
      if (r.kind === "invalid") return setCapsNote({ key: `HM-PAY-05.problem.${r.problem}`, bad: true });
      if (r.kind === "cancelled") return setCapsNote({ key: "HM-PAY-05.note.cancelled" });
      setCapsNote({ key: "HM-PAY-05.note.capsSaved" });
      await load();
    } catch {
      setCapsNote({ key: "HM-PAY-05.note.failed", bad: true });
    }
  });

  const savePayee = () => run(async () => {
    if (!payments) return;
    const who = name.trim();
    try {
      const r = await payments.savePayee(who, address, t("HM-PAY-05.payeePrompt", { name: who || "?" }));
      if (r.kind === "invalid") return setPayeeNote({ key: `HM-PAY-05.payee.${r.problem}`, bad: true });
      if (r.kind === "exists") return setPayeeNote({ key: "HM-PAY-05.payee.exists", bad: true });
      if (r.kind === "cancelled") return setPayeeNote({ key: "HM-PAY-05.note.cancelled" });
      setName("");
      setAddress("");
      setPayeeNote({ key: "HM-PAY-05.note.payeeSaved", vars: { name: r.payee.name } });
      await load();
    } catch {
      setPayeeNote({ key: "HM-PAY-05.note.failed", bad: true });
    }
  });

  const removePayee = (payee: Payee) => run(async () => {
    if (!payments) return;
    try {
      const r = await payments.removePayee(payee.id, t("HM-PAY-05.removePrompt", { name: payee.name }));
      setPayeeNote({ key: r === "removed" ? "HM-PAY-05.note.payeeRemoved" : r === "gone" ? "HM-PAY-05.note.payeeGone" : "HM-PAY-05.note.cancelled" });
      if (r !== "cancelled") await load();
    } catch {
      setPayeeNote({ key: "HM-PAY-05.note.failed", bad: true });
    }
  });

  if (view.kind === "loading") {
    return (
      <Page title={t("HM-PAY-05.title")}>
        <View style={{ alignItems: "center", gap: s.md, paddingTop: s.x3 }} accessibilityLiveRegion="polite">
          <ActivityIndicator color={p.mark} />
          <T v="body" color="soft">{t("HM-PAY-05.loading")}</T>
        </View>
      </Page>
    );
  }

  if (view.kind !== "ready") {
    return (
      <Page title={t("HM-PAY-05.title")}>
        <View style={{ gap: s.lg }}>
          <T v="body" role="text">{t(view.kind === "error" ? "HM-PAY-05.error" : "HM-PAY-05.notInBuild")}</T>
          {view.kind === "error" ? <Btn label={t("common.retry")} icon="refresh-cw" onPress={() => { setView({ kind: "loading" }); void load(); }} /> : null}
        </View>
      </Page>
    );
  }

  // On the shell group coral text would miss AA (4.0:1): a problem is said in text color with a coral icon.
  const noteText = (n: Note) => (n.bad ? <View accessibilityLiveRegion="polite"><NoteLine icon="circle-alert" tone="coral" text={t(n.key, n.vars)} textColor="text" /></View> : <T v="small" color="soft" live="polite">{t(n.key, n.vars)}</T>);
  const perDayNow = capsAmount(perDay);

  return (
    <Page title={t("HM-PAY-05.title")} subtitle={<T v="body" color="soft">{t("HM-PAY-05.intro")}</T>}>
      <Label style={{ marginTop: 0 }}>{t("HM-PAY-05.capsTitle")}</Label>
      <View style={{ backgroundColor: p.raised, borderRadius: radius.card, padding: s.lg, gap: s.lg, boxShadow: shadow(p, "raised") }}>
        <View style={{ flexDirection: "row", gap: s.md, flexWrap: "wrap" }}>
          <Input label={t("HM-PAY-05.perPayment")} value={perPayment} onChange={setPerPayment} numeric big unit="USD₮" style={{ flex: 1, minWidth: 130 }} />
          <Input label={t("HM-PAY-05.perDay")} value={perDay} onChange={setPerDay} numeric big unit="USD₮" style={{ flex: 1, minWidth: 130 }} />
        </View>
        {!view.custom ? <T v="small" color="soft">{t("HM-PAY-05.defaults")}</T> : null}
        <View style={{ gap: 6 }}>
          <T v="small" color="soft">{t("HM-PAY-05.spentToday", { amount: capMoney(view.spentToday, currentLocale(), formatMoney) })}</T>
          {perDayNow !== undefined ? <Meter used={Number(view.spentToday.amount)} cap={Number(perDayNow)} over={view.spentToday.amount >= perDayNow} /> : null}
        </View>
        <Btn label={t("HM-PAY-05.saveCaps")} icon="fingerprint" full busy={busy} onPress={() => void saveCaps()} />
        {capsNote ? noteText(capsNote) : null}
        <T v="caption" color="soft">{t("HM-PAY-05.noRetry")}</T>
      </View>

      <Label>{t("HM-PAY-05.payeesTitle")}</Label>
      <T v="small" color="soft" style={{ marginBottom: s.sm, paddingHorizontal: s.lg }}>{t("HM-PAY-05.payeesIntro")}</T>
      {view.payees.length === 0 ? (
        <T v="small" color="soft" style={{ paddingHorizontal: s.lg }}>{t("HM-PAY-05.noPayees")}</T>
      ) : (
        <Group lead="avatar">
          {view.payees.map((payee) => (
            <View key={payee.id} style={{ flexDirection: "row", alignItems: "center", gap: s.md, paddingLeft: s.lg, paddingRight: s.xs, paddingVertical: s.sm, minHeight: 64 }}>
              <View accessible={false}><Avatar name={payee.name} tone="plain" /></View>
              <View style={{ flex: 1 }} accessible accessibilityLabel={`${payee.name}: ${payee.address}`}>
                <T v="bodyStrong">{payee.name}</T>
                <WholeAddress address={payee.address} />
              </View>
              <Btn label={t("HM-PAY-05.remove")} kind="text" a11y={t("HM-PAY-05.removeLabel", { name: payee.name })} disabled={busy} onPress={() => void removePayee(payee)} />
            </View>
          ))}
        </Group>
      )}

      <Label>{t("HM-PAY-05.addPayee")}</Label>
      <View style={{ backgroundColor: p.raised, borderRadius: radius.card, padding: s.lg, gap: s.md, boxShadow: shadow(p, "raised") }}>
        <Input label={t("HM-PAY-05.name")} value={name} onChange={setName} />
        <Input label={t("HM-PAY-05.address")} value={address} onChange={setAddress} mono />
        <Btn label={t("HM-PAY-05.savePayee")} kind="secondary" icon="plus" full busy={busy} onPress={() => void savePayee()} />
        {payeeNote ? noteText(payeeNote) : null}
      </View>
      <T v="caption" color="soft" style={{ marginTop: s.lg, paddingHorizontal: s.lg }}>{t("HM-PAY-01.testnet")}</T>
    </Page>
  );
}
