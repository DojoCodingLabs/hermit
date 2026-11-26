// HM-SET-09: What Hermit can use (Q147). One list with the levels the app has today, and no new policy code:
// - the phone's permissions read On or Off (Android grants them; the one button grants or manages, as on HM-SET-01
//   before), with their states: ST-LOAD, ST-ERROR with retry, granted, not asked, off, partly on, not used yet;
// - what sends or acts always asks (the cage asks every time; anything that leaves the phone can't be Always);
// - each web task site is Ask or Always for the sign-in only: Always keeps the site signed in (HM-WEB-02's switch),
//   and filling a saved login still asks for the fingerprint every time;
// - connections open their own screens.
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { AppState, View } from "react-native";
import { originOf } from "@hermit/core";
import type { PermissionId, PermissionRow } from "@hermit/runtime";
import { actOnPermission, readPermissions } from "../adapters";
import { browserMultiProfile } from "../adapters/browser";
import type { IconName } from "../components/Icon";
import { Btn, Group, Label, LinkText, Note, Page, Row, Segmented, Status, T } from "../components/kit";
import { InfoSheet } from "../components/Sheet";
import { useHermit } from "../hermit-context";
import { t } from "../i18n";
import { s } from "../theme";

const TITLE: Record<PermissionId, string> = {
  notifications: "HM-SET-01.perm.notifications",
  calendar: "HM-SET-01.perm.calendar",
  contacts: "HM-SET-01.perm.contacts",
  reminders: "HM-SET-01.perm.reminders",
  fingerprint: "HM-SET-01.perm.fingerprint",
  microphone: "HM-SET-01.perm.microphone",
  autofill: "HM-SET-01.perm.autofill",
};
const ICON: Record<PermissionId, IconName> = {
  notifications: "message-circle", calendar: "calendar", contacts: "contact", reminders: "bell", fingerprint: "fingerprint", microphone: "mic", autofill: "key",
};

