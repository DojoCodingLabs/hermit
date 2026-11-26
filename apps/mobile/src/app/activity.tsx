// HM-ACT-01 (activity and chain state) with HM-ACT-03 (chain broken) as its error state.
// SL-32: rows open HM-ACT-02; "Clear log" asks for confirmation and a fingerprint, and the clear is logged.
// Polish round: the chain's state leads as one quiet card (sea glass verified; coral and read first when broken),
// then the entries as one grouped list built row by row (a log grows for months): the skill in words with the time
// beside it, relative to now. An outcome is said only when it isn't the ordinary one ("Done" on every row told
// nothing), in words and in color together: coral for blocked or failed, amber for outside content. The hashes live
// in each entry (HM-ACT-02). Clear moved to the bar, as a trash button; it stays hidden while the chain is broken.
// Multi-bot: the second line names the bot that ran a step or that the user changed (its name now, "bot borrado" once
// it is gone), what a change to a bot or a mode was, and the mode that let a step run without asking (../activity-view).
import { useCallback, useEffect, useState } from "react";
import { Alert, View } from "react-native";
import { useRouter } from "expo-router";
import type { ChainView } from "@hermit/cage";
import type { ActivityRowView } from "@hermit/runtime";
import { activityLine } from "../activity-view";
import { confirmWithFingerprint } from "../adapters/fingerprint";
import type { IconName } from "../components/Icon";
import { Empty, Group, IconBtn, Notice, Page, Row, T, TitleLine } from "../components/kit";
import { when } from "../format";
import { useHermit } from "../hermit-context";
import { currentLocale, t, tCount } from "../i18n";
import { markKey, skillName } from "../skill-names";
import { s } from "../theme";

type ClearNote = "done" | "not_confirmed" | "unavailable" | "broken" | "failed";

const SKILL_ICON: Record<string, IconName> = {
  pay: "wallet", pay_merchant: "wallet", search_web: "search", read_web: "book-open", reply_message: "send", remind: "bell",
  reminder_cancel: "bell", reminders_list: "bell", set_alarm: "bell", calendar_add: "calendar", calendar_read: "calendar",
  remember: "bookmark", recall: "bookmark", forget: "bookmark", read_messages: "message-circle", open_whatsapp_chat: "message-circle",
  fill_login: "key-round", vault: "key-round", fill_form: "user", profile: "user", add_contact: "contact", wallet: "wallet",
  spending: "wallet", connector: "plug", connect_service: "plug", bot: "sliders-horizontal", create_bot: "plus",
};

/** A row's icon: its skill's, else its family's (web tasks, mail, the night shift, MCP tools, connectors). */
const iconFor = (skill: string): IconName =>
  SKILL_ICON[skill] ??
  (skill.startsWith("web_") ? "globe" : skill.startsWith("mail_") || skill.startsWith("compose_") ? "mail" : skill.startsWith("night") ? "moon" : skill.startsWith("mcp_") ? "server" : skill.startsWith("conn_") ? "plug" : "circle-dot");

