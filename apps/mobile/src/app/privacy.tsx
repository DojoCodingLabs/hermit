// HM-SET-02: privacy (US-SET-02, ADR-009, PDR-022). The promises, the web search provider (US-WEB-03), every host
// Hermit may contact or did contact with its count from the local counter (FR-PRIV-02), Dojo's relay, off by default,
// and the user's own relay (SL-57), both listed as hosts once chosen.
// States: ST-LOAD while the counter is read; ST-ERROR with retry; known hosts listed at zero before first use.
// Design pass (S4): "Hermit has no server." first, the promises with icons, "nothing to turn off", then the hosts.
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { hostOf, searchChoiceOf, searchProvider, type SearchChoice } from "@hermit/core";
import { privacyHosts, type PrivacyHostRow } from "@hermit/runtime";
import { mailService } from "../adapters/mail";
import { Btn, Card, Group, Label, Note, Page, Row, T } from "../components/kit";
import { OneTimeCodesNote } from "../components/OneTimeCodesNote";
import { SearchProviderPicker } from "../components/SearchProviderPicker";
import { useHermit } from "../hermit-context";
import { currentLocale, t, tCount } from "../i18n";
import { s } from "../theme";

export default function Privacy() {
  const router = useRouter();
  const { status } = useHermit();
  const [rows, setRows] = useState<PrivacyHostRow[]>();
  const [relayOn, setRelayOn] = useState(false);
  const [ownRelay, setOwnRelay] = useState<string>();
  const [search, setSearch] = useState<{ value: string; choice: SearchChoice }>();
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    if (status.kind !== "ready") return;
    setFailed(false);
    try {
      const [counted, relays, relayHosts, provider, mailHosts] = await Promise.all([
        status.hermit.hosts.list(), status.hermit.relay.view(), status.hermit.relay.privacyHosts(), status.hermit.settings.get("search.provider"),
        mailService()?.hosts() ?? Promise.resolve([]),
      ]);
      // The chosen provider, the relays and the email accounts' providers (SL-48) are listed even before first use, like
      // the other hosts Hermit may contact (SL-57).
      const searchHost = hostOf(searchProvider(provider)?.base ?? "");
      setRows(privacyHosts(counted, { ...relayHosts, ...(searchHost ? { searchHosts: [searchHost] } : {}), mailHosts }));
      setRelayOn(relays.dojo.on);
      setOwnRelay(relays.own?.host);
      setSearch({ value: provider ?? "", choice: searchChoiceOf(provider) });
    } catch {
      setFailed(true);
    }
  }, [status]);
  const saveSearch = useCallback(async (value: string) => {
    if (status.kind !== "ready") throw new Error("not ready");
    await status.hermit.settings.set("search.provider", value);
    await load();
  }, [status, load]);
  useEffect(() => {
    void load();
  }, [load]);

  const fmt = new Intl.DateTimeFormat(currentLocale(), { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const count = new Intl.NumberFormat(currentLocale());

  return (
    <Page title={t("HM-SET-02.title")}>
      <T v="title" role="header">{t("HM-SET-02.noServer")}</T>
      <View style={{ gap: s.md, marginTop: s.lg }} accessibilityRole="summary" accessibilityLabel={t("HM-SET-02.promises")}>
        <Note icon="smartphone" text={t("HM-SET-02.promiseLocal")} textColor="text" v="body" />
        <Note icon="ban" text={t("HM-SET-02.promiseNoTelemetry")} textColor="text" v="body" />
        <Note icon="fingerprint" text={t("HM-SET-02.promiseApproval")} textColor="text" v="body" />
      </View>
      <Card style={{ marginTop: s.lg }}>
        <Note icon="circle-check" text={t("HM-SET-02.nothingToTurnOff")} textColor="text" />
      </Card>
      {/* US-MSG-07 (Q56): why one-time codes never reach Hermit. */}
      <OneTimeCodesNote />

      <Label>{t("HM-SET-02.search")}</Label>
      <T v="small" color="soft" style={{ marginBottom: s.md, paddingHorizontal: s.lg }}>{t("HM-SET-02.searchIntro")}</T>
      {search ? <SearchProviderPicker key={search.value} choice={search.choice} save={saveSearch} /> : null}

      <Label>{t("HM-SET-02.hosts")}</Label>
      <T v="small" color="soft" style={{ marginBottom: s.md, paddingHorizontal: s.lg }}>{t("HM-SET-02.hostsIntro")}</T>
      {failed || status.kind === "failed" || status.kind === "not_wired" ? (
        <View style={{ gap: s.sm }}>
          <T v="body" color="coral">{t("HM-SET-02.error")}</T>
          <Btn label={t("common.retry")} kind="secondary" icon="refresh-cw" onPress={() => void load()} />
        </View>
      ) : !rows ? (
        <T v="body" color="soft" live="polite">{t("HM-SET-02.loading")}</T>
      ) : (
        <Group>
          {rows.map((r) => (
            <View key={r.host} style={{ flexDirection: "row", gap: s.md, paddingHorizontal: s.lg, paddingVertical: s.md, alignItems: "flex-start" }} accessible accessibilityLabel={`${r.host}, ${t(`HM-SET-02.purpose.${r.purpose}`)}, ${r.count ? tCount("HM-SET-02.count", r.count, {}, count.format(r.count)) : t("HM-SET-02.never")}`}>
              <View style={{ flex: 1, gap: 2 }}>
                <T v="mono" selectable>{r.host}</T>
                <T v="small" color="soft">{t(`HM-SET-02.purpose.${r.purpose}`)}</T>
              </View>
              <View style={{ alignItems: "flex-end", maxWidth: "40%" }}>
                <T v="smallStrong" style={{ textAlign: "right" }}>{r.count ? tCount("HM-SET-02.count", r.count, {}, count.format(r.count)) : t("HM-SET-02.never")}</T>
                {r.lastAt ? <T v="caption" color="soft" style={{ textAlign: "right" }}>{t("HM-SET-02.lastAt", { when: fmt.format(new Date(r.lastAt)) })}</T> : null}
              </View>
            </View>
          ))}
        </Group>
      )}

      <Label>{t("HM-SET-02.signIns")}</Label>
      <Group>
        <Row icon="server" title={t("HM-SET-02.relay")} sub={t(relayOn ? "HM-SET-02.relayOn" : "HM-SET-02.relayOff")} top chevron role="link" onPress={() => router.push("/sign-in-options")} />
        {ownRelay ? <Row icon="server" title={t("HM-SET-02.relayOwn", { host: ownRelay })} /> : null}
      </Group>
    </Page>
  );
}
