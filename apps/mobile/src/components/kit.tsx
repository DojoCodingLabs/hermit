// The building blocks of every screen (docs/design/polish/decisions.md): type, buttons, grouped lists, badges, fields,
// switches, segmented choices, and the page scaffold. Colors are palette roles (../theme.ts), sizes sit on the 4 pt
// grid, motion reads ../motion.ts through ./motion.tsx. Text follows the phone's font size (size and line height scale
// together) and nothing has a fixed text height, so rows wrap and pages scroll at 200%. Every control is at least
// 48 dp and carries a role and a label.
import { useId, useRef, useState, type ReactElement, type ReactNode } from "react";
import {
  ActivityIndicator, Animated, Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions,
  type FlatList, type StyleProp, type TextInputProps, type TextStyle, type ViewStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Svg, { Circle, Defs, RadialGradient, Stop } from "react-native-svg";
import { useRouter } from "expo-router";
import { groupAddress } from "../format";
import { haptic } from "../haptics";
import { t } from "../i18n";
import type { Pose } from "../mascot";
import { font, radius, s, shadow, size, type ColorRole, type Palette } from "../theme";
import { usePalette } from "../use-palette";
import { Icon, useIconSize, type IconName } from "./Icon";
import { Mascot } from "./Mascot";
import { usePress, useSpringTo } from "./motion";

export type Variant =
  | "hero" | "display" | "title" | "amount" | "lead" | "body" | "bodyStrong" | "small" | "smallStrong"
  | "footnote" | "footnoteStrong" | "caption" | "captionStrong" | "mono" | "monoSmall" | "figure" | "quote";

type Spec = { family: string; size: number; line: number; strong?: boolean; tracking: number; tabular?: boolean };

/**
 * The type scale. Newsreader (one display cut, optical size 36) for titles and large amounts, with negative tracking;
 * Instrument Sans for everything else in two weights a screen: regular for reading, "strong" for labels, row titles and
 * buttons (500, and 600 in Deep sea, where light text on dark reads thinner). Tracking is in em.
 */
const scale: Record<Variant, Spec> = {
  hero: { family: font.display, size: size.hero, line: 46, tracking: -0.02 },
  display: { family: font.display, size: size.display, line: 40, tracking: -0.018 },
  title: { family: font.display, size: size.title, line: 32, tracking: -0.012 },
  amount: { family: font.display, size: size.amount, line: 62, tracking: -0.025, tabular: true },
  lead: { family: font.ui, size: size.lead, line: 26, strong: true, tracking: -0.006 },
  body: { family: font.ui, size: size.body, line: 24, tracking: 0 },
  bodyStrong: { family: font.ui, size: size.body, line: 24, strong: true, tracking: 0 },
  small: { family: font.ui, size: size.small, line: 20, tracking: 0.004 },
  smallStrong: { family: font.ui, size: size.small, line: 20, strong: true, tracking: 0.004 },
  footnote: { family: font.ui, size: size.footnote, line: 18, tracking: 0.008 },
  footnoteStrong: { family: font.ui, size: size.footnote, line: 18, strong: true, tracking: 0.008 },
  caption: { family: font.ui, size: size.caption, line: 16, tracking: 0.012 },
  captionStrong: { family: font.ui, size: size.caption, line: 16, strong: true, tracking: 0.012 },
  mono: { family: font.mono, size: size.small, line: 20, tracking: 0 },
  monoSmall: { family: font.mono, size: size.caption, line: 16, tracking: 0 },
  figure: { family: font.ui, size: 32, line: 38, strong: true, tracking: -0.01, tabular: true },
  /** Someone's own words, quoted (the approval sheet's "You said"). */
  quote: { family: font.display, size: 20, line: 28, tracking: -0.004 },
};

const isDisplay = (v: Variant) => scale[v].family === font.display;

/** The text style of a variant, for the few places that style a TextInput or a raw Text. */
export function typeStyle(p: Palette, v: Variant): TextStyle {
  const spec = scale[v];
  const weight = isDisplay(v) ? "400" : spec.strong ? (p.dark ? "600" : "500") : "400";
  // Light text on Deep sea reads tighter: small sizes open up a hair there.
  const tracking = spec.tracking + (p.dark && !isDisplay(v) && spec.size <= size.body ? 0.006 : 0);
  return {
    fontFamily: spec.family, fontSize: spec.size, lineHeight: spec.line, fontWeight: weight,
    letterSpacing: Math.round(tracking * spec.size * 100) / 100,
    ...(spec.tabular ? { fontVariant: ["tabular-nums" as const] } : {}),
  };
}

/** A palette role ("soft", "coral") or a color already read from the palette. */
export type Tone = ColorRole | (string & {});

const colorOf = (p: Palette, c: Tone | undefined): string => (c === undefined ? p.text : ((p as Record<string, unknown>)[c] as string | undefined) ?? c);

/**
 * Text in one of the type roles. Titles and centered text break into balanced lines on Android, so neither ends on
 * a single word.
 */
export function T({ v = "body", color, style, children, center, lines, selectable, role, live, tabular }: {
  v?: Variant; color?: Tone; style?: StyleProp<TextStyle>; children: ReactNode; center?: boolean; lines?: number; selectable?: boolean;
  role?: "header" | "text"; live?: "polite" | "assertive"; tabular?: boolean;
}) {
  const p = usePalette();
  return (
    <Text
      numberOfLines={lines}
      selectable={selectable}
      accessibilityRole={role}
      accessibilityLiveRegion={live}
      textBreakStrategy={isDisplay(v) || center ? "balanced" : "highQuality"}
      style={[typeStyle(p, v), { color: colorOf(p, color), textAlign: center ? "center" : undefined }, tabular ? { fontVariant: ["tabular-nums"] } : null, style]}
    >
      {children}
    </Text>
  );
}

export type BtnKind = "primary" | "secondary" | "text" | "amber" | "coral" | "coralOutline";

/**
 * Buttons: one filled primary per screen, a tonal secondary (a tint of the accent, no outline), a text tertiary.
 * Amber is the filled "needs you" action, coral the filled destructive confirm, coralOutline the tonal destructive.
 * They sink a little on press. Disabled keeps its shape in the sunken fill, so it reads as waiting, not broken.
 */
export function Btn({ label, kind = "primary", icon, onPress, full, disabled, busy, a11y, hint, small, style }: {
  label: string; kind?: BtnKind; icon?: IconName; onPress?: () => void; full?: boolean; disabled?: boolean; busy?: boolean; a11y?: string; hint?: string; small?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const p = usePalette();
  const pressed = usePress("scale");
  const look: Record<BtnKind, { bg: string; fg: string }> = {
    primary: { bg: p.accent, fg: p.onAccent },
    secondary: { bg: p.accentTint, fg: p.accent },
    text: { bg: "transparent", fg: p.accent },
    amber: { bg: p.amber, fg: p.onAmber },
    coral: { bg: p.coral, fg: p.onCoral },
    coralOutline: { bg: p.coralTint, fg: p.coral },
  };
  const off = !!disabled || !!busy;
  const l = disabled && kind !== "text" ? { bg: p.sunken, fg: p.textSoft } : look[kind];
  return (
    <Pressable
      onPress={() => {
        // A primary action answers with the phone's own light tick (no permission; off with the phone's touch feedback).
        if (kind === "primary") haptic("tick");
        onPress?.();
      }}
      {...pressed.handlers}
      disabled={off}
      accessibilityRole="button"
      accessibilityLabel={a11y ?? label}
      accessibilityHint={hint}
      accessibilityState={{ disabled: off, busy: !!busy }}
      style={[{ minHeight: 48, minWidth: 48, alignSelf: full ? "stretch" : "flex-start", justifyContent: "center" }, style]}
    >
      <Animated.View
        style={[{
          minHeight: small || kind === "text" ? 48 : 52, borderRadius: radius.pill, backgroundColor: l.bg,
          paddingHorizontal: kind === "text" ? s.md : small ? s.lg : s.xl, paddingVertical: s.sm,
          flexDirection: "row", alignItems: "center", justifyContent: "center", gap: s.sm,
          opacity: disabled && kind === "text" ? 0.5 : 1,
        }, pressed.style]}
      >
        {busy ? <ActivityIndicator size="small" color={l.fg} /> : icon ? <Icon name={icon} size={20} color={l.fg} /> : null}
        <T v="bodyStrong" color={l.fg} center style={{ flexShrink: 1 }}>{label}</T>
      </Animated.View>
    </Pressable>
  );
}

/** A 48 dp round icon button with a spoken label; a quiet circle shows under it while pressed. */
export function IconBtn({ icon, label, onPress, tone = "text", filled, disabled }: { icon: IconName; label: string; onPress?: () => void; tone?: ColorRole; filled?: boolean; disabled?: boolean }) {
  const p = usePalette();
  const pressed = usePress("scale");
  return (
    <Pressable
      onPress={onPress}
      {...pressed.handlers}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed: down }) => ({ width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", backgroundColor: filled ? p.accent : down ? p.pressed : "transparent", opacity: disabled ? 0.5 : 1 })}
    >
      <Animated.View style={pressed.style}>
        <Icon name={icon} size={24} color={filled ? p.onAccent : colorOf(p, tone)} fixed />
      </Animated.View>
    </Pressable>
  );
}

/** The animated FlatList (its scroll drives the title on the native thread), with FlatList's own item typing. */
const ScrollingList = Animated.FlatList as unknown as typeof FlatList;

/**
 * A screen: a 56 dp bar with the back button, a large Newsreader title that scrolls with the content (the bar picks
 * up a small copy of it, and a hairline, once the large one has gone by), and an optional footer that stays on screen.
 * Used with the stack header hidden.
 */
export function Page<T>({ title, back = true, children, footer, action, subtitle, scroll = true, compact, list }: {
  title?: string; back?: boolean; children?: ReactNode; footer?: ReactNode; action?: ReactNode; subtitle?: ReactNode; scroll?: boolean;
  /** The title stays small in the bar (an immersive screen, like a web task's live page). */
  compact?: boolean;
  /** A long list (the vault, the log, memories): drawn like a Group, row by row, so only what is on screen is built. */
  list?: PageList<T>;
}) {
  const p = usePalette();
  const router = useRouter();
  const y = useRef(new Animated.Value(0)).current;
  const past = y.interpolate({ inputRange: compact ? [0, 16] : [24, 56], outputRange: compact ? [0, 1] : [0, 1], extrapolate: "clamp" });
  const onScroll = Animated.event([{ nativeEvent: { contentOffset: { y } } }], { useNativeDriver: true });
  const scrolls = scroll || !!list;
  const head = (
    <>
      {title && !compact ? <T v="display" role="header" style={{ marginTop: s.xs, marginBottom: subtitle ? s.sm : s.xl }}>{title}</T> : null}
      {subtitle ? <View style={{ marginBottom: s.xl }}>{subtitle}</View> : null}
    </>
  );
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: p.canvas }} edges={["top", "bottom", "left", "right"]}>
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: s.xs, minHeight: 56, gap: s.xs }}>
        {back ? <IconBtn icon="arrow-left" label={t("common.back")} onPress={() => router.back()} /> : <View style={{ width: 48 }} />}
        {compact ? (
          <View style={{ flex: 1 }}>{title ? <T v="bodyStrong" role="header" lines={1}>{title}</T> : null}</View>
        ) : (
          // The bar's copy of the title is for the eye only: TalkBack reads the large one.
          <Animated.View style={{ flex: 1, opacity: scrolls ? past : 0 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            {title ? <T v="bodyStrong" lines={1}>{title}</T> : null}
          </Animated.View>
        )}
        {action}
      </View>
      <Animated.View style={{ height: StyleSheet.hairlineWidth, backgroundColor: p.hairline, opacity: scrolls ? past : 0 }} />
      {list ? (
        <ScrollingList
          style={{ flex: 1 }}
          data={list.data}
          extraData={list}
          keyExtractor={(item: T) => list.keyOf(item)}
          renderItem={({ item, index }: { item: T; index: number }) => (
            <GroupCell first={index === 0} last={index === list.data.length - 1} inset={leadInset(list.lead)}>{list.row(item)}</GroupCell>
          )}
          // Views, not fragments: the list measures its header, empty state and footer (it passes them onLayout).
          ListHeaderComponent={<View>{head}{list.top}</View>}
          ListEmptyComponent={list.empty ? <View style={{ flexGrow: 1 }}>{list.empty}</View> : undefined}
          ListFooterComponent={list.bottom ? <View>{list.bottom}</View> : undefined}
          onEndReached={list.onEnd ? () => list.onEnd?.() : undefined}
          onEndReachedThreshold={0.6}
          contentContainerStyle={{ flexGrow: 1, paddingHorizontal: s.gutter, paddingBottom: s.xxl }}
          keyboardShouldPersistTaps="handled"
          scrollEventThrottle={16}
          onScroll={onScroll}
        />
      ) : scroll ? (
        <Animated.ScrollView
          style={{ flex: 1 }}
          // flexGrow: the content fills the screen, so an empty state can sit at the optical center of what is left.
          contentContainerStyle={{ flexGrow: 1, paddingHorizontal: s.gutter, paddingBottom: s.xxl }}
          keyboardShouldPersistTaps="handled"
          scrollEventThrottle={16}
          onScroll={onScroll}
        >
          {head}
          {children}
        </Animated.ScrollView>
      ) : (
        <View style={{ flex: 1, paddingHorizontal: s.gutter }}>
          {head}
          {children}
        </View>
      )}
      {footer}
    </SafeAreaView>
  );
}

