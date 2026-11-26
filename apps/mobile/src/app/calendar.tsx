// HM-CAL-02: which calendar Hermit writes to (US-CAL-03). The choice lives in ENT-Setting (`calendar.id`)
// and calendar_add uses it; a chosen calendar that disappears falls back to the main one, and the screen
// says so. States from the W1 states spec: ST-LOAD, ST-FORBIDDEN (calendar access off, Open settings),
// ST-EMPTY-FIRST (no writable calendar), ST-IDEAL, ST-ERROR with retry.
// Design pass: the calendars as one grouped list of radio rows (account and Main under the name); a calendar that
// disappeared is an amber notice; forbidden and empty are the crab with Open settings.
import { useCallback, useEffect, useState } from "react";
import { AppState, View } from "react-native";
import type { CalendarChoice } from "@hermit/core";
import { calendarAccessGranted, openAppSettings } from "../adapters";
import { Btn, Card, Empty, Failed, Group, Loading, Note as NoteLine, Notice, Page, Radio, T } from "../components/kit";
import { useHermit } from "../hermit-context";
import { t } from "../i18n";
import { s } from "../theme";

type Load = { kind: "loading" } | { kind: "forbidden" } | { kind: "error" } | { kind: "ready"; choice: CalendarChoice };
type Note = { key: "HM-CAL-02.saved" | "HM-CAL-02.saveError"; name: string };

export default function CalendarChoiceScreen() {
  const { status } = useHermit();
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [note, setNote] = useState<Note>();

  const refresh = useCallback(async () => {
    if (status.kind !== "ready") return;
    try {
      if (!(await calendarAccessGranted())) return setLoad({ kind: "forbidden" });
      setLoad({ kind: "ready", choice: await status.hermit.calendars.choice() });
    } catch {
      setLoad({ kind: "error" });
    }
  }, [status]);

  useEffect(() => {
    void refresh();
    // Back from the system settings: re-check access and reload.
    const sub = AppState.addEventListener("change", (s) => s === "active" && void refresh());
    return () => sub.remove();
  }, [refresh]);

  const choose = async (id: string, name: string) => {
    if (status.kind !== "ready") return;
    try {
      await status.hermit.calendars.choose(id);
      setNote({ key: "HM-CAL-02.saved", name });
    } catch {
      setNote({ key: "HM-CAL-02.saveError", name });
    }
    await refresh();
  };

  if (load.kind === "loading") {
    return (
      <Page title={t("HM-CAL-02.title")}>
        <Loading text={t("HM-CAL-02.loading")} />
      </Page>
    );
  }

  if (load.kind === "forbidden") {
    return (
      <Page title={t("HM-CAL-02.title")}>
        <Empty pose="asking" title={t("HM-CAL-02.forbiddenTitle")} body={t("HM-CAL-02.forbiddenBody")}>
          <Btn label={t("HM-CAL-02.openSettings")} icon="settings" full onPress={() => void openAppSettings()} />
        </Empty>
      </Page>
    );
  }

  if (load.kind === "error") {
    return (
      <Page title={t("HM-CAL-02.title")}>
        <Failed text={t("HM-CAL-02.loadError")} onRetry={() => void refresh()} />
      </Page>
    );
  }

  const { options, selectedId, chosenGone } = load.choice;
  if (!options.length) {
    return (
      <Page title={t("HM-CAL-02.title")}>
        <Empty pose="idle" title={t("HM-CAL-02.emptyTitle")} body={t("HM-CAL-02.emptyBody")}>
          <Btn label={t("HM-CAL-02.openSettings")} icon="settings" full onPress={() => void openAppSettings()} />
        </Empty>
      </Page>
    );
  }

  const selectedName = options.find((c) => c.id === selectedId)?.title ?? "";
  return (
    <Page title={t("HM-CAL-02.title")}>
      <View style={{ gap: s.md, marginBottom: s.lg }}>
        <T v="body" color="soft">{t("HM-CAL-02.intro")}</T>
        {chosenGone ? (
          <Card tone="amber">
            <View accessibilityRole="alert"><NoteLine icon="triangle-alert" tone="amber" text={t("HM-CAL-02.chosenGone", { name: selectedName })} textColor="text" /></View>
          </Card>
        ) : null}
        {note ? <Notice tone={note.key === "HM-CAL-02.saveError" ? "bad" : "ok"} text={note.key === "HM-CAL-02.saved" ? t(note.key, { name: note.name }) : t(note.key)} /> : null}
      </View>
      <View accessibilityRole="radiogroup" accessibilityLabel={t("HM-CAL-02.title")}>
        <Group>
          {options.map((item) => {
            const on = item.id === selectedId;
            // The account only when the name doesn't already say it (a main calendar is often named after it).
            const sub = [item.account !== item.title ? item.account : undefined, item.primary ? t("HM-CAL-02.primary") : undefined].filter(Boolean).join(" · ");
            return <Radio key={item.id} label={item.title} {...(sub ? { sub } : {})} on={on} onPress={() => !on && void choose(item.id, item.title)} />;
          })}
        </Group>
      </View>
    </Page>
  );
}
