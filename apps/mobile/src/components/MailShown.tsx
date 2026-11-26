// HM-MAIL-02 (the messages a summary used) and HM-MAIL-03 (search results), from what the app's mail cache recorded
// for the last mail_list or mail_search, never from the model's answer (mailShownView in @hermit/mail). Everything on a
// row is other people's words: the sender's name as the email gives it with the bare address under it (a name can
// claim to be anyone), the subject in quotes, the unread mark in Hermit's words. One amber line says it is never
// followed as instructions. A row opens the message view, read fresh from the provider. States: ST-LOAD until the
// runtime is up, ST-IDEAL, ST-EMPTY-CLEARED (the last summary or search used none).
import { useRouter } from "expo-router";
import { Pressable, View } from "react-native";
import { displayNameOf, emailOf } from "@hermit/skills";
import { mailService } from "../adapters/mail";
import { quoted, when } from "../format";
import { currentLocale, t } from "../i18n";
import { s } from "../theme";
import { usePalette } from "../use-palette";
import { Icon } from "./Icon";
import { Avatar, Empty, Loading, Note, Page, T, TitleLine } from "./kit";

export function MailShown({ screen }: { screen: "HM-MAIL-02" | "HM-MAIL-03" }) {
  const router = useRouter();
  const p = usePalette();
  const mail = mailService();
  const locale = currentLocale();
  const title = t(`${screen}.title`);
  if (!mail) {
    return (
      <Page title={title}>
        <Loading text={t("common.loading")} />
      </Page>
    );
  }
  const view = mail.shown(screen, locale);
  const now = Date.now();
  return (
    <Page
      title={title}
      list={{
        data: view.rows,
        keyOf: (r) => r.ref,
        lead: "avatar",
        row: (r) => {
          const address = emailOf(r.from) ?? "";
          const who = displayNameOf(r.from) ?? (address || r.from);
          const subject = r.subject.trim() ? quoted(r.subject) : t("HM-MAIL-03.noSubject");
          const at = when(r.at, now, locale);
          return (
            <Pressable
              onPress={() => router.push({ pathname: "/mail-message", params: { ref: r.ref } })}
              accessibilityRole="button"
              accessibilityLabel={`${t("HM-MAIL-03.openA11y", { who, subject: r.subject.trim() || t("HM-MAIL-03.noSubject") })}, ${t(at.key, at.vars)}${r.unread ? `, ${t("HM-MAIL-02.unread")}` : ""}`}
              style={({ pressed }) => ({ flexDirection: "row", gap: s.md, paddingVertical: s.md, paddingHorizontal: s.lg, backgroundColor: pressed ? p.pressed : "transparent" })}
            >
              <Avatar name={who} tone="plain" />
              <View style={{ flex: 1, gap: 2 }}>
                <TitleLine title={who} lines={1} aside={t(at.key, at.vars)} />
                {address && address !== who ? <T v="footnote" color="soft" lines={1}>{address}</T> : null}
                <T v="small" color="soft" lines={2}>{subject}</T>
                {r.unread ? <T v="footnoteStrong" color="link">{t("HM-MAIL-02.unread")}</T> : null}
              </View>
              <View style={{ justifyContent: "center" }}><Icon name="chevron-right" size={20} color={p.textSoft} /></View>
            </Pressable>
          );
        },
        top: view.rows.length ? <View style={{ paddingHorizontal: s.lg, marginBottom: s.lg }}><Note icon="shield-alert" tone="amber" text={t(view.untrustedKey)} /></View> : undefined,
        empty: <Empty pose="idle" title={t(`${screen}.emptyTitle`)} body={t(view.emptyKey ?? `${screen}.empty`)} />,
      }}
    />
  );
}