/** Actions pinned under a page, over a hairline. */
export function Footer({ children }: { children: ReactNode }) {
  const p = usePalette();
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: s.sm, paddingHorizontal: s.gutter, paddingTop: s.md, paddingBottom: s.lg, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: p.hairline, backgroundColor: p.canvas }}>
      {children}
    </View>
  );
}

/** A section label above a group: sentence case, a muted footnote, lined up with the rows' text. */
export function Label({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ marginTop: s.section, marginBottom: s.sm, paddingHorizontal: s.lg }, style]}>
      <T v="footnoteStrong" color="soft" role="header">{children}</T>
    </View>
  );
}

/** Where a row's text starts, so a separator can start there too (past the leading tile). */
const TILE = 32;
const AVATAR = 40;
const leadInset = (lead?: "tile" | "avatar") => s.lg + (lead === "avatar" ? AVATAR + s.md : lead === "tile" ? TILE + s.md : 0);
const rowInset = (child: unknown) => {
  const props = (child as { props?: { icon?: unknown; leading?: unknown } } | null)?.props;
  return leadInset(props?.leading ? "avatar" : props?.icon ? "tile" : undefined);
};

/** A grouped list on the raised surface: radius 20, a soft shadow, hairlines inset past the leading tiles. */
export function Group({ children, style, lead }: {
  children: ReactNode; style?: StyleProp<ViewStyle>;
  /** What leads rows the group can't see into (a custom row with its own tile), for where the hairlines start. */
  lead?: "tile" | "avatar";
}) {
  const p = usePalette();
  const items = (Array.isArray(children) ? children : [children]).flat().filter(Boolean);
  // Every separator in a group starts where the rows' text does, so they line up even past a row of another kind.
  const inset = Math.max(leadInset(lead), ...items.map(rowInset));
  return (
    <View style={[{ backgroundColor: p.raised, borderRadius: radius.card, boxShadow: shadow(p, "raised") }, style]}>
      <View style={{ borderRadius: radius.card, overflow: "hidden" }}>
        {items.map((child, i) => (
          <View key={i}>
            {i > 0 ? <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: p.hairline, marginLeft: inset }} /> : null}
            {child}
          </View>
        ))}
      </View>
    </View>
  );
}

