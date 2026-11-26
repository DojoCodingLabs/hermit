// HM-SET-06: appearance and quiet mode (US-SET-06, US-CHAT-08). One switch, stored in ENT-Setting
// `appearance.quiet`. Quiet mode hides the crab everywhere and turns off motion; the text beside it stays.
// The phone's "remove animations" setting turns off motion on its own and the screen says so.
// States: ST-LOAD (switch disabled until the setting is read), ST-IDEAL, save failed (nothing changed).
// HM-SET-07 (US-SET-08) is the Display section below: dark mode (same as the phone by default, or pinned light or
// dark, ENT-Setting `appearance.theme`) and the phone's text size with a preview. Hermit has no text size of its
// own: it follows the phone's, and says when it is past the 200% the layouts are built for.
// Design pass: Quiet mode as a switch row, the preview as the chat header's marker beside the crab, the scheme as
// grouped radio rows, the text size in words with a reply bubble in Hermit's colors and the phone's display settings.
import { useState } from "react";
import { Linking, View, useWindowDimensions } from "react-native";
import { textScale, type ThemeChoice } from "@hermit/runtime";
import { setQuiet, useAppearance } from "../appearance";
import { Btn, Card, Dot, Group, Label, Note as NoteLine, Notice, Page, Row, Segmented, T, Toggle } from "../components/kit";
import { Mascot } from "../components/Mascot";
import { setTheme, useDisplay } from "../display-settings";
import { useHermit } from "../hermit-context";
import { t } from "../i18n";
import { radius, s } from "../theme";
import { usePalette } from "../use-palette";

/** The scheme choices in the segmented control's order. */
const THEMES: ThemeChoice[] = ["system", "light", "dark"];

export default function AppearanceScreen() {
  const p = usePalette();
  const { status } = useHermit();
  const look = useAppearance();
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const ready = status.kind === "ready" && !saving;

  const toggle = async (on: boolean) => {
    if (status.kind !== "ready") return;
    setSaving(true);
    setFailed(false);
    try {
      await setQuiet(status.hermit, on);
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Page title={t("HM-SET-06.title")}>
      <Group>
        <Row
          icon="moon"
          top
          title={t("HM-SET-06.quiet")}
          sub={t("HM-SET-06.quietBody")}
          trailing={<Toggle on={look.quiet} label={t("HM-SET-06.quiet")} disabled={!ready} onChange={(on) => void toggle(on)} />}
        />
      </Group>
      <View style={{ marginTop: s.sm, gap: s.xs }}>
        {failed ? <Notice tone="bad" text={t("HM-SET-06.saveFailed")} /> : null}
        {look.systemReduceMotion && !look.quiet ? <Notice tone="info" text={t("HM-SET-06.systemMotion")} /> : null}
      </View>

      {/* What the chat header looks like with this choice: the crab, or the text alone. */}
      <Label>{t("HM-SET-06.preview")}</Label>
      <Card style={{ flexDirection: "row", alignItems: "center", gap: s.md, minHeight: 72 }}>
        <Mascot state="idle" dark={p.dark} width={56} />
        <Dot />
        <T v="smallStrong" color="soft" style={{ flexShrink: 1 }}>{t("HM-CHAT-02.onPhone")}</T>
      </Card>

      <DisplaySection />
    </Page>
  );
}

/** Android's display settings, where the phone's text size lives; the app's own settings page if that fails. */
function openDisplaySettings() {
  Linking.sendIntent("android.settings.DISPLAY_SETTINGS").catch(() => Linking.openSettings().catch(() => {}));
}

function DisplaySection() {
  const p = usePalette();
  const { status } = useHermit();
  const { theme, loaded } = useDisplay();
  const { fontScale } = useWindowDimensions();
  const scale = textScale(fontScale);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  const choose = async (choice: ThemeChoice) => {
    if (choice === theme) return;
    setSaving(true);
    setFailed(false);
    try {
      await setTheme(status.kind === "ready" ? status.hermit : undefined, choice);
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <T v="title" role="header" style={{ marginTop: s.xxl }}>{t("HM-SET-07.title")}</T>
      <Label style={{ marginTop: s.md }}>{t("HM-SET-07.theme")}</Label>
      {/* Polish round: three short options are a segmented control, not radio cards; the system's detail sits under it. */}
      <Segmented
        options={[t("HM-SET-07.themeAuto"), t("HM-SET-07.themeLight"), t("HM-SET-07.themeDark")]}
        value={THEMES.indexOf(theme)}
        label={t("HM-SET-07.theme")}
        inactive={!loaded || saving}
        onChange={(i) => void choose(THEMES[i]!)}
      />
      {theme === "system" ? <T v="footnote" color="soft" style={{ marginTop: s.sm, paddingHorizontal: s.lg }}>{t("HM-SET-07.themeSystemDetail")}</T> : null}
      {failed ? <Notice tone="bad" text={t("HM-SET-07.saveFailed")} /> : null}

      <Label>{t("HM-SET-07.textSize")}</Label>
      <View style={{ gap: s.sm }}>
        <NoteLine icon="type" text={t("HM-SET-07.textSizeBody", { percent: scale.percent })} textColor="text" />
        {scale.overLimit ? <NoteLine icon="triangle-alert" tone="amber" text={t("HM-SET-07.textSizeOver")} /> : null}
        {/* A reply bubble at the phone's text size, in Hermit's bubble colors (Q146) and the scheme in use. */}
        <Card>
          <View style={{ gap: s.sm }} accessible accessibilityLabel={`${t("HM-SET-07.preview")}: ${t("HM-SET-07.previewText")}`}>
            <T v="caption" color="soft">{t("HM-SET-07.preview")}</T>
            {/* Drawn like the chat's own bubble: radius 20 with the 6 dp tail corner, no outline. */}
            <View style={{ alignSelf: "flex-start", maxWidth: "80%", backgroundColor: p.hermitBubble, borderRadius: radius.bubble, borderBottomLeftRadius: 6, paddingHorizontal: s.lg, paddingTop: 10, paddingBottom: 11 }}>
              <T v="body" color={p.hermitText}>{t("HM-SET-07.previewText")}</T>
            </View>
          </View>
        </Card>
        <Btn label={t("HM-SET-07.openDisplay")} kind="secondary" icon="settings" onPress={openDisplaySettings} />
      </View>
    </>
  );
}
