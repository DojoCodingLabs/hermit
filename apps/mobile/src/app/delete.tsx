// HM-SET-03: delete everything (US-SET-03). The rules live in @hermit/runtime (eraseReducer) and the plan in
// @hermit/core (erasePlan, runErase); this screen wires the phone to them. Once the erase starts there is no
// way back: it finishes, or it fails and resumes on retry or on the next launch, then the app starts fresh.
// Design pass: the wallet warning as a coral card, what goes as coral-marked lines, the typed word in a large field,
// and Erase with fingerprint in coral; the erase shows a progress bar and words, then the crab done. Polish round:
// the title is the page's large title in every state (it was drawn inside the content, and missing on the warning).
import { reloadAppAsync } from "expo";
import { Stack } from "expo-router";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { BackHandler, View } from "react-native";
import { eraseReducer, initialErase, confirmationMatches, type EraseScreen } from "@hermit/runtime";
import { notificationAccessEnabled, openNotificationAccessSettings } from "../adapters";
import { confirmErase, eraseEverything, phoneHasLock, walletBalance } from "../adapters/erase";
import { Icon } from "../components/Icon";
import { Btn, Card, Empty, Failed, Input, Note as NoteLine, Notice, Page, T } from "../components/kit";
import { useHermit } from "../hermit-context";
import { t } from "../i18n";
import { radius, s } from "../theme";
import { usePalette } from "../use-palette";

// Read at use, not at import: the word follows the app language (HM-SET-05).
const word = () => t("HM-SET-03.confirmWord");
const LIST = ["listData", "listMessages", "listKeys", "listCache", "listModel"] as const;

interface Facts {
  initial: EraseScreen;
  hasLock: boolean;
  notifAccess: boolean;
}

export default function DeleteEverything() {
  const { status } = useHermit();
  const [facts, setFacts] = useState<Facts>();

  // An interrupted erase resumes at once; otherwise the wallet warning comes first when it holds money.
  useEffect(() => {
    if (status.kind === "erase_pending") {
      setFacts({ initial: initialErase({ resume: { done: status.done, total: status.total } }), hasLock: true, notifAccess: false });
      return;
    }
    let alive = true;
    void (async () => {
      const walletBalanceNow = await walletBalance().catch(() => undefined);
      const hasLock = await phoneHasLock().catch(() => true);
      if (alive) setFacts({ initial: initialErase({ walletBalance: walletBalanceNow }), hasLock, notifAccess: notificationAccessEnabled() });
    })();
    return () => {
      alive = false;
    };
    // Facts are read once, when the screen opens; a later status change must not restart the flow.
  }, []);

  if (!facts) return <Page title={t("HM-SET-03.title")}>{null}</Page>;
  return <Flow {...facts} />;
}

function Flow({ initial, hasLock, notifAccess }: Facts) {
  const [screen, dispatch] = useReducer(eraseReducer, initial);
  const running = useRef(false);
  // From the fingerprint on there is no way back: no header back, no swipe, no hardware back.
  const locked = screen.kind !== "wallet_warning" && screen.kind !== "confirm";
  useEffect(() => {
    if (!locked) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => true);
    return () => sub.remove();
  }, [locked]);

  const erase = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    const result = await eraseEverything((done, total) => dispatch({ type: "progress", done, total })).catch(() => ({ ok: false as const }));
    running.current = false;
    dispatch(result.ok ? { type: "finished" } : { type: "failed" });
  }, []);

  // Erasing starts (or resumes) as soon as the state machine says so.
  useEffect(() => {
    if (screen.kind === "erasing" && !running.current) void erase();
  }, [screen.kind, erase]);

  // ST-SUCCESS, then first launch: a fresh start with nothing in memory either.
  useEffect(() => {
    if (screen.kind !== "done") return;
    const timer = setTimeout(() => void reloadAppAsync("Hermit was erased"), 1200);
    return () => clearTimeout(timer);
  }, [screen.kind]);

  const submit = useCallback(async () => {
    if (screen.kind !== "confirm" || !confirmationMatches(screen.typed, word())) return;
    dispatch({ type: "submit", word: word() });
    dispatch({ type: "auth", ok: await confirmErase(t("HM-SET-03.fingerprintPrompt")).catch(() => false) });
  }, [screen]);

  // The page's own large title, like every screen; a resumed erase says so, and the end is the crab alone.
  const title = screen.kind === "done" ? undefined : screen.kind === "erasing" && screen.resumed && screen.done > 0 ? t("HM-SET-03.resuming") : t("HM-SET-03.title");
  return (
    <Page back={!locked} {...(title ? { title } : {})}>
      <Stack.Screen options={{ gestureEnabled: !locked }} />
      <Body screen={screen} hasLock={hasLock} notifAccess={notifAccess} onType={(text) => dispatch({ type: "type", text })} onSubmit={submit} onWalletAck={() => dispatch({ type: "wallet_ack" })} onRetry={() => dispatch({ type: "retry" })} />
    </Page>
  );
}