/** A page's long list: its rows, how to key them, and what sits above, instead of and under them. */
export type PageList<T> = {
  data: readonly T[];
  keyOf: (item: T) => string;
  row: (item: T) => ReactElement;
  /** What leads each row, so the hairlines start where the text does. */
  lead?: "tile" | "avatar";
  /** Under the title, above the rows (a search field, a note). */
  top?: ReactNode;
  /** Instead of the rows when there are none. */
  empty?: ReactNode;
  /** Under the rows (a loading line, the end of a history). */
  bottom?: ReactNode;
  /** Near the end of the rows (older pages). */
  onEnd?: () => void;
};

/** Room around a cell for the raised shadow, clipped where two cells meet so the seams stay clean. */
const REACH = 24;

/**
 * One row of a long list with the Group look, so a FlatList can build only the rows on screen: the first and last
 * cells carry the rounded corners, the others a hairline at the text's inset. Each cell draws the shadow; the cell's
 * frame clips it to the sides (and to the top of the first, the bottom of the last), so the stack reads as one card.
 */
function GroupCell({ first, last, inset, children }: { first: boolean; last: boolean; inset: number; children: ReactNode }) {
  const p = usePalette();
  const corners = {
    borderTopLeftRadius: first ? radius.card : 0, borderTopRightRadius: first ? radius.card : 0,
    borderBottomLeftRadius: last ? radius.card : 0, borderBottomRightRadius: last ? radius.card : 0,
  };
  return (
    <View
      pointerEvents="box-none"
      style={{
        overflow: "hidden", marginHorizontal: -REACH, paddingHorizontal: REACH,
        marginTop: first ? -REACH : 0, paddingTop: first ? REACH : 0, marginBottom: last ? -REACH : 0, paddingBottom: last ? REACH : 0,
      }}
    >
      <View style={[{ backgroundColor: p.raised, boxShadow: shadow(p, "raised") }, corners]}>
        <View style={[{ overflow: "hidden" }, corners]}>
          {first ? null : <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: p.hairline, marginLeft: inset }} />}
          {children}
        </View>
      </View>
    </View>
  );
}

