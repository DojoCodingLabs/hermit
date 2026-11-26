// HM-BOT-04: the mode picker and its two warnings. Ask is the default and asks nothing; going up to Auto opens a plain
// sheet that says what will now run without asking; going up to Don't ask opens a red one with the concrete risks, and
// its Confirm waits for the typed word ("entiendo" / "I understand"). The fingerprint is asked by the runtime when the
// mode is saved (modes.setGlobal, modes.setBot, bots.create), so this sheet only says so. Going down asks nothing.
// Every word here is code's; nothing a model wrote reaches a sheet. `current` is the mode shown as chosen (null is "Como
// el resto"). The warning follows the runtime's own-mode rule (Task 18): it compares the mode chosen with `from`, the
// bot's own saved mode (`current` unless given; null for a new bot, which has nothing before), so an own Don't ask
// always takes the red sheet and the word, also under a global Don't ask, and going back to "Como el resto" asks
// nothing. `global` is what "Como el resto" means now, for its line only.
import { useEffect, useState } from "react";
import { View } from "react-native";
import type { PermissionMode } from "@hermit/core";
import { AUTO_SHEET_KEYS, DONT_ASK_SHEET_KEYS, canConfirmDontAsk, modeStep } from "../mode-view";
import { t } from "../i18n";
import { s } from "../theme";
import { MODE_WORDS, modeName } from "./BotFormParts";
import type { IconName } from "./Icon";
import { Btn, Card, Group, Input, Note, Radio, T } from "./kit";
import { SheetModal } from "./Sheet";

type Step = { kind: "pick" } | { kind: "auto"; to: PermissionMode | null } | { kind: "dont_ask"; to: PermissionMode | null };

const AUTO_ICONS: Record<(typeof AUTO_SHEET_KEYS)[number], IconName> = {
  "HM-BOT-04.autoSheet.runs": "check",
  "HM-BOT-04.autoSheet.links": "link",
  "HM-BOT-04.autoSheet.query": "search",
  "HM-BOT-04.autoSheet.mail": "mail",
  "HM-BOT-04.autoSheet.composed": "shield",
  "HM-BOT-04.autoSheet.asks": "shield",
  "HM-BOT-04.autoSheet.alone": "eye",
  "HM-BOT-04.autoSheet.money": "fingerprint",
};

export function ModeSheet({ open, current, from = current, global, allowInherit, onConfirm, onClose }: {
  open: boolean; current: PermissionMode | null; from?: PermissionMode | null; global: PermissionMode; allowInherit: boolean;
  onConfirm(mode: PermissionMode | null, typed?: string): void; onClose(): void;
}) {
  const [step, setStep] = useState<Step>({ kind: "pick" });
  const [typed, setTyped] = useState("");
  useEffect(() => {
    if (open) {
      setStep({ kind: "pick" });
      setTyped("");
    }
  }, [open]);

  const choose = (to: PermissionMode | null) => {
    const next = modeStep(from, to);
    if (next === "auto_sheet") return setStep({ kind: "auto", to });
    if (next === "dont_ask_sheet") return setStep({ kind: "dont_ask", to });
    onConfirm(to);
    onClose();
  };
  const cancel = <Btn label={t("common.cancel")} kind="text" full onPress={onClose} />;

  if (step.kind === "auto") {
    // The reassurance that matters most comes first, so it shows without scrolling.
    const [money, ...rest] = AUTO_SHEET_KEYS;
    return (
      <SheetModal
        visible={open}
        onClose={onClose}
        closeLabel={t("common.cancel")}
        footer={
          <>
            <Btn label={t("HM-BOT-04.autoSheet.confirm")} kind="amber" icon="check" full onPress={() => { onConfirm(step.to); onClose(); }} />
            {cancel}
          </>
        }
      >
        <T v="title" role="header" style={{ marginBottom: s.sm }}>{t("HM-BOT-04.autoSheet.title")}</T>
        <View style={{ marginBottom: s.lg }}>
          <Note icon="fingerprint" tone="amber" textColor="text" v="body" text={t(money)} />
        </View>
        <T v="body" color="soft" style={{ marginBottom: s.lg }}>{t("HM-BOT-04.autoSheet.intro")}</T>
        <View style={{ gap: s.md }}>
          {rest.map((key) => <Note key={key} icon={AUTO_ICONS[key]} tone="amber" textColor="text" v="body" text={t(key)} />)}
        </View>
      </SheetModal>
    );
  }

  if (step.kind === "dont_ask") {
    const [risk, ...points] = DONT_ASK_SHEET_KEYS.filter((k) => k !== "HM-BOT-04.dontAskSheet.typeWord" && k !== "HM-BOT-04.dontAskSheet.proof");
    return (
      <SheetModal
        visible={open}
        onClose={onClose}
        closeLabel={t("common.cancel")}
        footer={
          <>
            <Btn label={t("HM-BOT-04.dontAskSheet.confirm")} kind="coral" icon="triangle-alert" full disabled={!canConfirmDontAsk(typed)} onPress={() => { onConfirm(step.to, typed.trim()); onClose(); }} />
            {cancel}
          </>
        }
      >
        <T v="title" role="header" style={{ marginBottom: s.sm }}>{t("HM-BOT-04.dontAskSheet.title")}</T>
        <T v="body" color="soft" style={{ marginBottom: s.lg }}>{t("HM-BOT-04.dontAskSheet.intro")}</T>
        <View style={{ gap: s.md }}>
          <Card tone="coral">
            <Note icon="triangle-alert" tone="coral" textColor="text" v="body" text={t(risk!)} />
          </Card>
          {points.map((key) => <Note key={key} icon={key.endsWith("money") ? "fingerprint" : "triangle-alert"} tone="coral" textColor="text" v="body" text={t(key)} />)}
          <Note icon="fingerprint" tone="coral" textColor="text" v="body" text={t("HM-BOT-04.dontAskSheet.proof")} />
          <Input
            label={t("HM-BOT-04.dontAskSheet.typeWord")}
            value={typed}
            onChange={setTyped}
            invalid={false}
            field={{ autoCapitalize: "none", autoCorrect: false, autoComplete: "off", spellCheck: false }}
          />
        </View>
      </SheetModal>
    );
  }

  return (
    <SheetModal visible={open} onClose={onClose} dismissable closeLabel={t("common.close")}>
      <T v="title" role="header" style={{ marginBottom: s.lg }}>{t("HM-BOT-03.modePick")}</T>
      <Group>
        {allowInherit ? <Radio label={t("HM-BOT-03.modeInherit")} sub={t("HM-BOT-03.modeInheritSub", { mode: modeName(global) })} on={current === null} onPress={() => choose(null)} /> : null}
        {(["ask", "auto", "dont_ask"] as const).map((m) => (
          <Radio key={m} label={modeName(m)} sub={t(MODE_WORDS[m].sub)} on={current === m} onPress={() => choose(m)} />
        ))}
      </Group>
    </SheetModal>
  );
}
