// HM-MSG-01: captured conversations by app (US-MSG-01, US-MSG-05). Message text is written by other people,
// so it is shown quoted and marked untrusted; nothing here can act on it. States from the W1 states spec:
// ST-LOAD, ST-FORBIDDEN (no notification access), ST-EMPTY-FIRST, ST-IDEAL, ST-STALE (can't reply anymore).
// Polish round: one grouped list, a row per conversation with the sender's initial, the time relative to now, the
// latest message quoted, and the app (with "can't reply anymore" in the same quiet line, not a chip); the one-time
// code note keeps its shield; ST-FORBIDDEN and ST-EMPTY-FIRST are the staged crab and a line.
import { useCallback, useEffect, useState } from "react";
import { AppState, View } from "react-native";
import type { MessagingApp, StoredMessage } from "@hermit/core";
import { notificationAccessEnabled, openNotificationAccessSettings } from "../adapters";
import { Avatar, Btn, Empty, Loading, Note, Page, T, TitleLine } from "../components/kit";
import { useHermit } from "../hermit-context";
import { quoted, when } from "../format";
import { currentLocale, t } from "../i18n";
import { s } from "../theme";

interface Row {
  id: string; title: string; app: MessagingApp; lastAt: number; canReply: boolean;
  sender?: string; text?: string; hidden?: StoredMessage["hidden"];
}

// US-MSG-06: each conversation says which app it came from (WhatsApp or WhatsApp Business).
const appName = (app: MessagingApp) => t(`HM-MSG-01.app.${app}`);

export default function Messages() {
  const { status } = useHermit();
  const [rows, setRows] = useState<Row[]>();
  const [access, setAccess] = useState(true);

  const load = useCallback(async () => {
    setAccess(notificationAccessEnabled());
    if (status.kind !== "ready") return;
    const [convs, recent] = await Promise.all([status.hermit.messages.conversations(), status.hermit.messages.recent({ limit: 200 })]);
    const latest = new Map<string, StoredMessage>();
    for (const m of recent) if ((latest.get(m.conversationId)?.at ?? -1) < m.at) latest.set(m.conversationId, m);
    setRows(convs.sort((a, b) => b.lastAt - a.lastAt).map((c) => {
      const m = latest.get(c.id);
      return { ...c, sender: m?.sender, text: m?.text, hidden: m?.hidden };
    }));
  }, [status]);

  useEffect(() => {
    void load();
    // Back from the settings page: re-check access and reload.
    const sub = AppState.addEventListener("change", (s) => s === "active" && void load());
    return () => sub.remove();
  }, [load]);

  if (!access) {
    return (
      <Page title={t("HM-MSG-01.title")}>
        <Empty pose="asking" title={t("HM-MSG-01.forbiddenTitle")} body={t("HM-MSG-01.forbiddenBody")}>
          <Btn label={t("HM-MSG-01.grant")} icon="settings" full onPress={openNotificationAccessSettings} />
        </Empty>
      </Page>
    );
  }

  if (!rows) {
    return (
      <Page title={t("HM-MSG-01.title")}>
        <Loading text={t("HM-MSG-01.loading")} />
      </Page>
    );
  }

  const now = Date.now();
  return (
    <Page
      title={t("HM-MSG-01.title")}
      list={{
        data: rows,
        keyOf: (item) => item.id,
        lead: "avatar",
        row: (item) => {
          const at = when(item.lastAt, now, currentLocale());
          const time = t(at.key, at.vars);
          return (
            <View style={{ flexDirection: "row", gap: s.md, paddingVertical: s.md, paddingHorizontal: s.lg }} accessible accessibilityLabel={`${item.title}, ${appName(item.app)}, ${time}`}>
              <Avatar name={item.title} tone="plain" />
              <View style={{ flex: 1, gap: 2 }}>
                <TitleLine title={item.title} lines={1} aside={time} />
                {item.hidden ? (
                  // US-MSG-07: the code itself was never stored; say so instead of showing an empty quote.
                  <Note icon="shield-check" text={t("HM-MSG-01.hiddenCode")} />
                ) : item.text ? (
                  <T v="small" color="soft" lines={2}>{item.sender && item.sender !== item.title ? `${item.sender}: ` : ""}{quoted(item.text)}</T>
                ) : null}
                <T v="footnote" color="soft">{item.canReply ? appName(item.app) : `${appName(item.app)} · ${t("HM-MSG-01.stale")}`}</T>
              </View>
            </View>
          );
        },
        // Someone else's words: never followed as instructions (US-MSG-03). One quiet line, then the list.
        top: rows.length ? <View style={{ paddingHorizontal: s.lg, marginBottom: s.lg }}><Note icon="shield-alert" tone="amber" text={t("HM-MSG-01.untrusted")} /></View> : undefined,
        empty: <Empty pose="idle" title={t("HM-MSG-01.emptyTitle")} body={t("HM-MSG-01.emptyBody")} />,
      }}
    />
  );
}