export type TileTone = "accent" | "amber" | "coral" | "plain";

const tileToneOf = (role: ColorRole | undefined): TileTone =>
  role === "coral" || role === "blocked" ? "coral" : role === "amber" || role === "approve" ? "amber" : role === "soft" || role === "outline" || role === "textSoft" ? "plain" : "accent";

/** A leading icon in a tinted squircle: the row's kind at a glance. Grows with the text like the icons do. */
export function Tile({ icon, tone = "accent" }: { icon: IconName; tone?: TileTone }) {
  const p = usePalette();
  const box = useIconSize(TILE);
  const fg = tone === "amber" ? p.amber : tone === "coral" ? p.coral : tone === "plain" ? p.textSoft : p.accent;
  const bg = tone === "amber" ? p.amberTint : tone === "coral" ? p.coralTint : tone === "plain" ? p.sunken : p.accentTint;
  return (
    <View style={{ width: box, height: box, borderRadius: radius.tile, backgroundColor: bg, alignItems: "center", justifyContent: "center" }}>
      <Icon name={icon} size={20} color={fg} />
    </View>
  );
}

/** A round initial for a person or a site (a payee, a sender), in the accent's tint. */
export function Avatar({ name, tone = "accent" }: { name: string; tone?: TileTone }) {
  const p = usePalette();
  const box = useIconSize(AVATAR);
  const fg = tone === "amber" ? p.amber : tone === "coral" ? p.coral : tone === "plain" ? p.textSoft : p.accent;
  const bg = tone === "amber" ? p.amberTint : tone === "coral" ? p.coralTint : tone === "plain" ? p.sunken : p.accentTint;
  const initial = [...name.trim()][0]?.toLocaleUpperCase() ?? "?";
  return (
    <View style={{ width: box, height: box, borderRadius: box / 2, backgroundColor: bg, alignItems: "center", justifyContent: "center" }} accessible={false} importantForAccessibility="no-hide-descendants">
      <T v="bodyStrong" color={fg}>{initial}</T>
    </View>
  );
}

