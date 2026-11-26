// HM-ACT-02 (US-ACT-03, SL-32): every entry behind one activity row, its metadata and hashes in monospace.
// Polish round: the app's page (large title, back in the bar), the "metadata and hashes only" line, then one grouped
// list per entry under its number: each field's name in words over its raw value (mono, selectable, wrapping, never
// cut). The time reads as a date and time; the raw epoch that followed it is gone (the hash already covers it). Hashes
// and the signature read in groups of eight with a copy button that copies the value itself.
// Multi-bot: the reason shows on a bot change and on a step a permission mode let run ("mode.auto", so an approval entry
// never reads as the user's), and the bot's id on every entry a bot wrote or a change was about.
import { useEffect, useState } from "react";
import { AccessibilityInfo, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import type { ActivityDetail } from "@hermit/cage";
import { copyLogValue } from "../adapters/wallet";
import { Empty, Group, IconBtn, Label, Loading, Note, Page, T } from "../components/kit";
import { groupHex } from "../format";
import { useHermit } from "../hermit-context";
import { currentLocale, t } from "../i18n";
import { s } from "../theme";

type Loaded = { kind: "loading" } | { kind: "missing" } | { kind: "ready"; entries: ActivityDetail[] };

/** Entries whose reason is part of what they are: it shows even when absent ("none"). Any other entry shows one it has. */
const REASON_EVENTS: ReadonlySet<ActivityDetail["event"]> = new Set(["night_job", "vault", "connector", "wallet", "bot"]);

export default function ActivityEntry() {
  const { status } = useHermit();
  const { seq } = useLocalSearchParams<{ seq?: string }>();
  const [state, setState] = useState<Loaded>({ kind: "loading" });

  useEffect(() => {
    const n = Number(seq);
    if (!Number.isInteger(n) || n < 1) return setState({ kind: "missing" });
    if (status.kind !== "ready") return;
    void status.hermit.activityEntry(n).then((entries) => setState(entries ? { kind: "ready", entries } : { kind: "missing" }));
  }, [seq, status]);

  const fmt = new Intl.DateTimeFormat(currentLocale(), { dateStyle: "medium", timeStyle: "medium" });
  return (
    <Page title={t("HM-ACT-02.title")}>
      {state.kind === "loading" ? <Loading text={t("common.loading")} /> : null}
      {state.kind === "missing" ? <Empty pose="idle" body={t("HM-ACT-02.missing")} /> : null}
      {state.kind === "ready" ? (
        <>
          <View style={{ paddingHorizontal: s.lg }}>
            <Note icon="shield-check" text={t("HM-ACT-02.hashesOnly")} />
          </View>
          {state.entries.map((e, i) => (
            <View key={e.seq}>
              <Label style={i === 0 ? { marginTop: s.xl } : undefined}>{`${t("HM-ACT-02.seq")} ${e.seq}`}</Label>
              <Group>
                <Field label={t("HM-ACT-02.event")} value={e.event} />
                <Field label={t("HM-ACT-02.skill")} value={e.skill} />
                <Field label={t("HM-ACT-02.decision")} value={e.decision} />
                <Field label={t("HM-ACT-02.outcome")} value={e.outcome} />
                <Field label={t("HM-ACT-02.time")} value={fmt.format(new Date(e.at))} words />
                {e.event === "log_cleared" ? <Field label={t("HM-ACT-02.clearedCount")} value={String(e.clearedCount ?? 0)} /> : null}
                {e.reason !== undefined || REASON_EVENTS.has(e.event) ? <Field label={t("HM-ACT-02.reason")} value={e.reason} /> : null}
                {e.bot !== undefined ? <Field label={t("HM-ACT-02.bot")} value={e.bot} /> : null}
                <Field label={t("HM-ACT-02.argsHash")} value={e.argsHash} hash />
                <Field label={t("HM-ACT-02.hash")} value={e.hash} hash />
                <Field label={t(e.event === "log_cleared" ? "HM-ACT-02.prevHashCleared" : "HM-ACT-02.prevHash")} value={e.prevHash} hash />
                <Field label={t("HM-ACT-02.signature")} value={e.sig} hash />
              </Group>
            </View>
          ))}
        </>
      ) : null}
    </Page>
  );
}

/**
 * One field: its name in words, then the raw value in mono (or `words`, like the time), whole. A hash or a signature
 * reads in groups of eight (display only, so no line ends on a stray character) with a copy button beside it that
 * copies the value itself.
 */
function Field({ label, value, words, hash }: { label: string; value: string | undefined; words?: boolean; hash?: boolean }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(id);
  }, [copied]);
  const copy = async () => {
    if (!value) return;
    await copyLogValue(value).catch(() => {});
    setCopied(true);
    AccessibilityInfo.announceForAccessibility(t("HM-ACT-02.copied"));
  };
  return (
    <View style={{ flexDirection: "row", alignItems: "center", paddingVertical: s.md, paddingLeft: s.lg, paddingRight: hash && value ? s.xs : s.lg }}>
      <View style={{ flex: 1, gap: 2 }} accessible accessibilityLabel={`${label}: ${value ?? t("HM-ACT-02.none")}`}>
        <T v="footnote" color="soft">{label}</T>
        {value === undefined ? (
          <T v="small" color="soft">{t("HM-ACT-02.none")}</T>
        ) : (
          <T v={words ? "small" : "monoSmall"} selectable={!hash}>{hash ? groupHex(value) : value}</T>
        )}
      </View>
      {hash && value ? <IconBtn icon={copied ? "check" : "copy"} label={t("HM-ACT-02.copy", { what: label })} tone="accent" onPress={() => void copy()} /> : null}
    </View>
  );
}
