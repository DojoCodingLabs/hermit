// HM-REM-01: upcoming reminders, soonest first, with cancel (US-REM-03). Cancel is the same as the chat's
// reminder_cancel: through the cage and into the signed log (it shows in Activity). States from the W1 states
// spec: ST-LOAD, ST-EMPTY-FIRST (how to make one in the chat), ST-IDEAL, ST-ERROR with retry.
// Design pass: one grouped list, each reminder's words then its time said the way people say one ("Mañana, 9:00
// a.m."), and Cancel in words; the calendar choice as a row under it; the empty state is the crab with Go to chat.
import { openHermitChat } from "../open-chat";
import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, AppState } from "react-native";
import type { Reminder } from "@hermit/core";
import { Btn, Empty, Failed, Group, Loading, Notice, Page, Row, Status, T } from "../components/kit";
import { ahead } from "../format";
import { useHermit } from "../hermit-context";
import { currentLocale, t } from "../i18n";
import { s } from "../theme";

type Load = { kind: "loading" } | { kind: "error" } | { kind: "ready"; rows: Reminder[] };
type Note = { key: string; error: boolean };

export default function Reminders() {
  const { status } = useHermit();
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [busy, setBusy] = useState<number>();
  const [note, setNote] = useState<Note>();

  const refresh = useCallback(async () => {
    if (status.kind !== "ready") return;
    try {
      setLoad({ kind: "ready", rows: await status.hermit.reminders.upcoming() });
    } catch {
      setLoad({ kind: "error" });
    }
  }, [status]);

  useEffect(() => {
    void refresh();
    // A reminder may have gone off while the app was in the background.
    const sub = AppState.addEventListener("change", (s) => s === "active" && void refresh());
    return () => sub.remove();
  }, [refresh]);

  // Said the way people say a time to come: "Mañana, 9:00 a.m.", "Sábado, 12:49 p.m.", then "24 nov, 10:49 p.m.".
  const whenOf = (r: Reminder) => {
    const at = ahead(r.at, Date.now(), currentLocale());
    return t(at.key, at.vars);
  };

  const cancel = async (r: Reminder) => {
    if (status.kind !== "ready") return;
    setBusy(r.id);
    setNote(undefined);
    try {
      const out = await status.hermit.reminders.cancel(r.id);
      setNote(out === "cancelled" ? { key: "HM-REM-01.cancelled", error: false } : out === "gone" ? { key: "HM-REM-01.gone", error: false } : { key: "HM-REM-01.blocked", error: true });
    } catch {
      setNote({ key: "HM-REM-01.cancelError", error: true });
    } finally {
      setBusy(undefined);
      await refresh();
    }
  };
  const confirm = (r: Reminder) =>
    Alert.alert(t("HM-REM-01.confirmTitle"), `${r.text}\n${whenOf(r)}`, [
      { text: t("HM-REM-01.confirmNo"), style: "cancel" },
      { text: t("HM-REM-01.confirmYes"), style: "destructive", onPress: () => void cancel(r) },
    ]);

  const calendarLink = (
    <Group style={{ marginTop: s.xl }}>
      <Row icon="calendar" title={t("HM-REM-01.calendarLink")} chevron role="link" onPress={() => router.push("/calendar")} />
    </Group>
  );

  if (load.kind === "loading") {
    return (
      <Page title={t("HM-REM-01.title")}>
        <Loading text={t("HM-REM-01.loading")} />
      </Page>
    );
  }

  if (load.kind === "error") {
    return (
      <Page title={t("HM-REM-01.title")}>
        <Failed text={t("HM-REM-01.loadError")} onRetry={() => void refresh()} />
      </Page>
    );
  }

  const noteView = note ? <Notice tone={note.error ? "bad" : "ok"} text={t(note.key)} /> : null;
  if (!load.rows.length) {
    return (
      <Page title={t("HM-REM-01.title")}>
        {noteView}
        <Empty pose="idle" title={t("HM-REM-01.emptyTitle")} body={t("HM-REM-01.emptyBody")}>
          <Btn label={t("HM-REM-01.emptyAction")} icon="message-circle" full onPress={() => openHermitChat(router, "stack")} />
        </Empty>
        {calendarLink}
      </Page>
    );
  }

  return (
    <Page title={t("HM-REM-01.title")}>
      {noteView}
      <Group>
        {load.rows.map((item) => {
          const when = whenOf(item);
          return (
            <Row
              key={item.id}
              title={<T v="body" lines={2}>{item.text}</T>}
              sub={<T v="footnote" color="soft">{when}</T>}
              trailing={busy === item.id ? (
                <Status text={t("HM-REM-01.cancelling")} />
              ) : (
                <Btn label={t("HM-REM-01.cancel")} a11y={t("HM-REM-01.cancelLabel", { text: item.text, when })} kind="text" small disabled={busy !== undefined} onPress={() => confirm(item)} />
              )}
            />
          );
        })}
      </Group>
      {calendarLink}
    </Page>
  );
}