function Body(props: { screen: EraseScreen; hasLock: boolean; notifAccess: boolean; onType(text: string): void; onSubmit(): void; onWalletAck(): void; onRetry(): void }) {
  const p = usePalette();
  const { screen } = props;
  switch (screen.kind) {
    case "wallet_warning":
      return (
        <View style={{ gap: s.lg }}>
          <Card tone="coral">
            <View style={{ gap: s.sm }}>
              <View style={{ flexDirection: "row", gap: s.sm, alignItems: "center" }}>
                <Icon name="wallet" size={24} color={p.coral} />
                <T v="lead" role="header" style={{ flex: 1 }}>{t("HM-SET-03.walletTitle")}</T>
              </View>
              <T v="body">{t("HM-SET-03.walletBody", { balance: screen.balance })}</T>
            </View>
          </Card>
          <Btn label={t("HM-SET-03.walletContinue")} kind="secondary" full onPress={props.onWalletAck} />
        </View>
      );
    case "confirm":
    case "authenticating": {
      const ok = screen.kind === "confirm" && confirmationMatches(screen.typed, word());
      return (
        <View style={{ gap: s.lg }}>
          <T v="body">{t("HM-SET-03.body")}</T>
          {/* What goes, on the page color with coral marks. */}
          <View style={{ gap: s.sm }}>
            {LIST.map((k) => <NoteLine key={k} icon="trash-2" tone="coral" text={t(`HM-SET-03.${k}`)} textColor="text" v="body" />)}
          </View>
          <NoteLine icon="info" text={t("HM-SET-03.permissionsStay")} />
          {props.notifAccess ? <Btn label={t("HM-SET-03.openNotificationAccess")} kind="secondary" icon="settings" small onPress={openNotificationAccessSettings} /> : null}
          <Input
            label={t("HM-SET-03.typePrompt", { word: word() })}
            value={screen.typed}
            onChange={props.onType}
            big
            field={{ editable: screen.kind === "confirm", autoCapitalize: "characters" }}
          />
          {!props.hasLock ? <NoteLine icon="lock" text={t("HM-SET-03.noLock")} /> : null}
          {screen.kind === "confirm" && screen.authFailed ? <Notice tone="bad" text={t("HM-SET-03.authFailed")} /> : null}
          <Btn
            label={t("HM-SET-03.erase")}
            kind="coral"
            icon="fingerprint"
            full
            disabled={!ok}
            busy={screen.kind === "authenticating"}
            hint={ok ? undefined : t("HM-SET-03.typeHint", { word: word() })}
            onPress={props.onSubmit}
          />
          {!ok && screen.kind === "confirm" ? <T v="small" color="soft">{t("HM-SET-03.typeHint", { word: word() })}</T> : null}
        </View>
      );
    }
    case "erasing":
    case "failed": {
      const pct = screen.total ? Math.round((screen.done / screen.total) * 100) : 0;
      return (
        <View style={{ gap: s.lg }}>
          <T v="body" live="polite">{t("HM-SET-03.erasing", { done: screen.done, total: screen.total })}</T>
          <View style={{ height: 8, borderRadius: radius.pill, overflow: "hidden", backgroundColor: p.track }} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: pct }}>
            <View style={{ height: 8, width: `${pct}%`, backgroundColor: screen.kind === "erasing" ? p.meter : p.soft }} />
          </View>
          {screen.kind === "erasing" ? (
            <T v="small" color="soft">{t("HM-SET-03.erasingBody")}</T>
          ) : (
            <Failed text={t("HM-SET-03.failed")} onRetry={props.onRetry} />
          )}
        </View>
      );
    }
    case "done":
      return <Empty pose="done" body={<T v="title" center live="polite">{t("HM-SET-03.done")}</T>} />;
  }
}
