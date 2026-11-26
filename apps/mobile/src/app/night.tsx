// HM-NIGHT-01: night shift settings (US-NIGHT-01, US-NIGHT-04, US-CAGE-02). The window, the jobs, the morning
// notice time, the guards it waits for, and the promise that nothing can act while you sleep. Every rule and
// copy key comes from nightSettingsView (@hermit/night). States: ST-LOAD, ST-ERROR with retry, ST-IDEAL,
// invalid choice (Save disabled, the problem named), saving, saved, save failed (nothing changed). Q69: the
// background line from nightBackgroundView says whether Android can wake the night shift with Hermit closed,
// and offers (never requires) the battery optimization settings when Android limits it.
// Design pass: the switch, the promise in a sea-glass card, the window as three time fields, the jobs as a grouped list
// with icons and switches, the guards as checks, what holds it back now in amber, the background line with its icon,
// and Save pinned at the foot.
import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { AppState, View } from "react-native";
import { nightBackgroundView, nightSettingsView, type BackgroundState, type BackgroundStatus, type DeviceState, type NightJobId, type NightSettings } from "@hermit/night";
import { backgroundStatus, nightConditions, openBatterySettings, syncNightSchedule, wakeNightShift } from "../adapters";
import type { IconName } from "../components/Icon";
import { Btn, Card, Failed, Footer, Group, Input, Label, Loading, Note as NoteLine, Notice, Page, Row, T, Toggle } from "../components/kit";
import { useHermit } from "../hermit-context";
import { t } from "../i18n";
import { s } from "../theme";

type Load = { kind: "loading" } | { kind: "error" } | { kind: "ready" };
type Note = { key: string; error: boolean };

