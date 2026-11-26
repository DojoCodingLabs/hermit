// A bot's face: Hermit's crab (the reference drawing, via Mascot, never altered) for the primary bot, a shell for every other
// (scripts/brand/shells.py: simple shapes in the brand palette, with the crab's own traced eyes). The shell carries the
// bot's name as its label; the crab is decorative, like everywhere else, because the name beside it says the same.
import { View } from "react-native";
import Svg, { Path } from "react-native-svg";
import type { Bot } from "@hermit/core";
import { SHELL_ART, SHELL_FILL, SHELL_STROKE } from "../shells.ts";
import { palettes } from "../theme";
import { Mascot } from "./Mascot";

type Props = { bot: Pick<Bot, "primary" | "look" | "name">; size: number; dark: boolean };

/** The crab's frame is 512 by 444; its width is `size`, so it sits in a square box of the same size. */
export function BotAvatar({ bot, size, dark }: Props) {
  if (bot.primary || !bot.look) {
    return (
      <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
        <Mascot state="idle" dark={dark} width={size} />
      </View>
    );
  }
  const theme = dark ? "dark" : "light";
  const art = SHELL_ART[bot.look.shape];
  const cut = palettes[theme].canvas;
  return (
    <Svg width={size} height={size} viewBox={art.viewBox} accessibilityLabel={bot.name} accessible>
      <Path d={art.body} fill={SHELL_FILL[bot.look.color][theme]} />
      <Path d={art.spiral} fill="none" stroke={cut} strokeWidth={SHELL_STROKE} strokeLinecap="round" strokeLinejoin="round" />
      <Path d={art.eyes[0]} fill={cut} />
      <Path d={art.eyes[1]} fill={cut} />
    </Svg>
  );
}
