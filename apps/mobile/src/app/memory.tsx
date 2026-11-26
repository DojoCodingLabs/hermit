// HM-MEM-02: one fact, when it was saved and where it came from, with Delete (US-MEM-04). Delete asks first,
// then runs the same delete as `forget` for this one note and signs it in the Activity log without the fact.
// States: ST-LOAD, ST-IDEAL, ST-ERROR (load or delete failed, retry), ST-EMPTY-CLEARED (the note is gone).
// Design pass: the fact large (quoted when someone else wrote it), its provenance in a card (amber for a message),
// and Delete as a coral row at the end.
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, View } from "react-native";
import { HERMIT_BOT_ID, type Note as Fact } from "@hermit/core";
import { Btn, Card, Empty, Failed, Group, Loading, Note, Page, Row, T } from "../components/kit";
import { quoted } from "../format";
import { useHermit } from "../hermit-context";
import { currentLocale, t } from "../i18n";
import { s } from "../theme";

type Screen = { kind: "loading" } | { kind: "error" } | { kind: "gone" } | { kind: "note"; note: Fact; deleting?: boolean; deleteFailed?: boolean };

export default function Memory() {
  const router = useRouter();
  const { status } = useHermit();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const noteId = Number(id);
  const [screen, setScreen] = useState<Screen>({ kind: "loading" });

  const load = useCallback(async () => {
    if (status.kind !== "ready") return;
    if (!Number.isInteger(noteId)) return setScreen({ kind: "gone" });
    try {
      const note = await status.hermit.memories.get(noteId);
      setScreen(note ? { kind: "note", note } : { kind: "gone" });
    } catch {
      setScreen({ kind: "error" });
    }
  }, [status, noteId]);

  useEffect(() => {
    if (status.kind === "failed") setScreen({ kind: "error" });
    else void load();
  }, [load, status]);

  const remove = useCallback(async (note: Fact) => {
    if (status.kind !== "ready") return;
    setScreen({ kind: "note", note, deleting: true });
    try {
      // The delete is logged in the chat Hermit is on now (after a new chat or a reset, not the one the app started with).
      await status.hermit.memories.delete(await status.sessions.open(HERMIT_BOT_ID), note.id);
      router.back();
    } catch {
      setScreen({ kind: "note", note, deleteFailed: true });
    }
  }, [status, router]);

  const confirm = (note: Fact) =>
    Alert.alert(t("HM-MEM-02.deleteTitle"), t("HM-MEM-02.deleteBody"), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("HM-MEM-02.delete"), style: "destructive", onPress: () => void remove(note) },
    ]);

  if (screen.kind === "loading") {
    return (
      <Page title={t("HM-MEM-02.title")}>
        <Loading text={t("HM-MEM-01.loading")} />
      </Page>
    );
  }

  if (screen.kind === "error") {
    return (
      <Page title={t("HM-MEM-02.title")}>
        <Failed text={t("HM-MEM-01.error")} onRetry={() => { setScreen({ kind: "loading" }); void load(); }} />
      </Page>
    );
  }

  if (screen.kind === "gone") {
    return (
      <Page title={t("HM-MEM-02.title")}>
        <Empty pose="idle" body={t("HM-MEM-02.gone")}>
          <Btn label={t("HM-MEM-02.back")} kind="secondary" icon="arrow-left" full onPress={() => router.back()} />
        </Empty>
      </Page>
    );
  }

  const { note, deleting, deleteFailed } = screen;
  const date = new Intl.DateTimeFormat(currentLocale(), { dateStyle: "long", timeStyle: "short" }).format(new Date(note.createdAt));
  return (
    <Page title={t("HM-MEM-02.title")}>
      <View style={{ gap: s.lg }}>
        <View style={{ gap: s.sm }}>
          <T v="title" selectable>{note.tainted ? quoted(note.fact) : note.fact}</T>
          <T v="small" color="soft">{t("HM-MEM-02.savedAt", { date })}</T>
        </View>
        {/* Where it came from: amber when someone else wrote what Hermit read; the provenance as a quiet labelled line. */}
        <Card tone={note.tainted ? "amber" : undefined}>
          <View style={{ gap: s.xs }}>
            <Note icon={note.tainted ? "message-square" : "user"} tone={note.tainted ? "amber" : "textSoft"} textColor={note.tainted ? "amber" : "soft"} v="footnoteStrong" text={t(note.tainted ? "HM-MEM-01.fromMessage" : "HM-MEM-01.fromYou")} />
            <T v="body">{t(note.tainted ? "HM-MEM-02.fromMessageBody" : "HM-MEM-02.fromYouBody")}</T>
          </View>
        </Card>
        {deleteFailed ? <View accessibilityRole="alert"><Note icon="circle-alert" tone="coral" text={t("HM-MEM-02.deleteFailed")} textColor="text" /></View> : null}
        {/* Delete as a coral row at the end, like every detail screen's destructive action. */}
        <Group style={{ marginTop: s.sm }}>
          <Row icon="trash-2" iconColor="coral" title={<T v="bodyStrong" color="coral">{t("HM-MEM-02.delete")}</T>} a11y={t("HM-MEM-02.delete")} disabled={deleting} onPress={() => confirm(note)} />
        </Group>
      </View>
    </Page>
  );
}