/**
 * One row: a leading tile (or `leading`, an avatar), a title, an optional second line, and a trailing status, control
 * or chevron. A chevron only where the row opens something. Rows dim while pressed.
 */
export function Row({ icon, leading, title, sub, trailing, chevron, iconColor, onPress, titleColor, top, a11y, hint, role = "button", disabled }: {
  icon?: IconName; leading?: ReactNode; title: ReactNode; sub?: ReactNode; trailing?: ReactNode; chevron?: boolean; iconColor?: ColorRole; onPress?: () => void;
  titleColor?: ColorRole; top?: boolean; a11y?: string; hint?: string; role?: "button" | "link"; disabled?: boolean;
}) {
  const p = usePalette();
  const body = (
    <View style={{ flexDirection: "row", alignItems: top ? "flex-start" : "center", minHeight: 56, paddingVertical: s.md, paddingHorizontal: s.lg, gap: s.md, opacity: disabled ? 0.5 : 1 }}>
      {leading ?? (icon ? <Tile icon={icon} tone={tileToneOf(iconColor)} /> : null)}
      <View style={{ flex: 1, gap: 2 }}>
        {typeof title === "string" ? <T v="bodyStrong" color={titleColor}>{title}</T> : title}
        {typeof sub === "string" ? <T v="small" color="soft">{sub}</T> : sub}
      </View>
      {trailing}
      {chevron ? <Icon name="chevron-right" size={20} color={p.textSoft} /> : null}
    </View>
  );
  if (!onPress) return body;
  const spoken = a11y ?? [title, sub].filter((x) => typeof x === "string").join(", ");
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole={role}
      accessibilityLabel={spoken}
      accessibilityHint={hint}
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => ({ backgroundColor: pressed ? p.pressed : "transparent" })}
    >
      {body}
    </Pressable>
  );
}

/**
 * A row's title with a short fact at its end (a time, an amount), on one baseline. With large text (Android's font
 * size at 130% and up) the fact moves under the title, so neither is squeezed to a word per line.
 */
export function TitleLine({ title, lines, aside, asideV = "footnote", asideColor = "soft" }: {
  title: string; lines?: number; aside: string; asideV?: Variant; asideColor?: Tone;
}) {
  const { fontScale } = useWindowDimensions();
  const stacked = fontScale >= 1.3;
  return (
    <View style={stacked ? { gap: 2 } : { flexDirection: "row", alignItems: "baseline", gap: s.sm }}>
      <T v="bodyStrong" lines={lines} style={stacked ? undefined : { flex: 1 }}>{title}</T>
      <T v={asideV} color={asideColor} tabular>{aside}</T>
    </View>
  );
}

/**
 * A whole counterparty address for checking (address poisoning): mono, in groups of four after the 0x, so a line
 * breaks only between groups, the way hardware wallets show one. Display only: it isn't selectable (a selection would
 * carry the spaces); copying goes through a copy action with the address itself, and a row's TalkBack label names it.
 */
export function WholeAddress({ address, v = "monoSmall", color = "soft" }: { address: string; v?: Variant; color?: Tone }) {
  return <T v={v} color={color}>{groupAddress(address)}</T>;
}

/** A trailing status on a row: a short word in the secondary color, with an optional icon. */
export function Status({ text, tone = "soft", icon }: { text: string; tone?: "soft" | "link" | "coral" | "amber"; icon?: IconName }) {
  const p = usePalette();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4, maxWidth: 168, flexShrink: 1 }}>
      {icon ? <Icon name={icon} size={20} color={p[tone]} /> : null}
      <T v="small" color={tone} style={{ textAlign: "right", flexShrink: 1 }}>{text}</T>
    </View>
  );
}

export type ChipTone = "plain" | "hermit" | "amber" | "coral";

/**
 * A badge: a small tonal label, for information only (not a control), at most one per row. Text only; the icon a
 * caller passes is not drawn (badges are too small for the 20 dp icon rule). `filled` keeps the same tonal look.
 */
export function Chip({ label, tone = "plain" }: { label: string; icon?: IconName; tone?: ChipTone; filled?: boolean }) {
  const p = usePalette();
  const fg = { plain: p.textSoft, hermit: p.accent, amber: p.amber, coral: p.coral }[tone];
  const bg = { plain: p.sunken, hermit: p.accentTint, amber: p.amberTint, coral: p.coralTint }[tone];
  return (
    <View style={{ alignSelf: "flex-start", maxWidth: "100%", minHeight: 24, justifyContent: "center", paddingHorizontal: s.sm, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: bg }}>
      <T v="captionStrong" color={fg} style={{ flexShrink: 1 }}>{label}</T>
    </View>
  );
}

/** The same badge under the name the polish round uses. */
export const Badge = Chip;

/**
 * A card on the raised surface with a soft shadow. Tones are tints: amber ("needs you"), coral (blocked), hermit.
 * No outlined variant: the polish round's final sweep took every border off the cards (a surface, never a frame).
 */
