// HM-BOT-02's menu: what one bot's chat can do now (chat-menu.ts picks the lines), and the sheet of its older chats.
// The app's own menu lives on the roster; this one is about this bot only.
import { useEffect, useState } from "react";
import { View } from "react-native";
import type { ChatSummary } from "@hermit/core";
import type { ChatMenuItem } from "../chat-menu";
import { when } from "../format";
import { currentLocale, t } from "../i18n";
import { s } from "../theme";
import { type IconName } from "./Icon";
import { Group, Row, T } from "./kit";
import { SheetModal } from "./Sheet";

const LINES: Record<ChatMenuItem, { icon: IconName; labelKey: string }> = {
  newChat: { icon: "plus", labelKey: "HM-BOT-02.newChat" },
  olderChats: { icon: "history", labelKey: "HM-BOT-02.olderChats" },
  botSettings: { icon: "sliders-horizontal", labelKey: "HM-BOT-02.botSettings" },
  clear: { icon: "trash-2", labelKey: "HM-CHAT-01.clearA11y" },
};

const said = (at: number) => {
  const w = when(at, Date.now(), currentLocale());
  return t(w.key, w.vars);
};

export function ChatMenuSheet({ open, botName, items, chats, onClose, onPick, onOpenChat }: {
  open: boolean;
  botName: string;
  items: readonly ChatMenuItem[];
  /** The bot's other chats, newest first. */
  chats: readonly ChatSummary[];
  onClose(): void;
  onPick(item: Exclude<ChatMenuItem, "olderChats">): void;
  onOpenChat(sessionId: string): void;
}) {
  const [view, setView] = useState<"menu" | "chats">("menu");
  useEffect(() => {
    if (!open) setView("menu");
  }, [open]);
  const older = view === "chats";
  const [danger, calm] = [items.filter((i) => i === "clear"), items.filter((i) => i !== "clear")];
  const line = (item: ChatMenuItem) => (
    <Row
      key={item}
      icon={LINES[item].icon}
      iconColor={item === "clear" ? "coral" : undefined}
      title={t(LINES[item].labelKey)}
      titleColor={item === "clear" ? "coral" : undefined}
      chevron={item === "olderChats"}
      onPress={() => (item === "olderChats" ? setView("chats") : onPick(item))}
    />
  );
  return (
    <SheetModal visible={open} onClose={onClose} dismissable closeLabel={t("HM-CHAT-01.menuClose")}>
      <T v="title" role="header" style={{ marginBottom: s.lg }}>{older ? t("HM-BOT-02.olderTitle") : t("HM-BOT-02.menuTitle", { name: botName })}</T>
      {older ? (
        <Group>
          {chats.map((c) => (
            <Row key={c.id} title={c.title ?? said(c.startedAt)} sub={c.title ? said(c.startedAt) : undefined} onPress={() => onOpenChat(c.id)} />
          ))}
        </Group>
      ) : (
        <View style={{ gap: s.lg }}>
          <Group>{calm.map(line)}</Group>
          {danger.length ? <Group>{danger.map(line)}</Group> : null}
        </View>
      )}
    </SheetModal>
  );
}
