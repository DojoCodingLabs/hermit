// HM-BOT-02's quiet bar: back, the bot's face and name with its status in words (one button to the bot's settings),
// the mode chip when the bot acts without asking each time, and the menu. Hermit keeps the crab in the pose of the
// moment (the logo lock); every other bot wears its shell. The status crossfades when it changes and is a polite live
// region, so Quiet mode (no crab) loses nothing.
import { Pressable, View } from "react-native";
import type { Bot, PermissionMode } from "@hermit/core";
import { headerParts } from "../roster-view";
import { t } from "../i18n";
import type { Pose } from "../mascot";
import { radius, s } from "../theme";
import { usePalette } from "../use-palette";
import { BotAvatar } from "./BotAvatar";
import { Chip, IconBtn, T } from "./kit";
import { Mascot } from "./Mascot";
import { CrossFade } from "./motion";

export function BotHeader({ bot, mode, pose, status, busy, quiet, onBack, onOpen, onMenu }: {
  bot: Pick<Bot, "primary" | "look" | "name">;
  mode: PermissionMode;
  pose: Pose;
  status: string;
  busy?: boolean;
  /** The first run with Hermit: the page stages the crab and says hello, so the bar keeps back, the mode chip and the menu. */
  quiet?: boolean;
  onBack(): void;
  onOpen(): void;
  onMenu(): void;
}) {
  const p = usePalette();
  const { identity, chip } = headerParts({ quiet: !!quiet, mode });
  return (
    <View style={{ flexDirection: "row", alignItems: "center", minHeight: 56, paddingLeft: s.xs, paddingRight: s.xs }}>
      <IconBtn icon="arrow-left" label={t("common.back")} onPress={onBack} />
      {!identity ? <View style={{ flex: 1 }} /> : (
        <Pressable
          onPress={onOpen}
          accessibilityRole="button"
          accessibilityLabel={`${bot.name}. ${status}. ${t("HM-BOT-02.settingsA11y", { name: bot.name })}`}
          style={({ pressed }) => ({ flex: 1, flexShrink: 1, flexDirection: "row", alignItems: "center", gap: s.sm, minHeight: 48, paddingHorizontal: s.sm, borderRadius: radius.pill, backgroundColor: pressed ? p.pressed : "transparent" })}
        >
          {bot.primary ? <Mascot state={pose} dark={p.dark} width={40} /> : <BotAvatar bot={bot} size={36} dark={p.dark} />}
          <View style={{ flexShrink: 1, gap: 1 }}>
            <T v="bodyStrong" lines={1}>{bot.name}</T>
            <CrossFade id={status} style={{ flexShrink: 1 }}>
              {(shown) => <T v="footnote" color={busy ? "text" : "soft"} live="polite" lines={1}>{shown}</T>}
            </CrossFade>
          </View>
        </Pressable>
      )}
      {chip ? <View style={{ marginHorizontal: s.xs }}><Chip label={t(chip.key)} tone={chip.tone} /></View> : null}
      <IconBtn icon="menu" label={t("HM-CHAT-01.menuA11y")} onPress={onMenu} />
    </View>
  );
}