export function Card({ children, style, tone }: { children: ReactNode; style?: StyleProp<ViewStyle>; tone?: "amber" | "coral" | "hermit" }) {
  const p = usePalette();
  const bg = tone === "amber" ? p.amberTint : tone === "coral" ? p.coralTint : tone === "hermit" ? p.accentTint : p.raised;
  return (
    <View style={[{ backgroundColor: bg, borderRadius: radius.card, padding: s.lg, boxShadow: tone ? undefined : shadow(p, "raised") }, style]}>
      {children}
    </View>
  );
}

/** An icon and a line of text side by side (a note, a promise, a reason). */
export function Note({ icon, text, tone = "mark", textColor = "soft", v = "small" }: { icon: IconName; text: string; tone?: ColorRole; textColor?: Tone; v?: Variant }) {
  const p = usePalette();
  const line = scale[v].line;
  return (
    <View style={{ flexDirection: "row", gap: s.sm, alignItems: "flex-start" }}>
      <View style={{ height: line, justifyContent: "center" }}><Icon name={icon} size={20} color={p[tone]} /></View>
      <T v={v} color={textColor} style={{ flex: 1 }}>{text}</T>
    </View>
  );
}

/** A labelled value: the label a soft footnote, the value body (or mono for addresses and hashes). */
export function Field({ label, value, mono, children, selectable }: { label: string; value?: string; mono?: boolean; children?: ReactNode; selectable?: boolean }) {
  return (
    <View style={{ gap: 2, paddingVertical: s.sm }} accessible={value !== undefined} accessibilityLabel={value !== undefined ? `${label}: ${value}` : undefined}>
      <T v="footnote" color="soft">{label}</T>
      {value !== undefined ? <T v={mono ? "mono" : "body"} selectable={selectable}>{value}</T> : null}
      {children}
    </View>
  );
}

/** A slim meter: used of the limit in the accent, coral at or over the limit. Decorative: the numbers sit beside it. */
export function Meter({ used, cap, over }: { used: number; cap: number; over?: boolean }) {
  const p = usePalette();
  const pct = cap > 0 ? Math.min(1, Math.max(0, used / cap)) : 1;
  const grow = useSpringTo(pct, "gentle");
  return (
    <View style={{ height: 6, borderRadius: 3, backgroundColor: p.dark ? p.track : p.sunken, overflow: "hidden" }} accessible={false} importantForAccessibility="no-hide-descendants">
      <Animated.View style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: "100%", borderRadius: 3, backgroundColor: over ? p.coral : p.meter, transformOrigin: "left", transform: [{ scaleX: grow }] }} />
    </View>
  );
}

/** A switch in the brand colors (52 by 32, inside a 48 dp target); the knob slides. */
export function Toggle({ on, label, onChange, disabled }: { on: boolean; label: string; onChange?: (next: boolean) => void; disabled?: boolean }) {
  const p = usePalette();
  const x = useSpringTo(on ? 1 : 0, "gentle");
  return (
    <Pressable
      onPress={() => {
        haptic("tick");
        onChange?.(!on);
      }}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: on, disabled: !!disabled }}
      style={{ minWidth: 52, minHeight: 48, justifyContent: "center", opacity: disabled ? 0.5 : 1 }}
    >
      <View style={{ width: 52, height: 32, borderRadius: 16, backgroundColor: on ? p.accent : p.sunken, borderWidth: 2, borderColor: on ? p.accent : p.outline, justifyContent: "center" }}>
        <Animated.View
          style={{
            width: 20, height: 20, borderRadius: 10, marginLeft: 4, backgroundColor: on ? p.onAccent : p.outline,
            transform: [{ translateX: x.interpolate({ inputRange: [0, 1], outputRange: [0, 20] }) }, { scale: x.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1.2] }) }],
          }}
        />
      </View>
    </Pressable>
  );
}

/**
 * A choice of a few short options as one segmented control (in place of radio cards): a sunken track, the chosen
 * segment raised and sliding into place. Each segment is a 48 dp radio; a disabled option is struck out.
 */
