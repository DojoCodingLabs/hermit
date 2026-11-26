// HM-WEB-01: the page reader (US-WEB-01). Shows the text an answer used, exactly as the quarantined reader got it,
// with the page's address and the phrases the answer quoted. The text is the site's, so it is marked untrusted and
// nothing here can act on it. States: ST-IDEAL, ST-ERROR (the page is gone: pages live only while the app runs).
// Polish round: the app's own page (large title in Hermit's words, never the site's), then the site's title in quotes
// with its whole address, the amber "written by the site" line, Hermit's answer on a raised card, the quoted phrases,
// and the page text on a sunken panel: everything the site wrote is quoted or sits on that panel, never a heading.
import { useLocalSearchParams } from "expo-router";
import { View } from "react-native";
import { Card, Empty, Label, Note, Page, T } from "../components/kit";
import { quoted } from "../format";
import { useHermit } from "../hermit-context";
import { t } from "../i18n";
import { radius, s } from "../theme";
import { usePalette } from "../use-palette";

export default function PageReader() {
  const p = usePalette();
  const { status } = useHermit();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const page = status.kind === "ready" && id ? status.hermit.page(String(id)) : undefined;

  if (!page) {
    return (
      <Page title={t("HM-WEB-01.title")}>
        <Empty pose="idle" title={t("HM-WEB-01.goneTitle")} body={t("HM-WEB-01.goneBody")} />
      </Page>
    );
  }

  return (
    <Page title={t("HM-WEB-01.title")}>
      <View style={{ gap: s.xs, paddingHorizontal: s.lg }}>
        <T v="bodyStrong">{quoted(page.title)}</T>
        <T v="footnote" color="soft">{page.domain}</T>
        {/* The whole address, never cut: it is what tells one site from a look-alike. */}
        <T v="monoSmall" color="soft" selectable>{page.url}</T>
      </View>
      <View style={{ paddingHorizontal: s.lg, marginTop: s.lg }}>
        <Note icon="shield-alert" tone="amber" text={t("HM-WEB-01.untrusted")} />
      </View>

      {page.answer ? (
        <>
          <Label>{t("HM-WEB-01.answerLabel")}</Label>
          <Card>
            <T v="body" selectable>{page.answer}</T>
          </Card>
        </>
      ) : null}

      {page.quotes.length ? (
        <>
          <Label>{t("HM-WEB-01.quotes")}</Label>
          <View style={{ gap: s.md, paddingHorizontal: s.lg }}>
            {page.quotes.map((q) => (
              <T key={q} v="quote" selectable>{quoted(q)}</T>
            ))}
          </View>
        </>
      ) : null}

      <Label>{t("HM-WEB-01.text")}</Label>
      {page.truncated || page.cut ? (
        <View style={{ gap: s.xs, paddingHorizontal: s.lg, marginBottom: s.md }}>
          {page.truncated ? <T v="footnote" color="soft">{t("HM-WEB-01.truncated")}</T> : null}
          {page.cut ? <T v="footnote" color="soft">{t("HM-WEB-01.cut")}</T> : null}
        </View>
      ) : null}
      <View style={{ backgroundColor: p.sunken, borderRadius: radius.field, padding: s.lg }}>
        <T v="small" selectable>{page.text}</T>
      </View>
    </Page>
  );
}
