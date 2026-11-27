// HM-SET-08: About (US-SET-10). The signature with the three logos and the not-affiliated line (PDR-005),
// then the open-source licenses. The tagline, signature and disclaimer are brand lines, verbatim in English
// in every locale (AGENTS.md rule 8, Q53); everything else is copy.
// Design pass: Hermit's mark and the tagline, the three logos in a card with the signature and the disclaimer under
// them, Delete everything in coral outline, and the licenses as a grouped list of links.
import { useRouter } from "expo-router";
import { Image, Linking, Pressable, View } from "react-native";
import { appVersion } from "../adapters/device-lab";
import { Btn, Card, Group, Label, Page, Row, T } from "../components/kit";
import { logos } from "../brand";
import { t } from "../i18n";
import { LICENSES } from "../licenses";
import { SIGNATURE, partners } from "../signature";
import { s } from "../theme";
import { usePalette } from "../use-palette";

export default function About() {
  const p = usePalette();
  const router = useRouter();
  const open = (url: string) => () => void Linking.openURL(url);
  const [dojo, qvac, tether] = partners;
  return (
    <Page title={t("HM-SET-08.title")}>
      <View style={{ gap: s.lg }}>
        {/* Hermit's mark, as drawn (never redrawn), beside the tagline. */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: s.lg }}>
          <Image source={p.dark ? logos.symbolDark : logos.symbolLight} style={{ width: 64, height: 64 }} accessible={false} />
          <T v="title" style={{ flex: 1 }}>{"Does everything.\nTells no one."}</T>
        </View>
        <T v="body" color="soft">{t("HM-SET-08.body")}</T>
        <T v="small" color="soft" selectable>{t("HM-SET-08.version", { version: appVersion() })}</T>

        <Card>
          <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: s.xl }} accessibilityRole="summary">
            <Pressable onPress={open(dojo.url)} accessibilityRole="link" accessibilityLabel={dojo.name} style={{ minHeight: 48, minWidth: 48, alignItems: "center", justifyContent: "center" }}>
              <Image source={logos.dojo} style={{ width: 40, height: 40 }} />
            </Pressable>
            <Pressable onPress={open(qvac.url)} accessibilityRole="link" accessibilityLabel={qvac.name} style={{ minHeight: 48, justifyContent: "center" }}>
              <Image source={logos.qvacMask} style={{ width: 120, height: 13, tintColor: p.logoTint }} />
            </Pressable>
            <Pressable onPress={open(tether.url)} accessibilityRole="link" accessibilityLabel={tether.name} style={{ minHeight: 48, justifyContent: "center" }}>
              <Image source={logos.tetherMask} style={{ width: 69, height: 30, tintColor: p.logoTint }} />
            </Pressable>
          </View>
          <T v="body" style={{ marginTop: s.md }}>{SIGNATURE.line}</T>
          <T v="small" color="soft" style={{ marginTop: s.sm }}>{SIGNATURE.disclaimer}</T>
        </Card>

        {/* HM-SET-03 is also linked here, as it was before the settings screen (HM-SET-01) existed. */}
        <Btn label={t("HM-SET-03.title")} kind="coralOutline" icon="trash-2" onPress={() => router.push("/delete")} />
      </View>

      <Label>{t("HM-SET-08.licensesTitle")}</Label>
      <T v="small" color="soft" style={{ marginBottom: s.sm, paddingHorizontal: s.lg }}>{t("HM-SET-08.trademarks")}</T>
      <Group>
        {LICENSES.map((l) => (
          <Row
            key={l.name}
            title={<T v="small" style={{ fontWeight: "600" }}>{l.name}</T>}
            trailing={<T v="monoSmall" color="soft">{l.license}</T>}
            role="link"
            a11y={t("HM-SET-08.licenseA11y", { name: l.name, license: l.license })}
            onPress={open(l.url)}
          />
        ))}
      </Group>
    </Page>
  );
}