export function Segmented({ options, value, disabled = [], label, onChange, a11yOf, inactive }: {
  options: string[]; value: number; disabled?: number[]; label: string; onChange?: (i: number) => void; a11yOf?: (option: string) => string;
  /** The whole control waits (a stored value still loading, a save in flight): dimmed, nothing struck out. */
  inactive?: boolean;
}) {
  const p = usePalette();
  const [width, setWidth] = useState(0);
  const x = useSpringTo(Math.max(0, value), "gentle");
  const seg = width > 0 ? (width - 8) / options.length : 0;
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={{ flexDirection: "row", alignSelf: "stretch", padding: 4, borderRadius: radius.pill, backgroundColor: p.sunken, opacity: inactive ? 0.5 : 1 }}
    >
      {seg > 0 && value >= 0 ? (
        <Animated.View
          style={{
            position: "absolute", top: 4, bottom: 4, left: 4, width: seg, borderRadius: radius.pill,
            backgroundColor: p.dark ? p.track : p.overlay, boxShadow: shadow(p, "lifted"),
            transform: [{ translateX: x.interpolate({ inputRange: [0, Math.max(1, options.length - 1)], outputRange: [0, seg * Math.max(1, options.length - 1)] }) }],
          }}
        />
      ) : null}
      {options.map((o, i) => {
        const on = i === value;
        const off = disabled.includes(i);
        return (
          <Pressable
            key={o}
            onPress={() => {
              if (off || inactive || i === value) return;
              haptic("tick");
              onChange?.(i);
            }}
            disabled={off || inactive}
            accessibilityRole="radio"
            accessibilityState={{ checked: on, disabled: off || !!inactive }}
            accessibilityLabel={a11yOf ? a11yOf(o) : o}
            style={{ flex: 1, minHeight: 48, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 }}
          >
            <T v="smallStrong" color={on ? p.text : p.textSoft} center style={off ? { textDecorationLine: "line-through" } : undefined}>{o}</T>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A choice in a list (language, a site's login): the whole row is the 48 dp radio, a check marks the chosen one. */
export function Radio({ label, sub, on, onPress, disabled }: { label: string; sub?: string; on: boolean; onPress?: () => void; disabled?: boolean }) {
  const p = usePalette();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityLabel={sub ? `${label}, ${sub}` : label}
      accessibilityState={{ checked: on, disabled: !!disabled }}
      style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: s.md, minHeight: 56, paddingHorizontal: s.lg, paddingVertical: s.md, opacity: disabled ? 0.5 : 1, backgroundColor: pressed ? p.pressed : "transparent" })}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <T v="bodyStrong">{label}</T>
        {sub ? <T v="small" color="soft">{sub}</T> : null}
      </View>
      <View style={{ width: 24, alignItems: "center" }}>{on ? <Icon name="check" size={20} color={p.accent} /> : null}</View>
    </Pressable>
  );
}

/** A hairline divider. */
export function Rule({ style }: { style?: StyleProp<ViewStyle> }) {
  const p = usePalette();
  return <View style={[{ height: StyleSheet.hairlineWidth, backgroundColor: p.hairline }, style]} />;
}

/** A small dot in the Hermit color, for real state only (a live marker), never decoration. */
export function Dot({ color }: { color?: string }) {
  const p = usePalette();
  return <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color ?? p.mark }} />;
}

/**
 * A labelled text field: the label above, an optional hint under it, a filled 52 dp field in the sunken color with a
 * ring in the accent while focused (coral when invalid). `field` passes the rest through to the TextInput.
 */
export function Input({ label, value, onChange, numeric, mono, big, style, hint, field, invalid, unit }: {
  label: string; value: string; onChange(v: string): void; numeric?: boolean; mono?: boolean; big?: boolean; style?: StyleProp<ViewStyle>;
  hint?: string; field?: Omit<TextInputProps, "value" | "onChangeText" | "accessibilityLabel" | "style">; invalid?: boolean;
  /** A unit shown inside the field, after the value ("USD₮"), so the label never repeats it. */
  unit?: string;
}) {
  const p = usePalette();
  const [focused, setFocused] = useState(false);
  return (
    <View style={[{ gap: 6 }, style]}>
      {/* One text column: the label, the hint and the typed value all start 16 dp in, like the rows' text and the
          section labels, so a form reads down one edge. */}
      <T v="footnoteStrong" color="soft" style={{ paddingHorizontal: s.lg }}>{label}</T>
      {hint ? <T v="caption" color="soft" style={{ paddingHorizontal: s.lg }}>{hint}</T> : null}
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType={numeric ? "decimal-pad" : "default"}
        placeholderTextColor={p.textSoft}
        {...field}
        onFocus={(e) => {
          setFocused(true);
          field?.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          field?.onBlur?.(e);
        }}
        value={value}
        onChangeText={onChange}
        accessibilityLabel={unit ? `${label} (${unit})` : label}
        {...(hint ? { accessibilityHint: hint } : {})}
        style={[
          typeStyle(p, mono ? "mono" : big ? "lead" : "body"),
          {
            minHeight: field?.multiline ? 96 : 52, borderRadius: radius.field, borderWidth: 1.5,
            borderColor: invalid ? p.coral : focused ? p.accent : "transparent", paddingLeft: s.lg, paddingRight: unit ? s.x3 + s.lg : s.lg, paddingVertical: s.sm,
            backgroundColor: p.sunken, color: p.text, textAlignVertical: field?.multiline ? "top" : "center",
          },
        ]}
      />
      {unit ? (
        <View style={{ position: "absolute", right: s.lg, bottom: 0, height: 52, justifyContent: "center" }} pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants">
          <T v="small" color="soft">{unit}</T>
        </View>
      ) : null}
    </View>
  );
}

/** A search field: a sunken pill with the search icon, 52 dp, labelled by its placeholder. */
export function SearchField({ label, value, onChange }: { label: string; value: string; onChange(v: string): void }) {
  const p = usePalette();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: s.sm, minHeight: 52, borderRadius: radius.pill, backgroundColor: p.sunken, paddingHorizontal: s.lg }}>
      <Icon name="search" size={20} color={p.textSoft} />
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={label}
        placeholderTextColor={p.textSoft}
        accessibilityLabel={label}
        autoCorrect={false}
        returnKeyType="search"
        style={[typeStyle(p, "body"), { flex: 1, minHeight: 48, color: p.text }]}
      />
    </View>
  );
}

