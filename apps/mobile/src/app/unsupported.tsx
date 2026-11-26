// HM-ONB-05: the phone is below the floor (US-ONB-06, NFR-05, PDR-025). Shown before any download; the reasons
// in plain words, what still works, and, when the only reasons are about speed, a download with its warning.
// The rules live in @hermit/model (floorCheck, floorView); this screen only renders them.
// Design pass: the onboarding scaffold with the crab, each reason as its own line in a card, what still works with a
// check, the speed warning in amber, and Download anyway as the only (secondary) action when it is offered.
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { floorCheck, floorView, type FloorFacts, type FloorView } from "@hermit/model";
import { floorFacts } from "../adapters";
import { Btn, Card, Note } from "../components/kit";
import { Onb } from "../components/Onboarding";
import { currentLocale, t } from "../i18n";
import { s } from "../theme";
import { usePalette } from "../use-palette";

const gb = (bytes: number) => `${new Intl.NumberFormat(currentLocale(), { maximumFractionDigits: 1 }).format(bytes / 1e9)} GB`;

export default function Unsupported() {
  const p = usePalette();
  const [view, setView] = useState<FloorView>();

  useEffect(() => {
    void floorFacts().then(
      (facts: FloorFacts) => {
        const v = floorCheck(facts);
        // Not below the floor after all (a fact read differently this time): back to the download.
        if (v.kind !== "below_floor") return router.replace("/download");
        setView(floorView(v, facts));
      },
      () => router.replace("/download"),
    );
  }, []);

  if (!view) return <SafeAreaView style={{ flex: 1, backgroundColor: p.bg }} />;
  return (
    <Onb
      pose="error"
      title={t(view.title)}
      footer={view.actions.length ? view.actions.map((a) => (
        <Btn key={a} label={t("HM-ONB-05.downloadAnyway")} kind="secondary" icon="download" full onPress={() => router.replace({ pathname: "/download", params: { anyway: "1" } })} />
      )) : null}
    >
      {/* Why, in plain words, each with its own line; the layout scrolls at 200% text. */}
      <Card>
        <View style={{ gap: s.sm }}>
          {view.reasons.map((r) => (
            <Note
              key={r.key}
              icon="smartphone"
              text={t(r.key, Object.fromEntries(Object.entries(r.vars).map(([k, v]) => [k, k === "have" || (k === "need" && v > 1e6) ? gb(v) : v])))}
              textColor="text"
              v="body"
            />
          ))}
        </View>
      </Card>
      <Note icon="circle-check" text={t(view.stillWorks)} textColor="text" v="body" />
      {view.warning ? <Note icon="triangle-alert" tone="amber" text={t(view.warning)} textColor="text" v="body" /> : null}
    </Onb>
  );
}
