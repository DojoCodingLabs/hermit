// The sheet chrome (docs/design/polish/decisions.md): a bottom sheet on the overlay surface that springs up over a
// fading backdrop (radius 28, a grab handle, a soft shadow), the amber "Needs your OK" mark that says a sheet is
// Hermit's own, the trust line that says who drew it, and the info sheet that holds a long explanation.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, Modal, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { t } from "../i18n";
import type { Pose } from "../mascot";
import { duration, easing, spring } from "../motion";
import { radius, s, shadow } from "../theme";
import { usePalette } from "../use-palette";
import { Icon } from "./Icon";
import { Btn, T } from "./kit";
import { Mascot } from "./Mascot";
import { bezier, useMotion } from "./motion";

/**
 * A bottom sheet. It rises on a spring while the backdrop fades in, and sinks back when `visible` turns false.
 * `onClose` runs for the back button (and a tap on the backdrop when `dismissable`). `footer` stays pinned under the
 * scrolling body, so the actions are always on screen; at large text the body scrolls.
 */
export function SheetModal({ visible = true, onClose, dismissable, closeLabel, children, footer }: {
  visible?: boolean; onClose(): void; dismissable?: boolean; closeLabel?: string; children: ReactNode; footer?: ReactNode;
}) {
  const p = usePalette();
  const motion = useMotion();
  const { height } = useWindowDimensions();
  const [mounted, setMounted] = useState(visible);
  const backdrop = useRef(new Animated.Value(visible && !motion ? 1 : 0)).current;
  const rise = useRef(new Animated.Value(visible && !motion ? 0 : 1)).current;

  useEffect(() => {
    if (visible) {
      setMounted(true);
      if (!motion) {
        backdrop.setValue(1);
        rise.setValue(0);
        return;
      }
      const a = Animated.parallel([
        Animated.timing(backdrop, { toValue: 1, duration: duration.medium, easing: bezier(easing.standard), useNativeDriver: true }),
        Animated.spring(rise, { toValue: 0, ...spring.sheet, useNativeDriver: true }),
      ]);
      a.start();
      return () => a.stop();
    }
    if (!motion) return setMounted(false);
    const a = Animated.parallel([
      Animated.timing(backdrop, { toValue: 0, duration: duration.medium * 0.75, easing: bezier(easing.exit), useNativeDriver: true }),
      Animated.timing(rise, { toValue: 1, duration: duration.medium, easing: bezier(easing.exit), useNativeDriver: true }),
    ]);
    a.start(({ finished }) => finished && setMounted(false));
    return () => a.stop();
  }, [visible, motion, backdrop, rise]);

  return (
    <Modal transparent animationType="none" visible={mounted} onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, justifyContent: "flex-end" }}>
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: p.scrim, opacity: backdrop }]}>
          {dismissable ? (
            <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityRole="button" accessibilityLabel={closeLabel ?? t("common.close")} />
          ) : null}
        </Animated.View>
        <Animated.View
          style={{
            maxHeight: "92%", backgroundColor: p.overlay, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet,
            boxShadow: shadow(p, "overlay"), transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [0, height] }) }],
          }}
          accessibilityViewIsModal
        >
          <View style={{ alignItems: "center", paddingTop: s.sm, paddingBottom: s.sm }} accessible={false} importantForAccessibility="no-hide-descendants">
            <View style={{ width: 36, height: 5, borderRadius: 3, backgroundColor: p.hairline }} />
          </View>
          <ScrollView contentContainerStyle={{ paddingHorizontal: s.xl, paddingBottom: footer ? s.md : s.xl }}>{children}</ScrollView>
          {/* The actions stay pinned; a hairline says the body scrolls under them. */}
          {footer ? <View style={{ paddingHorizontal: s.xl, paddingTop: s.md, paddingBottom: s.lg, gap: s.xs, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: p.hairline }}>{footer}</View> : null}
        </Animated.View>
      </View>
    </Modal>
  );
}

/**
 * The mark on every approval sheet, one quiet line: the asking crab (Hermit's mark) and "Needs your OK" in amber, the
 * "needs you" color (coral and the tucked-in crab for a refusal). Centered on a payment's confirmation.
 */
export function NeedsOk({ label, pose = "asking", tone = "amber", count, center }: { label: string; pose?: Pose; tone?: "amber" | "coral"; count?: string; center?: boolean }) {
  const p = usePalette();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: center ? "center" : "flex-start", gap: s.sm, marginBottom: s.md }}>
      <Mascot state={pose} dark={p.dark} width={36} />
      <T v="footnoteStrong" color={tone}>{label}</T>
      {count ? <View style={{ flex: 1, alignItems: "flex-end" }}><T v="footnote" color="soft">{count}</T></View> : null}
    </View>
  );
}

/**
 * The trust line at the foot of a sheet: who drew it and where it is signed, in one short line. With `onInfo`, a 48 dp
 * info button beside it opens the long explanation.
 */
export function SignedFoot({ text, onInfo, infoLabel }: { text: string; onInfo?: () => void; infoLabel?: string }) {
  const p = usePalette();
  return (
    <View style={{ flexDirection: "row", gap: s.sm, alignItems: "center", justifyContent: "center", minHeight: 48 }}>
      <Icon name="shield-check" size={20} color={p.mark} />
      <T v="footnote" color="soft" style={{ flexShrink: 1 }}>{text}</T>
      {onInfo ? (
        <Pressable onPress={onInfo} accessibilityRole="button" accessibilityLabel={infoLabel ?? t("common.moreInfo")} style={({ pressed }) => ({ width: 48, height: 48, marginVertical: -s.xs, alignItems: "center", justifyContent: "center", borderRadius: 24, backgroundColor: pressed ? p.pressed : "transparent" })}>
          <Icon name="info" size={20} color={p.textSoft} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** A long explanation moved out of a screen: a title, short paragraphs, and one button to close it. */
export function InfoSheet({ visible, onClose, title, paragraphs }: { visible: boolean; onClose(): void; title: string; paragraphs: string[] }) {
  return (
    <SheetModal visible={visible} onClose={onClose} dismissable footer={<Btn label={t("common.understood")} kind="secondary" full onPress={onClose} />}>
      <T v="title" role="header" style={{ marginBottom: s.md }}>{title}</T>
      <View style={{ gap: s.md }}>
        {paragraphs.map((text) => <T key={text} v="body" color="soft">{text}</T>)}
      </View>
    </SheetModal>
  );
}
