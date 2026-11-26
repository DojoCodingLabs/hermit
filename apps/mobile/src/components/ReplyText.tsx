// Q155: a reply drawn as structure by the design system: short headings, numbered steps and bullets read from its plain
// text (`replyBlocks` in @hermit/runtime), so no markdown symbol ever shows. Model text is untrusted for links: nothing
// here is tappable (a Text detects no links unless asked to, and none is). Each block is its own selectable text and
// its own TalkBack stop, a step read with its number; headings are headers, so TalkBack can jump between them. The
// marker column grows with the phone's font size, so lists keep their hanging indent at 200%.
import { useWindowDimensions, View } from "react-native";
import type { ReplyBlock } from "@hermit/runtime";
import { T, type Tone } from "./kit";
import { s } from "../theme";

export function ReplyText({ blocks, text, color }: { blocks: readonly ReplyBlock[]; text: string; color: Tone }) {
  const { fontScale } = useWindowDimensions();
  // A plain reply stays one text, as it always was (its markdown, if any, already out).
  if (blocks.length <= 1 && (blocks[0]?.kind ?? "paragraph") === "paragraph") {
    return <T v="body" color={color} selectable>{blocks[0]?.text ?? text}</T>;
  }
  const marker = Math.round(22 * Math.min(Math.max(fontScale, 1), 2));
  return (
    <View style={{ gap: s.sm }}>
      {blocks.map((b, i) => <Block key={i} block={b} color={color} first={i === 0} marker={marker} />)}
    </View>
  );
}

function Block({ block: b, color, first, marker }: { block: ReplyBlock; color: Tone; first: boolean; marker: number }) {
  switch (b.kind) {
    case "heading":
      return <T v="bodyStrong" color={color} role="header" selectable style={first ? undefined : { marginTop: s.xs }}>{b.text}</T>;
    case "paragraph":
      return <T v="body" color={color} selectable>{b.text}</T>;
    case "bullet":
      return (
        <View style={{ flexDirection: "row", gap: s.sm, paddingLeft: b.depth ? marker : 0 }} accessible accessibilityLabel={b.text}>
          <T v="body" color={color}>•</T>
          <T v="body" color={color} selectable style={{ flex: 1 }}>{b.text}</T>
        </View>
      );
    case "step":
      return (
        <View style={{ flexDirection: "row", gap: s.sm, paddingLeft: b.depth ? marker : 0 }} accessible accessibilityLabel={`${b.n}. ${b.text}`}>
          <T v="bodyStrong" color={color} tabular style={{ minWidth: marker }}>{`${b.n}.`}</T>
          <T v="body" color={color} selectable style={{ flex: 1 }}>{b.text}</T>
        </View>
      );
  }
}