export default function Activity() {
  const router = useRouter();
  const { status } = useHermit();
  const [data, setData] = useState<{ rows: ActivityRowView[]; chain: ChainView }>({ rows: [], chain: { kind: "empty" } });
  const [clearing, setClearing] = useState(false);
  const [note, setNote] = useState<ClearNote>();

  const load = useCallback(async () => {
    if (status.kind === "ready") setData(await status.hermit.activity());
  }, [status]);
  useEffect(() => {
    void load();
  }, [load]);

  const clear = async () => {
    if (status.kind !== "ready") return;
    setClearing(true);
    try {
      const check = await confirmWithFingerprint(t("HM-ACT-01.clearPrompt"), t("HM-ACT-01.clearCancel"));
      if (check !== "confirmed") return setNote(check);
      const out = await status.hermit.clearActivity();
      setNote(out.kind === "cleared" ? "done" : "broken");
      await load();
    } catch {
      setNote("failed");
    } finally {
      setClearing(false);
    }
  };

  const askToClear = () =>
    Alert.alert(t("HM-ACT-01.clearTitle"), t("HM-ACT-01.clearBody"), [
      { text: t("HM-ACT-01.clearCancel"), style: "cancel" },
      { text: t("HM-ACT-01.clearConfirm"), style: "destructive", onPress: () => void clear() },
    ]);

  const canClear = data.chain.kind === "verified";
  const broken = data.chain.kind === "broken" ? data.chain : undefined;
  const now = Date.now();
  const locale = currentLocale();

  // The chain's state: one card. Broken is an alert and reads first; verified is a quiet line with the count.
  const chain = data.chain.kind === "empty" ? null : (
    <View style={{ gap: s.sm }} accessibilityRole={broken ? "alert" : "summary"}>
      <Group>
        <Row
          icon={broken ? "shield-alert" : "shield-check"}
          iconColor={broken ? "coral" : "accent"}
          top={!!broken}
          title={<T v="bodyStrong" color={broken ? "coral" : "text"}>{broken ? t("HM-ACT-03.title", { index: broken.atSeq }) : t("HM-ACT-01.chainOk")}</T>}
          sub={broken ? t("HM-ACT-03.body", { reason: broken.reason }) : tCount("HM-ACT-01.entries", data.rows.length)}
        />
      </Group>
      <T v="footnote" color="soft" style={{ paddingHorizontal: s.lg }}>{broken ? t("HM-ACT-01.clearBroken") : t("HM-ACT-01.tamperEvident")}</T>
    </View>
  );

  return (
    <Page
      title={t("HM-ACT-01.title")}
      action={canClear ? <IconBtn icon="trash-2" label={t(clearing ? "HM-ACT-01.clearing" : "HM-ACT-01.clear")} disabled={clearing} onPress={askToClear} /> : undefined}
      list={{
        data: data.rows,
        keyOf: (r) => String(r.seq),
        lead: "tile",
        row: (item) => {
          // In words: never the skill id or the mark's code (skill-names.ts); HM-ACT-02 keeps the raw metadata.
          const cleared = item.mark === "cleared";
          const title = t(cleared ? markKey("cleared") : skillName(item.skill));
          const mark = t(markKey(item.mark));
          const at = when(item.at, now, locale);
          const time = t(at.key, at.vars);
          // Which bot (its name is data, never copy), what changed or which mode ran it, and an outcome that isn't "Done".
          const line = activityLine(item);
          const who = line.who ? ("name" in line.who ? line.who.name : t(line.who.key)) : undefined;
          const what = line.what ? t(line.what) : undefined;
          const outcome = line.outcome ? line.tone : undefined;
          // The second line only when it says something: how many a clear removed, or any of the above.
          const said = [who, what, line.outcome ? mark : undefined].filter((x): x is string => !!x);
          const detail = cleared ? tCount("HM-ACT-01.clearedCount", item.clearedCount ?? 0) : said.length ? said.join(" · ") : undefined;
          const strong = outcome === "coral" || outcome === "amber";
          return (
            <Row
              icon={cleared ? "trash-2" : iconFor(item.skill)}
              iconColor={strong ? outcome : "soft"}
              title={<TitleLine title={title} aside={time} />}
              sub={detail ? <T v={strong ? "smallStrong" : "small"} color={outcome ?? "soft"}>{detail}</T> : undefined}
              chevron
              a11y={[title, ...(cleared ? [detail] : [who, what, mark]), time].filter(Boolean).join(", ")}
              hint={t("HM-ACT-01.openHint")}
              onPress={() => router.push({ pathname: "/activity-entry", params: { seq: String(item.seq) } })}
            />
          );
        },
        top: (
          <View style={{ gap: s.md, marginBottom: data.rows.length ? s.xl : 0 }}>
            {chain}
            {note ? <Notice tone={note === "done" ? "ok" : "bad"} text={t(`HM-ACT-01.clearNote.${note}`)} /> : null}
          </View>
        ),
        empty: <Empty pose="idle" body={t("HM-ACT-01.empty")} />,
      }}
    />
  );
}
