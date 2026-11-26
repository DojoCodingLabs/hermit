// The chat's quiet bar (C1, polish round): the small crab in the pose of the moment and one status in words beside it,
// both one button to Activity, and the menu. The status crossfades when it changes and always says what the pose
// says, so Quiet mode (no crab) loses nothing; it is a polite live region. "On this phone" is the idle status, and
// HM-CHAT-02 and clearing the chat moved into the menu.
import { Pressable, View } from "react-native";
import { t } from "../i18n";
import type { Pose } from "../mascot";
import { s } from "../theme";
import { usePalette } from "../use-palette";
import { IconBtn, T } from "./kit";
import { Mascot } from "./Mascot";
import { CrossFade } from "./motion";

export function CrabHeader({ pose, status, elapsed, busy, quiet, onCrab, onMenu }: {
  pose: Pose; status: string; elapsed?: string; busy?: boolean; onCrab(): void; onMenu(): void;
  /** The first run: the page stages the crab and says hello, so the bar keeps only the menu. */
  quiet?: boolean;
}) {
  const p = usePalette();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", minHeight: 56, paddingLeft: s.sm, paddingRight: s.xs }}>
      {quiet ? null : <Pressable
        onPress={onCrab}
        accessibilityRole="button"
        accessibilityLabel={`${status}. ${t("HM-CHAT-01.mascotA11y")}`}
        style={({ pressed }) => ({ flexShrink: 1, flexDirection: "row", alignItems: "center", gap: s.sm, minHeight: 48, paddingHorizontal: s.sm, borderRadius: 24, backgroundColor: pressed ? p.pressed : "transparent" })}
      >
        <Mascot state={pose} dark={p.dark} width={40} />
        <CrossFade id={status} style={{ flexShrink: 1 }}>
          {(shown) => <T v="smallStrong" color={busy ? "text" : "soft"} live="polite" lines={1}>{shown}</T>}
        </CrossFade>
        {elapsed ? <T v="footnote" color="soft" tabular>{elapsed}</T> : null}
      </Pressable>}
      <View style={{ flex: 1 }} />
      <IconBtn icon="menu" label={t("HM-CHAT-01.menuA11y")} onPress={onMenu} />
    </View>
  );
}
