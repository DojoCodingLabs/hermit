// HM-BOT-03 and HM-BOT-04 share their fields: the look picker, the permissions in plain words, the sources, the mode
// choice and the confirmation sheet for what can't be undone. Every label here is code's copy; nothing a model wrote
// is presented as the app's words.
import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { FINGERPRINT_GROUPS, SHELL_COLORS, SHELL_SHAPES, type BotLook, type PermissionMode, type SkillGroup } from "@hermit/core";
import { refusalLine, shownGroups } from "../bot-form-view";
import { useHermit } from "../hermit-context";
import { t } from "../i18n";
import { SHELL_FILL } from "../shells";
import { radius, s } from "../theme";
import { usePalette } from "../use-palette";
import { BotAvatar } from "./BotAvatar";
import { Icon } from "./Icon";
import { Btn, Chip, Group, Row, T, Toggle } from "./kit";
import { SheetModal } from "./Sheet";

/** The six shells, then the four colors: each a 48 dp radio, the chosen one ringed. */
export function LookPicker({ look, onChange }: { look: BotLook; onChange(next: BotLook): void }) {
  const p = usePalette();
  const theme = p.dark ? "dark" : "light";
  return (
    <View style={{ gap: s.lg }}>
      <View accessibilityRole="radiogroup" accessibilityLabel={t("HM-BOT-03.shape")} style={{ flexDirection: "row", flexWrap: "wrap", gap: s.sm }}>
        {SHELL_SHAPES.map((shape) => {
          const on = look.shape === shape;
          return (
            <Pressable
              key={shape}
              onPress={() => onChange({ ...look, shape })}
              accessibilityRole="radio"
              accessibilityLabel={t(`HM-BOT-03.shape.${shape}`)}
              accessibilityState={{ checked: on }}
              style={{ width: 52, height: 52, borderRadius: radius.field, alignItems: "center", justifyContent: "center", backgroundColor: on ? p.accentTint : p.sunken, borderWidth: 2, borderColor: on ? p.accent : "transparent" }}
            >
              <BotAvatar bot={{ primary: false, look: { shape, color: look.color }, name: t(`HM-BOT-03.shape.${shape}`) }} size={36} dark={p.dark} />
            </Pressable>
          );
        })}
      </View>
      <View accessibilityRole="radiogroup" accessibilityLabel={t("HM-BOT-03.color")} style={{ flexDirection: "row", flexWrap: "wrap", gap: s.sm }}>
        {SHELL_COLORS.map((color) => {
          const on = look.color === color;
          return (
            <Pressable
              key={color}
              onPress={() => onChange({ ...look, color })}
              accessibilityRole="radio"
              accessibilityLabel={t(`HM-BOT-03.color.${color}`)}
              accessibilityState={{ checked: on }}
              style={{ width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: on ? p.accent : "transparent" }}
            >
              <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: SHELL_FILL[color][theme] }} />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** The groups in plain words, each with its switch; the ones that ask for the fingerprint to grant say so. */
export function GroupsList({ grants, onChange }: { grants: SkillGroup[]; onChange(next: SkillGroup[]): void }) {
  const flip = (g: SkillGroup, on: boolean) => onChange(on ? [...grants, g] : grants.filter((x) => x !== g));
  return (
    <Group>
      {shownGroups().map((g) => (
        <Row
          key={g}
          title={<T v="bodyStrong">{t(`HM-BOT-04.group.${g}`)}</T>}
          {...(FINGERPRINT_GROUPS.includes(g) ? { sub: <Chip label={t("HM-BOT-03.needsFingerprint")} tone="amber" /> } : {})}
          trailing={<Toggle on={grants.includes(g)} label={t(`HM-BOT-04.group.${g}`)} onChange={(on) => flip(g, on)} />}
        />
      ))}
    </Group>
  );
}

export interface SourceChoice { id: string; label: string }

/** The connectors and MCP servers the user installed, to tick as a bot's sources. */
export function useSourceChoices(): SourceChoice[] {
  const { status } = useHermit();
  const [choices, setChoices] = useState<SourceChoice[]>([]);
  useEffect(() => {
    if (status.kind !== "ready") return;
    const { hermit } = status;
    let alive = true;
    void Promise.all([hermit.connect?.list() ?? [], hermit.mcp?.list() ?? []])
      .then(([connectors, servers]) => {
        if (alive) setChoices([...connectors.map((c) => ({ id: c.id, label: c.name })), ...servers.map((m) => ({ id: m.id, label: m.host }))]);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [status]);
  return choices;
}

export function ConnectorsList({ choices, on, onChange }: { choices: SourceChoice[]; on: string[]; onChange(next: string[]): void }) {
  if (!choices.length) return <T v="small" color="soft" style={{ paddingHorizontal: s.lg }}>{t("HM-BOT-03.connectorsNone")}</T>;
  return (
    <Group>
      {choices.map((c) => (
        <Row key={c.id} title={c.label} trailing={<Toggle on={on.includes(c.id)} label={c.label} onChange={(next) => onChange(next ? [...on, c.id] : on.filter((x) => x !== c.id))} />} />
      ))}
    </Group>
  );
}

export const MODE_WORDS: Record<PermissionMode, { name: string; sub: string }> = {
  ask: { name: "HM-BOT-03.modeAsk", sub: "HM-BOT-03.modeAskSub" },
  auto: { name: "HM-BOT-03.modeAuto", sub: "HM-BOT-03.modeAutoSub" },
  dont_ask: { name: "HM-BOT-03.modeDontAsk", sub: "HM-BOT-03.modeDontAskSub" },
};
export const modeName = (mode: PermissionMode) => t(MODE_WORDS[mode].name);

/** The mode a row shows: its own, or "Como el resto" with what that is now. */
export const modeLine = (mode: PermissionMode | null, globalMode: PermissionMode) =>
  mode ? { title: modeName(mode), sub: t(MODE_WORDS[mode].sub) } : { title: t("HM-BOT-03.modeInherit"), sub: t("HM-BOT-03.modeInheritSub", { mode: modeName(globalMode) }) };

/** What can't be undone asks first, in code's words: a title, a body, and the one coral action. */
export function ConfirmSheet({ visible, title, body, confirm, busy, onConfirm, onClose }: {
  visible: boolean; title: string; body: string; confirm: string; busy?: boolean; onConfirm(): void; onClose(): void;
}) {
  return (
    <SheetModal
      visible={visible}
      onClose={onClose}
      dismissable
      closeLabel={t("common.cancel")}
      footer={
        <>
          <Btn label={confirm} kind="coral" icon="trash-2" full busy={!!busy} onPress={onConfirm} />
          <Btn label={t("common.cancel")} kind="text" full onPress={onClose} />
        </>
      }
    >
      <T v="title" role="header" style={{ marginBottom: s.md }}>{title}</T>
      <T v="body" color="soft">{body}</T>
    </SheetModal>
  );
}

/** A refusal in code's words, about the bot named `name` (refusalLine): a busy bot is the one named; `failed` says so. */
export function Refusal({ reason, name }: { reason: string; name: string }) {
  const p = usePalette();
  const line = refusalLine(reason, name);
  return (
    <View accessibilityRole="alert" accessibilityLiveRegion="polite" style={{ flexDirection: "row", gap: s.sm, alignItems: "flex-start" }}>
      <Icon name="circle-alert" size={20} color={p.coral} />
      <T v="small" style={{ flex: 1 }}>{t(line.key, line.vars)}</T>
    </View>
  );
}
