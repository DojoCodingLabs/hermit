// HM-NIGHT-02: the morning briefing (US-NIGHT-02, US-NIGHT-03, US-MAIL-07). Today's agenda, reminders, messages
// and email; suggestions that open the normal approval sheet (nothing proposed overnight runs without it); and
// what ran, paused or was skipped overnight, with the reason. Every row and copy key comes from briefingView
// (@hermit/night). Other people's text is shown in quotes (ST-TAINTED). States: ST-LOAD, ST-ERROR with retry,
// ST-EMPTY-FIRST (no briefing yet: set up the night shift), ST-IDEAL, a stop banner, reviewing, outcome notes.
// Design pass: the date under the title; each section a card with its icon per line, other people's words quoted;
// a suggestion waiting for you is an amber card whose Review opens the approval sheet; the night's log as a grouped
// list with the status in words, cage refusals in coral, and the link to Activity.
import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { briefingView, type Briefing, type BriefingItem, type NightJobId } from "@hermit/night";
import { ApprovalSheet } from "../components/ApprovalSheet";
import { Icon, type IconName } from "../components/Icon";
import { Badge, Btn, Card, Empty, Failed, Group, Label, Loading, Note as NoteLine, Notice, Page, Row, Status, T } from "../components/kit";
import { quoted } from "../format";
import { useHermit } from "../hermit-context";
import { t, useLocale } from "../i18n";
import { skillName } from "../skill-names";
import { s } from "../theme";
import { usePalette } from "../use-palette";

type Load = { kind: "loading" } | { kind: "error" } | { kind: "ready"; briefing: Briefing | undefined };

