// HM-SET-01: settings (US-SET-01) and the app lock (US-SET-09). Design pass (S1): a few groups by what the user wants,
// a line icon and a status per row. The permissions list (US-ONB-08) moved to HM-SET-09, "What Hermit can use" (Q147),
// one row away; its states are unchanged there.
// The lock switch is ST-DISABLED with the reason when the phone has no screen lock.
// HM-SET-05 (US-SET-05, US-ONB-02) is the Language group: the phone's language or an override, applied at once;
// ST-LOAD (choices disabled until the stored value is read); save failed (nothing changed).
import { useFocusEffect, useRouter, type Href } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import type { LanguageChoice } from "@hermit/runtime";
import { phoneSecurity } from "../adapters";
import { mailService } from "../adapters/mail";
import { useAppLock } from "../app-lock";
import { ChoiceList } from "../components/ChoiceList";
import type { IconName } from "../components/Icon";
import { Btn, Group, Label, Note, Page, Row, T, Toggle } from "../components/kit";
import { setLanguage, useDisplay } from "../display-settings";
import { useHermit } from "../hermit-context";
import { deviceLocale, t, tCount } from "../i18n";
import { s } from "../theme";

const THEME_WORD = { system: "HM-SET-07.themeAuto", light: "HM-SET-07.themeLight", dark: "HM-SET-07.themeDark" } as const;

export default function Settings() {
  const router = useRouter();
  const { theme } = useDisplay();
  // The email row says how many accounts are connected, the way Android's own settings say a row's value.
  const [mailCount, setMailCount] = useState<number>();
  useFocusEffect(useCallback(() => {
    void mailService()?.view().then((v) => setMailCount(v.rows.length), () => setMailCount(undefined));
  }, []));
  const link = (icon: IconName, titleKey: string, href: Href, sub?: string) => (
    <Row icon={icon} title={t(titleKey)} {...(sub ? { sub } : {})} chevron role="link" onPress={() => router.push(href)} />
  );
  return (
    <Page title={t("HM-SET-01.title")}>
      <Label style={{ marginTop: 0 }}>{t("HM-SET-01.group.hermit")}</Label>
      <Group>
        {/* A row says its current value, the way Android's own settings do. */}
        {link("palette", "HM-SET-06.title", "/appearance", t(THEME_WORD[theme]))}
        <LockRow />
      </Group>

      <LanguageSection />

      <Label>{t("HM-SET-01.group.use")}</Label>
      <Group>
        {link("plug", "HM-SET-09.title", "/use", t("HM-SET-09.rowSub"))}
        {/* SL-48: HM-MAIL-01, the email accounts, with how many are connected. */}
        {link("mail", "HM-MAIL-01.title", "/mail", mailCount === undefined ? undefined : mailCount ? tCount("HM-SET-01.mailCount", mailCount) : t("HM-SET-01.mailNone"))}
        {/* SL-53: HM-WEB-02, the saved web tasks, recording a new one and the sites kept signed in. */}
        {link("globe", "HM-SET-01.webTasks", "/browser")}
        {link("key-round", "HM-VAULT-01.title", "/vault")}
        {/* SL-55: HM-CONN-04, connect a service by name, docs link or pasted docs. */}
        {link("link", "HM-CONN-04.title", "/connect")}
        {link("server", "HM-CONN-03.title", "/mcp")}
        {/* SL-57: HM-CONN-05, the user's own relay and Dojo's opt-in relay for services that need a client secret. */}
        {link("log-in", "HM-CONN-05.title", "/sign-in-options")}
      </Group>

      <Label>{t("HM-SET-01.group.money")}</Label>
      <Group>
        {link("wallet", "HM-PAY-01.title", "/wallet")}
        {/* SL-37: the Keystore key that signs payments and passwords, and setting it up again after a fingerprint change. */}
        {link("fingerprint", "HM-APPR-01.key.title", "/approval-key")}
      </Group>

      <Label>{t("HM-SET-01.group.record")}</Label>
      <Group>
        {link("bookmark", "HM-MEM-01.title", "/memories")}
        {link("shield-check", "HM-ACT-01.title", "/activity")}
      </Group>

      <Label>{t("HM-SET-01.more")}</Label>
      <Group>
        {link("shield", "HM-SET-02.title", "/privacy")}
        {link("smartphone", "HM-CHAT-02.title", "/where")}
        {/* HM-SET-10: the Device lab, an offline benchmark whose report the person may share. */}
        {link("list-checks", "HM-SET-10.title", "/device-lab", t("HM-SET-10.rowSub"))}
        {link("info", "HM-SET-08.title", "/about")}
      </Group>

      <View style={{ marginTop: s.xl }}>
        <Btn label={t("HM-SET-03.title")} kind="coralOutline" icon="trash-2" full onPress={() => router.push("/delete")} />
      </View>
    </Page>
  );
}

const LANGUAGE_NAME = { "es-419": "common.language.es419", en: "common.language.en" } as const;

function LanguageSection() {
  const { status } = useHermit();
  const { language, loaded } = useDisplay();
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  const choose = async (choice: LanguageChoice) => {
    if (choice === language) return;
    setSaving(true);
    setFailed(false);
    try {
      await setLanguage(status.kind === "ready" ? status.hermit : undefined, choice);
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Label>{t("HM-SET-05.title")}</Label>
      <T v="small" color="soft" style={{ marginBottom: s.sm, paddingHorizontal: s.lg }}>{t("HM-SET-05.body")}</T>
      <ChoiceList<LanguageChoice>
        choices={[
          { value: "system", label: t("HM-SET-05.system"), detail: t("HM-SET-05.systemDetail", { language: t(LANGUAGE_NAME[deviceLocale()]) }) },
          { value: "es-419", label: t(LANGUAGE_NAME["es-419"]) },
          { value: "en", label: t(LANGUAGE_NAME.en) },
        ]}
        selected={language}
        disabled={!loaded || saving}
        onChoose={(c) => void choose(c)}
      />
      {failed ? <T v="small" color="coral" live="polite">{t("HM-SET-05.saveFailed")}</T> : null}
    </>
  );
}

function LockRow() {
  const { lock, setLockOn } = useAppLock();
  const [security, setSecurity] = useState<"biometric" | "device" | "none">();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<"failed" | "no_security">();
  useEffect(() => {
    void phoneSecurity().then(setSecurity, () => setSecurity("none"));
  }, []);
  const cannot = security === "none" && !lock.enabled;

  const toggle = async (on: boolean) => {
    setBusy(true);
    setNote(undefined);
    try {
      const r = await setLockOn(on);
      if (r !== "ok") setNote(r);
    } catch {
      setNote("failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Row
      icon="lock"
      title={t("HM-SET-01.lock")}
      top
      sub={
        <View style={{ gap: 2 }}>
          <T v="small" color="soft">{t("HM-SET-01.lockBody")}</T>
          {cannot || note === "no_security" ? <T v="small" color="soft">{t("HM-SET-01.lockNoBiometric")}</T> : null}
          {note === "failed" ? <View accessibilityLiveRegion="polite"><Note icon="circle-alert" tone="coral" text={t("HM-SET-01.lockFailed")} textColor="text" /></View> : null}
        </View>
      }
      trailing={<Toggle on={lock.enabled} label={t("HM-SET-01.lock")} disabled={busy || cannot || security === undefined} onChange={(on) => void toggle(on)} />}
    />
  );
}
