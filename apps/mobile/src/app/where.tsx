// HM-CHAT-02: where Hermit runs, the model in use and the last turn's speed (US-CHAT-02).
// SL-43: and a model update's progress, with "Update now" when only metered data or the battery holds it (US-MODEL-04).
// Design pass (C2): the "On this phone" marker as the headline with the crab, then the model and the last turn's speed
// as a grouped list, the update line in words, and Update now when it is offered.
import { useEffect, useState } from "react";
import { View } from "react-native";
import { PROFILES, updateView } from "@hermit/model";
import { checkModelUpdate, modelUpdateState, onModelUpdate } from "../adapters";
import { Btn, Dot, Group, Page, Row, T } from "../components/kit";
import { Mascot } from "../components/Mascot";
import { useHermit } from "../hermit-context";
import { currentLocale, t } from "../i18n";
import { s } from "../theme";
import { usePalette } from "../use-palette";

export default function Where() {
  const p = usePalette();
  const { status } = useHermit();
  const [last, setLast] = useState<{ firstActionMs?: number; totalMs?: number }>();
  const [update, setUpdate] = useState(modelUpdateState);
  useEffect(() => {
    if (status.kind === "ready") void status.hermit.lastTurn().then(setLast);
  }, [status]);
  useEffect(() => onModelUpdate(setUpdate), []);
  const secs = (ms: number) => new Intl.NumberFormat(currentLocale(), { maximumFractionDigits: 1 }).format(ms / 1000);
  const ms = last?.firstActionMs ?? last?.totalMs;
  const line = updateView(update);
  return (
    <Page title={t("HM-CHAT-02.title")}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: s.md, marginBottom: s.lg }}>
        <Mascot state="idle" dark={p.dark} width={72} />
        <View style={{ flexDirection: "row", alignItems: "center", gap: s.sm, flexShrink: 1 }}>
          <Dot />
          <T v="title">{t("HM-CHAT-02.onPhone")}</T>
        </View>
      </View>
      <Group>
        <Row icon="smartphone" title={t("HM-CHAT-02.model", { model: PROFILES[0]!.file.id })} />
        <Row icon="history" title={ms !== undefined ? t("HM-CHAT-02.speed", { seconds: secs(ms) }) : t("HM-CHAT-02.noTurns")} titleColor={ms !== undefined ? "text" : "soft"} />
        {line ? <Row icon="download" title={<T v="body" live="polite">{t(line.key, line.vars)}</T>} /> : null}
      </Group>
      {line?.action === "update_now" ? (
        <Btn label={t("HM-CHAT-02.update.now")} icon="download" full style={{ marginTop: s.lg }} onPress={() => void checkModelUpdate(true)} />
      ) : null}
    </Page>
  );
}
