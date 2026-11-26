// HM-ONB-02: choose es-419 or English during setup (US-ONB-02), between the welcome and the download. The phone's
// language is preselected; picking it keeps Hermit following the phone. The screen switches language as soon as a
// choice is saved, so the user reads the rest of setup in it. States: ST-LOAD (choices disabled until the stored
// value is read), ST-IDEAL, save failed (nothing changed, said in coral). Design pass: step 1 of 3, each language
// named in its own language, the phone's marked as such.
import { router } from "expo-router";
import { useState } from "react";
import type { AppLocale } from "@hermit/runtime";
import { ChoiceList } from "../components/ChoiceList";
import { Btn, T } from "../components/kit";
import { Onb } from "../components/Onboarding";
import { setLanguage, useDisplay } from "../display-settings";
import { useHermit } from "../hermit-context";
import { currentLocale, deviceLocale, t } from "../i18n";

export default function Language() {
  const { status } = useHermit();
  const { loaded } = useDisplay();
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const selected = currentLocale();
  const phone = deviceLocale();

  const choose = async (locale: AppLocale) => {
    setSaving(true);
    setFailed(false);
    try {
      // The phone's own language is stored as "follow the phone", so a later change on the phone still carries over.
      await setLanguage(status.kind === "ready" ? status.hermit : undefined, locale === deviceLocale() ? "system" : locale);
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };

  const detail = (l: AppLocale) => (l === phone ? { detail: t("HM-ONB-02.phoneLanguage") } : {});
  return (
    <Onb pose="idle" step={1} title={t("HM-ONB-02.title")} body={t("HM-ONB-02.body")} footer={<Btn label={t("HM-ONB-02.continue")} full disabled={saving} onPress={() => router.push("/download")} />}>
      <ChoiceList<AppLocale>
        choices={[
          { value: "es-419", label: t("common.language.es419"), ...detail("es-419") },
          { value: "en", label: t("common.language.en"), ...detail("en") },
        ]}
        selected={selected}
        disabled={!loaded || saving}
        onChoose={(l) => void choose(l)}
      />
      {failed ? <T v="body" color="coral" live="polite">{t("HM-ONB-02.saveFailed")}</T> : null}
    </Onb>
  );
}
