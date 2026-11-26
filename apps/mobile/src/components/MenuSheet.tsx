// HM-CHAT-01's menu: the one button in the chat's bar opens this sheet with every other screen, in three groups (what
// Hermit keeps for you, what it did, how it works), and clearing the conversation at the end, when there is one.
import { router, type Href } from "expo-router";
import { View } from "react-native";
import { t } from "../i18n";
import { s } from "../theme";
import { Group, Row, T } from "./kit";
import { type IconName } from "./Icon";
import { SheetModal } from "./Sheet";

/** In reading order, by group. A new screen adds one line here. */
export const MENU: ReadonlyArray<ReadonlyArray<{ href: Href; labelKey: string; icon: IconName }>> = [
  [
    { href: "/memories", labelKey: "HM-MEM-01.title", icon: "bookmark" },
    { href: "/messages", labelKey: "HM-MSG-01.title", icon: "message-circle" },
    { href: "/reminders", labelKey: "HM-REM-01.title", icon: "bell" },
    { href: "/vault", labelKey: "HM-VAULT-01.title", icon: "key-round" },
    { href: "/wallet", labelKey: "HM-PAY-01.title", icon: "wallet" },
    { href: "/profile", labelKey: "HM-FORM-02.title", icon: "user" },
  ],
  [
    { href: "/briefing", labelKey: "HM-NIGHT-02.title", icon: "sun" },
    { href: "/activity", labelKey: "HM-ACT-01.title", icon: "shield-check" },
    { href: "/night", labelKey: "HM-NIGHT-01.title", icon: "moon" },
  ],
  [
    { href: "/where", labelKey: "HM-CHAT-02.title", icon: "smartphone" },
    { href: "/settings", labelKey: "HM-SET-01.title", icon: "settings" },
    { href: "/appearance", labelKey: "HM-SET-06.title", icon: "palette" },
    { href: "/privacy", labelKey: "HM-SET-02.title", icon: "shield" },
    { href: "/about", labelKey: "HM-SET-08.title", icon: "info" },
  ],
];

export function MenuSheet({ open, onClose, onClear }: { open: boolean; onClose(): void; onClear?: () => void }) {
  const go = (href: Href) => {
    onClose();
    router.push(href);
  };
  return (
    <SheetModal visible={open} onClose={onClose} dismissable closeLabel={t("HM-CHAT-01.menuClose")}>
      <T v="title" role="header" style={{ marginBottom: s.lg }}>{t("HM-CHAT-01.menu")}</T>
      <View style={{ gap: s.lg }}>
        {MENU.map((group, i) => (
          <Group key={i}>
            {group.map((item) => (
              <Row key={item.labelKey} icon={item.icon} title={t(item.labelKey)} role="link" chevron onPress={() => go(item.href)} />
            ))}
          </Group>
        ))}
        {onClear ? (
          <Group>
            <Row
              icon="trash-2"
              iconColor="coral"
              title={t("HM-CHAT-01.clearA11y")}
              titleColor="coral"
              onPress={() => {
                onClose();
                onClear();
              }}
            />
          </Group>
        ) : null}
      </View>
    </SheetModal>
  );
}
