// The onboarding scaffold (O1, O2, polish round): a slim three-step progress bar, the crab on its stage in the pose of
// the step, always centered at the top, a centered Newsreader headline and one line under it, the step's content, and
// the actions pinned under it. The first block rises in; the body scrolls at 200% text, so the actions stay on screen.
import type { ReactNode } from "react";
import { ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { t } from "../i18n";
import type { Pose } from "../mascot";
import { radius, s } from "../theme";
import { usePalette } from "../use-palette";
import { Stage, T } from "./kit";
import { Reveal } from "./motion";

const STEPS = 3;

export function Onb({ pose, step, title, body, children, footer }: { pose: Pose; step?: number; title: string; body?: string; children?: ReactNode; footer: ReactNode }) {
  const p = usePalette();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: p.canvas }}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, justifyContent: step ? "flex-start" : "center", paddingHorizontal: s.gutter, paddingTop: step ? s.lg : s.xl, paddingBottom: s.xl }}>
        {step ? (
          <View style={{ flexDirection: "row", justifyContent: "center", gap: 6 }} accessible accessibilityLabel={t("HM-ONB-01.step", { n: step, total: STEPS })}>
            {Array.from({ length: STEPS }, (_, i) => (
              <View key={i} style={{ width: 28, height: 4, borderRadius: radius.pill, backgroundColor: i < step ? p.accent : p.sunken }} />
            ))}
          </View>
        ) : null}
        <Reveal style={{ alignItems: "center", gap: s.md, marginTop: step ? s.xl : 0 }}>
          <Stage pose={pose} width={step ? 92 : 136} style={{ marginBottom: s.sm }} />
          <T v={step ? "display" : "hero"} role="header" center>{title}</T>
          {body ? <T v="body" color="soft" center style={{ maxWidth: 340 }}>{body}</T> : null}
        </Reveal>
        {children ? <Reveal delay={100} style={{ marginTop: s.xl, gap: s.lg }}>{children}</Reveal> : null}
      </ScrollView>
      {footer ? <View style={{ paddingHorizontal: s.gutter, paddingTop: s.sm, paddingBottom: s.lg, gap: s.xs }}>{footer}</View> : null}
    </SafeAreaView>
  );
}
