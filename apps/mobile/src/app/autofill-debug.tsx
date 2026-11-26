// Dev-only: the autofill diagnostics (docs/research/autofill-spike.md, SL-35). Open with hermit://autofill-debug, or
// from Hermit's settings link in Android's autofill picker in a debug build. Shows whether Hermit is the selected
// autofill service, opens the setting, and shows the last fill request: who asked, the kinds of fields found, the
// verdict and how the approval ended (never a value). The fill itself is HM-FORM-01, from the real profile.
// States: module missing (an APK built before the module), not a debug build, not supported, selected or not.
import { useCallback, useEffect, useState } from "react";
import { AppState, Pressable, StyleSheet, Text, View } from "react-native";
import { Page } from "../components/kit";
import { HermitAutofill, type AutofillStatus } from "../../modules/hermit-autofill";
import { t } from "../i18n";
import { radius } from "../theme";
import { usePalette } from "../use-palette";

export default function AutofillDebug() {
  const p = usePalette();
  const [status, setStatus] = useState<AutofillStatus>();
  const [last, setLast] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!__DEV__ || !HermitAutofill) return;
    setStatus(HermitAutofill.status());
    setLast(HermitAutofill.lastRequest());
  }, []);

  useEffect(() => {
    load();
    // Back from Android's settings or from a form in another app: read again.
    const sub = AppState.addEventListener("change", (s) => s === "active" && load());
    return () => sub.remove();
  }, [load]);

  if (!__DEV__) return null;
  if (!HermitAutofill) {
    return (
      <Page title={t("HM-DEV-01.title")}>
        <View style={styles.body}>
          <Text style={[styles.text, { color: p.blocked }]}>{t("HM-DEV-01.unavailable")}</Text>
        </View>
      </Page>
    );
  }

  const stateKey = !status ? undefined : !status.supported ? "HM-DEV-01.notSupported" : status.selected ? "HM-DEV-01.selected" : "HM-DEV-01.notSelected";

  return (
    <Page title={t("HM-DEV-01.title")}>
      <View style={styles.body}>
        <Text style={[styles.text, { color: p.textSoft }]}>{t("HM-DEV-01.intro")}</Text>
        {stateKey ? (
          <Text style={[styles.state, { color: status?.selected ? p.accent : p.blocked }]} accessibilityLiveRegion="polite">{t(stateKey)}</Text>
        ) : null}
        {status && !status.debug ? <Text style={[styles.text, { color: p.blocked }]}>{t("HM-DEV-01.notDebug")}</Text> : null}
        <Pressable onPress={() => { HermitAutofill!.openSettings(); }} accessibilityRole="button" accessibilityLabel={t("HM-DEV-01.open")} style={[styles.button, { backgroundColor: p.accent, borderColor: p.accent }]}>
          <Text style={{ color: p.onAccent, fontWeight: "600" }}>{t("HM-DEV-01.open")}</Text>
        </Pressable>
        <Pressable onPress={load} accessibilityRole="button" accessibilityLabel={t("HM-DEV-01.refresh")} style={[styles.button, { borderColor: p.border }]}>
          <Text style={{ color: p.text, fontWeight: "600" }}>{t("HM-DEV-01.refresh")}</Text>
        </Pressable>

        <Text style={[styles.section, { color: p.text }]} accessibilityRole="header">{t("HM-DEV-01.lastTitle")}</Text>
        <Text style={[styles.mono, { color: p.text }]}>{last ? JSON.stringify(JSON.parse(last), null, 1) : t("HM-DEV-01.none")}</Text>
      </View>
    </Page>
  );
}

const styles = StyleSheet.create({
  body: { padding: 20, gap: 10, paddingBottom: 48 },
  section: { fontSize: 13, fontWeight: "600", marginTop: 16 },
  text: { fontSize: 14, lineHeight: 20 },
  state: { fontSize: 15, fontWeight: "600" },
  mono: { fontSize: 12, fontFamily: "monospace" },
  button: { alignSelf: "flex-start", minHeight: 48, justifyContent: "center", borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 16, paddingVertical: 8 },
});
