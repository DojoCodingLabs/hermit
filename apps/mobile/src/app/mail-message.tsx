// HM-MAIL-03's message view (US-MAIL-03): one email from the last summary or search, read fresh from the provider when
// the user taps it. It is all other people's words and nothing here acts on it: the page's title is Hermit's ("Email"),
// the subject is quoted under it, the sender's name sits next to the bare address, and the body is on the sunken panel
// with the amber line. It never reaches the model from here. States: ST-LOAD while it opens; ST-IDEAL; ST-ERROR per
// problem with retry (sign in again, unreachable, provider error, gone from the inbox); ST-EMPTY-CLEARED when the short
// id is no longer at hand (the cache lives while the app runs).
import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { formatLocalTime } from "@hermit/core";
import type { MailOpened } from "@hermit/mail";
import { displayNameOf, emailOf } from "@hermit/skills";
import { mailService } from "../adapters/mail";
import { Empty, Failed, Field, Loading, Note, Page, T } from "../components/kit";
import { quoted } from "../format";
import { currentLocale, t } from "../i18n";
import { radius, s } from "../theme";
import { usePalette } from "../use-palette";

type Screen = { kind: "loading" } | { kind: "gone" } | { kind: "error"; problem: string } | { kind: "message"; message: MailOpened };
const PROBLEMS = new Set(["sign_in_again", "not_connected", "unreachable", "provider_error", "not_found"]);

export default function MailMessage() {
  const p = usePalette();
  const { ref } = useLocalSearchParams<{ ref?: string }>();
  const mail = mailService();
  const [screen, setScreen] = useState<Screen>({ kind: "loading" });

  const load = useCallback(async () => {
    if (!mail || typeof ref !== "string") return setScreen(mail ? { kind: "gone" } : { kind: "loading" });
    setScreen({ kind: "loading" });
    const r = await mail.open(ref).catch(() => ({ ok: false as const, problem: "unreachable" as const }));
    if (r.ok) return setScreen({ kind: "message", message: r.message });
    setScreen(r.problem === "gone" ? { kind: "gone" } : { kind: "error", problem: PROBLEMS.has(r.problem) ? r.problem : "provider_error" });
  }, [mail, ref]);
  useEffect(() => {
    void load();
  }, [load]);

  const title = t("HM-MAIL-03.messageTitle");
  if (screen.kind === "loading") {
    return (
      <Page title={title}>
        <Loading text={t("HM-MAIL-03.opening")} />
      </Page>
    );
  }
  if (screen.kind === "gone") {
    return (
      <Page title={title}>
        <Empty pose="idle" title={t("HM-MAIL-03.goneTitle")} body={t("HM-MAIL-03.goneBody")} />
      </Page>
    );
  }
  if (screen.kind === "error") {
    return (
      <Page title={title}>
        <Failed text={t(`HM-MAIL-03.error.${screen.problem}`)} onRetry={() => void load()} />
      </Page>
    );
  }

  const m = screen.message;
  const address = emailOf(m.from) ?? "";
  const name = displayNameOf(m.from);
  return (
    <Page title={title}>
      <View style={{ gap: s.xs, paddingHorizontal: s.lg }}>
        <T v="bodyStrong" selectable>{m.subject.trim() ? quoted(m.subject) : t("HM-MAIL-03.noSubject")}</T>
        <T v="footnote" color="soft">{formatLocalTime(m.at, currentLocale(), Intl.DateTimeFormat().resolvedOptions().timeZone)}</T>
      </View>
      <View style={{ paddingHorizontal: s.lg, marginTop: s.md }}>
        <Field label={t("HM-MAIL-03.from")}>
          {name ? <T v="body">{name}</T> : null}
          {/* The whole address, never cut: it is what tells a sender from a look-alike. */}
          <T v="mono" selectable>{address || m.from}</T>
        </Field>
        {m.to.length ? <Field label={t("HM-MAIL-03.to")} value={m.to.join(", ")} /> : null}
        {m.cc.length ? <Field label={t("HM-MAIL-03.cc")} value={m.cc.join(", ")} /> : null}
        <T v="footnote" color="soft" style={{ marginTop: s.xs }}>{t("HM-MAIL-03.arrived", { account: m.account })}</T>
      </View>
      <View style={{ paddingHorizontal: s.lg, marginTop: s.lg, marginBottom: s.md }}>
        <Note icon="shield-alert" tone="amber" text={t("HM-MAIL-02.untrusted")} />
      </View>
      {m.cut ? <T v="footnote" color="soft" style={{ paddingHorizontal: s.lg, marginBottom: s.sm }}>{t("HM-MAIL-03.cut")}</T> : null}
      <View style={{ backgroundColor: p.sunken, borderRadius: radius.field, padding: s.lg }}>
        <T v="small" selectable>{m.text}</T>
      </View>
    </Page>
  );
}