export default function WhatHermitCanUse() {
  const router = useRouter();
  const { status } = useHermit();
  const web = status.kind === "ready" ? status.hermit.web : undefined;
  const [rows, setRows] = useState<PermissionRow[]>();
  const [failed, setFailed] = useState(false);
  const [sites, setSites] = useState<{ origin: string; kept: boolean }[]>();
  const [help, setHelp] = useState<PermissionRow>();

  const load = useCallback(async () => {
    setFailed(false);
    try {
      setRows(await readPermissions());
    } catch {
      setFailed(true);
    }
  }, []);

  const loadSites = useCallback(async () => {
    if (!web) return setSites([]);
    try {
      const [recipes, kept] = await Promise.all([web.recipes(), web.keptSites()]);
      const origins = [...new Set([...recipes.map((r) => r.origin), ...kept])];
      setSites(origins.map((origin) => ({ origin, kept: kept.includes(origin) })));
    } catch {
      setSites([]);
    }
  }, [web]);

  useEffect(() => {
    void load();
    void loadSites();
    // Back from a settings page: read again (a permission may have been granted or revoked there, EC-ONB-06).
    const sub = AppState.addEventListener("change", (st) => st === "active" && void load());
    return () => sub.remove();
  }, [load, loadSites]);

  const act = async (row: PermissionRow) => {
    if (row.action === "retry") return void load();
    await actOnPermission(row.id, row.action).catch(() => {});
    void load();
  };

  const levels = [t("HM-SET-09.always"), t("HM-SET-09.ask")];
  const writes: Array<[IconName, string, string]> = [
    ["send", "HM-SET-09.replyWhatsapp", "HM-SET-09.neverAlways"],
    // SL-49: sending, replying, forwarding, archiving and drafts always ask; so does every mail read by day.
    ["mail", "HM-SET-09.email", "HM-SET-09.emailSub"],
    ["wallet", "HM-SET-09.payments", "HM-SET-09.neverAlways"],
    ["search", "HM-SET-02.search", "HM-SET-09.searchSub"],
  ];

  return (
    <Page title={t("HM-SET-09.title")} subtitle={<T v="body" color="soft">{t("HM-SET-09.intro")}</T>}>
      <Label style={{ marginTop: 0 }}>{t("HM-SET-01.permissions")}</Label>
      <T v="small" color="soft" style={{ marginBottom: s.sm, paddingHorizontal: s.lg }}>{t("HM-SET-01.permissionsIntro")}</T>
      {failed ? (
        <View style={{ gap: s.sm }}>
          <T v="body" color="coral">{t("HM-SET-01.state.unknown")}</T>
          <Btn label={t("common.retry")} kind="secondary" icon="refresh-cw" onPress={() => void load()} />
        </View>
      ) : !rows ? (
        <T v="body" color="soft" live="polite">{t("HM-SET-01.loading")}</T>
      ) : (
        <Group>
          {rows.map((row) => {
            // A permission already on opens Android's page on a tap (a chevron, not "Change" under every row); one that
            // needs you keeps its button in words.
            const manage = row.action === "manage";
            return (
              <Row
                key={row.id}
                icon={ICON[row.id]}
                title={t(TITLE[row.id])}
                top
                // The state sits under the title, so the description gets the row's width (two lines at most).
                sub={
                  <View style={{ gap: s.xs }}>
                    <Status text={t(`HM-SET-01.state.${row.state}`)} tone={row.state === "granted" ? "link" : "soft"} {...(row.state === "granted" ? { icon: "check" as const } : row.state === "denied" || row.state === "limited" || row.state === "unknown" ? { icon: "circle-alert" as const } : {})} />
                    <T v="small" color="soft">{t(`${TITLE[row.id]}Use`)}</T>
                    {/* The steps to fix it are a few lines: they open in a sheet, so the row stays two lines at most. */}
                    {row.help ? <LinkText label={t("HM-SET-01.helpOpen")} onPress={() => setHelp(row)} /> : null}
                    {row.action !== "none" && !manage ? (
                      <Btn label={t(`HM-SET-01.action.${row.action}`)} a11y={`${t(`HM-SET-01.action.${row.action}`)}: ${t(TITLE[row.id])}`} kind="secondary" small onPress={() => void act(row)} />
                    ) : null}
                  </View>
                }
                {...(manage ? { chevron: true, role: "link" as const, a11y: `${t(TITLE[row.id])}, ${t(`HM-SET-01.state.${row.state}`)}`, hint: t(`HM-SET-01.action.${row.action}`), onPress: () => void act(row) } : {})}
              />
            );
          })}
        </Group>
      )}

      <Label>{t("HM-SET-09.act")}</Label>
      <Group>
        {writes.map(([icon, title, sub]) => (
          // "Always asks" under the title, like the permissions' state, so the line under it keeps the row's width.
          <Row key={title} icon={icon} title={t(title)} sub={<View style={{ gap: s.xs }}><Status text={t("HM-SET-09.alwaysAsks")} icon="fingerprint" /><T v="small" color="soft">{t(sub)}</T></View>} top />
        ))}
      </Group>

      <Label>{t("HM-SET-09.sites")}</Label>
      <T v="small" color="soft" style={{ marginBottom: s.sm, paddingHorizontal: s.lg }}>{t("HM-SET-09.siteNote")}</T>
      {sites && sites.length === 0 ? <T v="small" color="soft" style={{ paddingHorizontal: s.lg }}>{t("HM-SET-09.noSites")}</T> : null}
      {!!sites?.length && !browserMultiProfile() ? <T v="small" color="soft" style={{ paddingHorizontal: s.lg }}>{t("HM-WEB-02.sharedProfile")}</T> : null}
      {!!sites?.length && browserMultiProfile() ? (
        <Group>
          {sites.map((site) => {
            const name = (originOf(site.origin) ?? site.origin).replace(/^https:\/\//, "");
            return (
              <View key={site.origin} style={{ paddingHorizontal: s.lg, paddingVertical: s.md, gap: s.md }}>
                <Note icon="key-round" text={name} textColor="text" v="bodyStrong" />
                <Segmented
                  options={levels}
                  value={site.kept ? 0 : 1}
                  label={name}
                  onChange={async (i) => {
                    if (!web) return;
                    await web.keepSignedIn(site.origin, i === 0);
                    void loadSites();
                  }}
                />
              </View>
            );
          })}
        </Group>
      ) : null}

      <Label>{t("HM-SET-09.connections")}</Label>
      <Group>
        <Row icon="mail" title={t("HM-MAIL-01.title")} chevron role="link" onPress={() => router.push("/mail")} />
        <Row icon="link" title={t("HM-CONN-04.title")} chevron role="link" onPress={() => router.push("/connect")} />
        <Row icon="server" title={t("HM-CONN-03.title")} chevron role="link" onPress={() => router.push("/mcp")} />
      </Group>
      <InfoSheet
        visible={!!help}
        onClose={() => setHelp(undefined)}
        title={help ? t(TITLE[help.id]) : ""}
        paragraphs={help?.help ? [t(`HM-SET-01.help.${help.help}`)] : []}
      />
    </Page>
  );
}