export default function NightScreen() {
  const { status } = useHermit();
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [draft, setDraft] = useState<NightSettings>();
  /** What is saved: the background line describes the schedule, not an unsaved toggle. */
  const [savedEnabled, setSavedEnabled] = useState(false);
  const [bg, setBg] = useState<BackgroundStatus>();
  const [device, setDevice] = useState<DeviceState>();
  const [busy, setBusy] = useState<"saving" | "running">();
  const [note, setNote] = useState<Note>();

  const refresh = useCallback(async () => {
    if (status.kind !== "ready") return;
    try {
      const saved = await status.hermit.night.settings();
      setDraft(saved);
      setSavedEnabled(saved.enabled);
      setLoad({ kind: "ready" });
    } catch {
      setLoad({ kind: "error" });
    }
    setDevice(await nightConditions().catch(() => undefined));
    setBg(backgroundStatus());
  }, [status]);

  useEffect(() => {
    void refresh();
    // The charger or the heat may have changed while the app was away.
    // Coming back from the battery settings: the background line reads the new state.
    const sub = AppState.addEventListener("change", (s) => {
      if (s !== "active") return;
      void nightConditions().then(setDevice, () => {});
      setBg(backgroundStatus());
    });
    return () => sub.remove();
  }, [refresh]);

  if (load.kind === "error") {
    return (
      <Page title={t("HM-NIGHT-01.title")}>
        <Failed text={t("HM-NIGHT-01.loadError")} onRetry={() => void refresh()} />
      </Page>
    );
  }
  if (load.kind === "loading" || !draft) {
    return (
      <Page title={t("HM-NIGHT-01.title")}>
        <Loading text={t("HM-NIGHT-01.loading")} />
      </Page>
    );
  }

  const view = nightSettingsView(draft, device);
  const background = nightBackgroundView(savedEnabled, bg);
  const edit = (next: Partial<NightSettings>) => {
    setNote(undefined);
    setDraft({ ...draft, ...next });
  };
  const toggleJob = (id: NightJobId, on: boolean) => edit({ jobs: on ? [...draft.jobs, id] : draft.jobs.filter((j) => j !== id) });
  const canSave = status.kind === "ready" && !busy && view.problemKeys.length === 0;

  const save = async () => {
    if (status.kind !== "ready") return;
    setBusy("saving");
    setNote(undefined);
    try {
      const problems = await status.hermit.night.saveSettings(draft);
      setNote(problems.length ? { key: `HM-NIGHT-01.problem.${problems[0]}`, error: true } : { key: "HM-NIGHT-01.saved", error: false });
      if (!problems.length) {
        setSavedEnabled(draft.enabled);
        // Q69: schedule, move or cancel the background wake to match. A failure here keeps the in-app fallback.
        await syncNightSchedule(status.hermit).catch(() => {});
        setBg(backgroundStatus());
      }
    } catch {
      setNote({ key: "HM-NIGHT-01.saveError", error: true });
    } finally {
      setBusy(undefined);
    }
  };

  // Debug only: one wake now, with every guard but the screen (the user is looking at it).
  const runNow = async () => {
    if (status.kind !== "ready") return;
    setBusy("running");
    setNote(undefined);
    try {
      await wakeNightShift(status.hermit, { manual: true });
      setNote({ key: "HM-NIGHT-01.ran", error: false });
    } catch {
      setNote({ key: "HM-NIGHT-01.runError", error: true });
    } finally {
      setBusy(undefined);
    }
  };

  const time = (label: string, value: string, set: (v: string) => void) => (
    <Input
      label={label}
      value={value}
      onChange={set}
      big
      style={{ flex: 1, minWidth: 96 }}
      field={{ accessibilityHint: t("HM-NIGHT-01.timeHint"), keyboardType: "numbers-and-punctuation", maxLength: 5 }}
    />
  );

  return (
    <Page
      title={t("HM-NIGHT-01.title")}
      footer={
        <Footer>
          <Btn label={t(busy === "saving" ? "HM-NIGHT-01.saving" : "HM-NIGHT-01.save")} busy={busy === "saving"} disabled={!canSave} style={{ flexGrow: 1 }} onPress={() => void save()} />
        </Footer>
      }
    >
      <T v="body" color="soft">{t("HM-NIGHT-01.intro")}</T>
      <Group style={{ marginTop: s.lg }}>
        <Row icon="moon" title={t("HM-NIGHT-01.enabled")} trailing={<Toggle on={draft.enabled} label={t("HM-NIGHT-01.enabled")} disabled={!!busy} onChange={(on) => edit({ enabled: on })} />} />
      </Group>
      {/* The promise that nothing acts while you sleep, in Hermit's color. */}
      <Card tone="hermit" style={{ marginTop: s.md }}>
        <NoteLine icon="shield-check" text={t(view.unattendedKey)} textColor="text" />
      </Card>

      <Label>{t("HM-NIGHT-01.window")}</Label>
      {/* Fields line up on their bottom edge even when a label wraps. */}
      <View style={{ flexDirection: "row", gap: s.md, flexWrap: "wrap", alignItems: "flex-end" }}>
        {time(t("HM-NIGHT-01.windowStart"), draft.window.start, (start) => edit({ window: { ...draft.window, start } }))}
        {time(t("HM-NIGHT-01.windowEnd"), draft.window.end, (end) => edit({ window: { ...draft.window, end } }))}
        {time(t("HM-NIGHT-01.briefingAt"), draft.briefingAt, (briefingAt) => edit({ briefingAt }))}
      </View>

      <Label>{t("HM-NIGHT-01.jobs")}</Label>
      <Group>
        {view.jobs.map((j) => (
          <Row
            key={j.id}
            icon={JOB_ICON[j.id]}
            title={t(j.labelKey)}
            {...(j.noteKey ? { sub: t(j.noteKey) } : {})}
            trailing={<Toggle on={j.on} label={t(j.labelKey)} disabled={!!busy} onChange={(on) => toggleJob(j.id, on)} />}
          />
        ))}
      </Group>

      <Label>{t("HM-NIGHT-01.conditions")}</Label>
      <View style={{ gap: s.sm }}>
        {view.conditionKeys.map((k) => <NoteLine key={k} icon="check" text={t(k)} />)}
      </View>
      {view.nowKeys.length ? (
        // What holds it back right now: amber, "needs you", on the page color.
        <Card tone="amber" style={{ marginTop: s.md }}>
          <View accessibilityLiveRegion="polite" style={{ gap: s.xs }}>
            <T v="smallStrong">{t("HM-NIGHT-01.now")}</T>
            {view.nowKeys.map((k) => <NoteLine key={k} icon="circle-pause" tone="amber" text={t(k)} textColor="text" />)}
          </View>
        </Card>
      ) : null}

      <Label>{t("HM-NIGHT-01.background.title")}</Label>
      <View accessibilityLiveRegion="polite" style={{ gap: s.sm }}>
        <NoteLine icon={BG_ICON[background.state]} tone={background.state === "blocked" ? "coral" : background.state === "limited" ? "amber" : "mark"} text={t(background.lineKey)} textColor="text" v="body" />
        {background.noteKey ? <T v="small" color="soft">{t(background.noteKey)}</T> : null}
        {background.batteryActionKey ? (
          <>
            <Btn label={t(background.batteryActionKey)} kind="secondary" icon="settings" small onPress={() => openBatterySettings()} />
            {background.optionalKey ? <T v="small" color="soft">{t(background.optionalKey)}</T> : null}
          </>
        ) : null}
      </View>

      <View style={{ marginTop: s.lg, gap: s.xs }}>
        {view.problemKeys.map((k) => (
          <View key={k} accessibilityRole="alert"><NoteLine icon="circle-alert" tone="coral" text={t(k)} textColor="text" /></View>
        ))}
        {note ? <Notice tone={note.error ? "bad" : "ok"} text={t(note.key)} /> : null}
      </View>

      <Group style={{ marginTop: s.lg }}>
        <Row icon="sun" title={t("HM-NIGHT-01.openBriefing")} chevron role="link" onPress={() => router.push("/briefing")} />
      </Group>
      {__DEV__ ? (
        <Btn label={t(busy === "running" ? "HM-NIGHT-01.running" : "HM-NIGHT-01.runNow")} kind="text" icon="play" disabled={!!busy} style={{ marginTop: s.sm }} onPress={() => void runNow()} />
      ) : null}
    </Page>
  );
}

const JOB_ICON: Record<NightJobId, IconName> = { agenda: "calendar", reminders: "bell", messages: "message-circle", mail: "mail" };
const BG_ICON: Record<BackgroundState, IconName> = {
  off: "moon", unsupported: "ban", pending: "loader-circle", active: "circle-check", limited: "triangle-alert", blocked: "circle-alert",
};