/**
 * The crab's stage: a very soft light behind it, a radial fade from the stage tone to nothing, so there is no edge, only
 * air. Always centered, sized by the moment (large on empty states and onboarding). The fade is the only thing behind
 * the drawing; the crab itself (and its own motion, from the mascot branch) is never changed.
 */
export function Stage({ pose, width = 140, style }: { pose: Pose; width?: number; style?: StyleProp<ViewStyle> }) {
  const p = usePalette();
  const id = useId().replace(/[^A-Za-z0-9]/g, "");
  const glow = Math.round(width * 1.9);
  return (
    <View style={[{ alignItems: "center", justifyContent: "center", alignSelf: "center", width: glow, height: Math.round(width * 1.5) }, style]} accessible={false} importantForAccessibility="no-hide-descendants">
      <Svg width={glow} height={glow} style={{ position: "absolute", top: Math.round(width * 0.75 - glow / 2) }}>
        <Defs>
          <RadialGradient id={`stage${id}`} cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={p.stage} stopOpacity={1} />
            <Stop offset="0.45" stopColor={p.stage} stopOpacity={0.8} />
            <Stop offset="1" stopColor={p.stage} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx={glow / 2} cy={glow / 2} r={glow / 2} fill={`url(#stage${id})`} />
      </Svg>
      <Mascot state={pose} dark={p.dark} width={width} />
    </View>
  );
}

/**
 * ST-EMPTY-FIRST and the closed states (locked, none yet): the crab on its stage, a title, a line, and the one action
 * under them. Quiet mode hides only the crab; the words say the same.
 */
export function Empty({ pose = "idle", title, body, children, live }: { pose?: Pose; title?: string; body?: ReactNode; children?: ReactNode; live?: boolean }) {
  // It takes the room the page leaves and sits a little above its middle (the optical center), not under the title.
  return (
    <View style={{ flexGrow: 1, justifyContent: "center", alignItems: "center", gap: s.md, paddingTop: s.xl, paddingBottom: s.x4 }} accessibilityLiveRegion={live ? "polite" : undefined}>
      <Stage pose={pose} width={112} style={{ marginBottom: s.sm }} />
      {title ? <T v="title" role="header" center>{title}</T> : null}
      {typeof body === "string" ? <T v="body" color="soft" center style={{ maxWidth: 320 }}>{body}</T> : body}
      {children ? <View style={{ alignSelf: "stretch", gap: s.sm, marginTop: s.md }}>{children}</View> : null}
    </View>
  );
}

/** ST-LOAD: a spinner and what is loading, in the layout the content will take; a polite live region. */
export function Loading({ text }: { text: string }) {
  const p = usePalette();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: s.md, paddingVertical: s.lg }} accessibilityLiveRegion="polite">
      <ActivityIndicator size="small" color={p.accent} />
      <T v="body" color="soft" style={{ flex: 1 }}>{text}</T>
    </View>
  );
}

/** ST-ERROR: the cause in words (coral icon, text in the body color for contrast) and one retry. */
export function Failed({ text, onRetry, retryLabel }: { text: string; onRetry?: () => void; retryLabel?: string }) {
  return (
    <View style={{ gap: s.md, paddingVertical: s.md }}>
      <View accessibilityRole="alert"><Note icon="circle-alert" tone="coral" text={text} textColor="text" v="body" /></View>
      {onRetry ? <Btn label={retryLabel ?? t("common.retry")} kind="secondary" icon="refresh-cw" onPress={onRetry} /> : null}
    </View>
  );
}

/** A short result line after an action: a check for done, a coral alert for a failure; a polite live region. */
export function Notice({ text, tone = "ok" }: { text: string; tone?: "ok" | "bad" | "info" }) {
  return (
    <View accessibilityLiveRegion="polite" style={{ paddingVertical: s.xs }}>
      <Note icon={tone === "ok" ? "circle-check" : tone === "bad" ? "circle-alert" : "info"} tone={tone === "bad" ? "coral" : "mark"} text={text} textColor="text" />
    </View>
  );
}

/** A link: a text button in the accent (no underline), in a 48 dp target, dimming while pressed. */
export function LinkText({ label, onPress, icon, a11y, center }: { label: string; onPress?: () => void; icon?: IconName; a11y?: string; center?: boolean }) {
  const p = usePalette();
  return (
    <Pressable onPress={onPress} accessibilityRole="link" accessibilityLabel={a11y ?? label} style={({ pressed }) => ({ minHeight: 48, justifyContent: "center", alignSelf: center ? "center" : "flex-start", opacity: pressed ? 0.6 : 1 })}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        {icon ? <Icon name={icon} size={20} color={p.accent} /> : null}
        <T v="smallStrong" color="link">{label}</T>
      </View>
    </Pressable>
  );
}