export default function BriefingScreen() {
  const p = usePalette();
  const locale = useLocale();
  const { status } = useHermit();
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [busy, setBusy] = useState<string>();
  const [note, setNote] = useState<{ key: string; error: boolean }>();

  const refresh = useCallback(async () => {
    if (status.kind !== "ready") return;
    try {
      setLoad({ kind: "ready", briefing: await status.hermit.night.briefing() });
    } catch {
      setLoad({ kind: "error" });
    }
  }, [status]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (load.kind === "loading") {
    return (
      <Page title={t("HM-NIGHT-02.title")}>
        <Loading text={t("HM-NIGHT-02.loading")} />
      </Page>
    );
  }
  if (load.kind === "error") {
    return (
      <Page title={t("HM-NIGHT-02.title")}>
        <Failed text={t("HM-NIGHT-02.loadError")} onRetry={() => void refresh()} />
      </Page>
    );
  }

  const v = briefingView(load.briefing);
  if (v.state === "empty") {
    return (
      <Page title={t("HM-NIGHT-02.title")}>
        <Empty pose="idle" body={t(v.emptyKey!)}>
          <Btn label={t("HM-NIGHT-02.emptyAction")} icon="moon" full onPress={() => router.push("/night")} />
        </Empty>
      </Page>
    );
  }

  const review = async (suggestionId: string) => {
    if (status.kind !== "ready" || !load.briefing) return;
    setBusy(suggestionId);
    setNote(undefined);
    try {
      const out = await status.hermit.night.act(load.briefing.id, suggestionId);
      setNote({ key: `HM-NIGHT-02.outcome.${out}`, error: out !== "done" && out !== "gone" });
    } catch {
      setNote({ key: "HM-NIGHT-02.outcome.failed", error: true });
    } finally {
      setBusy(undefined);
      await refresh();
    }
  };

  const time = new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" });
  const date = new Intl.DateTimeFormat(locale, { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
  const line = (item: BriefingItem, untrusted: boolean) => {
    const when = item.at !== undefined && Number.isFinite(item.at) ? time.format(new Date(item.at)) : item.when;
    const text = untrusted ? quoted(item.text) : item.text;
    return [when, item.who, text].filter(Boolean).join(" · ");
  };

  return (
    <View style={{ flex: 1 }}>
      <Page title={t("HM-NIGHT-02.title")} subtitle={<T v="small" color="soft">{t("HM-NIGHT-02.date", { date: date.format(new Date(`${v.date}T12:00:00Z`)) })}</T>}>
        <View style={{ gap: s.md }}>
          {v.stoppedKey ? (
            <Card tone="amber">
              <View accessibilityRole="alert"><NoteLine icon="circle-pause" tone="amber" text={t(v.stoppedKey)} textColor="text" /></View>
            </Card>
          ) : null}
          {v.sections.some((x) => x.untrusted) ? <NoteLine icon="shield-alert" tone="amber" text={t(v.untrustedKey)} /> : null}
        </View>

        {v.sections.map((x) => (
          <View key={x.job}>
            <Label>{t(x.titleKey)}</Label>
            <Card>
              <View style={{ gap: s.sm }}>
                {x.summary ? <T v="body">{x.untrusted ? quoted(x.summary) : x.summary}</T> : null}
                {x.emptyKey ? <T v="body" color="soft">{t(x.emptyKey)}</T> : null}
                {x.items.map((item, i) => (
                  <View key={i} style={{ flexDirection: "row", gap: s.sm, alignItems: "flex-start" }}>
                    <View style={{ paddingTop: 2 }}><Icon name={JOB_ICON[x.job as NightJobId] ?? "list"} size={20} color={p.mark} /></View>
                    <T v="small" color="soft" lines={2} style={{ flex: 1 }}>{line(item, x.untrusted)}</T>
                  </View>
                ))}
              </View>
            </Card>
          </View>
        ))}

        {v.suggestions.length ? (
          <>
            <Label>{t("HM-NIGHT-02.suggestions")}</Label>
            <View style={{ gap: s.sm }}>
              {v.suggestions.map((x) => (
                // A suggestion waiting for you is amber ("needs you"); the approval sheet opens on Review.
                <Card key={x.id} {...(x.actionKey ? { tone: "amber" as const } : {})}>
                  <View style={{ gap: s.sm }}>
                    <T v="bodyStrong">{t(x.titleKey, x.vars)}</T>
                    {x.taintKey ? <Badge label={t(x.taintKey)} tone="amber" /> : null}
                    {x.statusKey ? <T v="small" color="soft">{t(x.statusKey)}</T> : null}
                    {x.actionKey ? <Btn label={t(x.actionKey)} kind="amber" icon="fingerprint" small busy={busy === x.id} disabled={busy !== undefined} onPress={() => void review(x.id)} /> : null}
                  </View>
                </Card>
              ))}
            </View>
          </>
        ) : null}
        {note ? <View style={{ marginTop: s.md }}><Notice tone={note.error ? "bad" : "ok"} text={t(note.key)} /></View> : null}

        <Label>{t("HM-NIGHT-02.log")}</Label>
        <Group>
          {v.log.map((l) => (
            <Row
              key={l.job}
              icon={JOB_ICON[l.job as NightJobId] ?? "list"}
              title={t(l.jobKey)}
              trailing={<Status text={`${t(l.statusKey)}${l.reasonKey ? ` (${t(l.reasonKey)})` : ""}`} icon={l.statusKey.endsWith(".ran") ? "circle-check" : "circle-pause"} />}
            />
          ))}
        </Group>
        {v.refusals.length ? (
          // Blocked overnight by the cage: coral marks on the page color.
          <View style={{ gap: s.sm, marginTop: s.md }}>
            {v.refusals.map((r, i) => <NoteLine key={`r${i}`} icon="ban" tone="coral" textColor="text" text={t(r.key, { skill: t(skillName(r.skill)) })} />)}
          </View>
        ) : null}
        <Group style={{ marginTop: s.lg }}>
          <Row icon="shield-check" title={t("HM-NIGHT-02.activityLink")} chevron role="link" onPress={() => router.push("/activity")} />
        </Group>
      </Page>
      <ApprovalSheet />
    </View>
  );
}

const JOB_ICON: Record<NightJobId, IconName> = { agenda: "calendar", reminders: "bell", messages: "message-circle", mail: "mail" };
