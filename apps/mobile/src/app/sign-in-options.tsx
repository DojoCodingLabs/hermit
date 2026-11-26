// HM-CONN-05: sign-in options, the relay part (SL-57, US-CONN-09, US-CONN-10, PDR-022). The user's own relay by an
// address they type (an https address on a public host; private, LAN and loopback hosts refused before any request),
// checked with one counted request that lists the services it signs in for; and Dojo's relay, off by default, with
// what Dojo would see said before the switch, and "Not available yet" while this build has no Dojo relay URL (Q43).
// And first, the user's own OAuth client IDs (US-CONN-08, SL-48): Google's and Microsoft's, each checked for its shape
// before it is saved, with what to register at the provider and which client signs in now (own, Dojo's, or none yet).
// States: ST-LOAD; ST-ERROR with retry; ST-EMPTY-FIRST (no relay saved, the address field); ST-IDEAL (the saved relay);
// ST-PENDING while checking or saving; ST-ERROR inline per problem; ST-DISABLED for Dojo's relay until Q43.
// Design pass: the own relay as a mono address field with Use (primary while the address is new), Check (tonal) and
// Stop (text) as small buttons and the result in words; Dojo's relay as a switch row in a group, its note always above
// it. Every paragraph starts on the rows' text column.
import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { ANDROID_PACKAGE, APP_REDIRECT_URIS, CLIENT_PROVIDERS, type ClientIdsView, type ClientProvider, type RelayCheck, type RelayView } from "@hermit/runtime";
import { Btn, Failed, Group, Input, Label, Loading, Note as NoteLine, Notice, Page, Row, T, Toggle } from "../components/kit";
import { useHermit } from "../hermit-context";
import { t } from "../i18n";
import { s } from "../theme";

type Note =
  | { kind: "checking" }
  | { kind: "check"; result: RelayCheck }
  | { kind: "error"; key: "HM-CONN-05.error.bad_address" | "HM-CONN-05.error.save" };

export default function SignInOptions() {
  const { status } = useHermit();
  const relay = status.kind === "ready" ? status.hermit.relay : undefined;
  const [view, setView] = useState<RelayView>();
  const [clients, setClients] = useState<ClientIdsView>();
  const [failed, setFailed] = useState(false);
  const [address, setAddress] = useState("");
  const [note, setNote] = useState<Note>();
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!relay) return;
    setFailed(false);
    try {
      const [v, c] = await Promise.all([relay.view(), relay.clients()]);
      setView(v);
      setClients(c);
      setAddress(v.own?.url ?? "");
    } catch {
      setFailed(true);
    }
  }, [relay]);
  useEffect(() => {
    void load();
  }, [load]);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
    } catch {
      setNote({ kind: "error", key: "HM-CONN-05.error.save" });
    } finally {
      setBusy(false);
    }
  };

  const check = () =>
    run(async () => {
      if (!relay) return;
      setNote({ kind: "checking" });
      setNote({ kind: "check", result: await relay.check(address) });
    });

  const save = () =>
    run(async () => {
      if (!relay) return;
      setNote(undefined);
      const saved = await relay.saveOwn(address);
      if (!saved.ok) return setNote({ kind: "error", key: "HM-CONN-05.error.bad_address" });
      await load();
      setNote({ kind: "check", result: await relay.check(address) });
    });

  const remove = () =>
    run(async () => {
      if (!relay) return;
      await relay.removeOwn();
      setNote(undefined);
      await load();
    });

  const setDojo = (on: boolean) =>
    run(async () => {
      if (!relay) return;
      await relay.setDojo(on);
      await load();
    });

  if (failed || status.kind === "failed" || status.kind === "not_wired") {
    return (
      <Page title={t("HM-CONN-05.title")}>
        <Failed text={t("HM-CONN-05.loadError")} onRetry={() => void load()} />
      </Page>
    );
  }
  if (!view) {
    return (
      <Page title={t("HM-CONN-05.title")}>
        <Loading text={t("HM-CONN-05.loading")} />
      </Page>
    );
  }

  const typed = address.trim();
  const unchanged = view.own?.url === typed;
  return (
    <Page title={t("HM-CONN-05.title")} subtitle={<T v="body" color="soft">{t("HM-CONN-05.introAll")}</T>}>
      {/* US-CONN-08: the user's own OAuth clients (Gmail and Outlook sign in with them first, then Dojo's). */}
      <Label style={{ marginTop: 0 }}>{t("HM-CONN-05.clientsTitle")}</Label>
      <T v="small" color="soft" style={{ marginBottom: s.md, paddingHorizontal: s.lg }}>{t("HM-CONN-05.clientsNote")}</T>
      {clients ? (
        <View style={{ gap: s.xl }}>
          {CLIENT_PROVIDERS.map((p) => (
            <ClientId key={p} provider={p} saved={clients.own[p]} dojo={clients.dojo[p]} save={(id) => relay!.saveClientId(p, id)} remove={() => relay!.removeClientId(p)} onChanged={() => void load()} />
          ))}
        </View>
      ) : null}

      <Label>{t("HM-CONN-05.relaysTitle")}</Label>
      <T v="small" color="soft" style={{ paddingHorizontal: s.lg }}>{t("HM-CONN-05.intro")}</T>
      <Label style={{ marginTop: s.lg }}>{t("HM-CONN-05.ownTitle")}</Label>
      <View style={{ gap: s.md }}>
        <T v="small" color="soft" style={{ paddingHorizontal: s.lg }}>{t("HM-CONN-05.ownNote")}</T>
        {view.own ? <View style={{ paddingHorizontal: s.lg }}><NoteLine icon="circle-check" text={t("HM-CONN-05.ownSaved", { host: view.own.host })} textColor="text" v="body" /></View> : null}
        <Input
          label={t("HM-CONN-05.ownLabel")}
          value={address}
          mono
          onChange={(v) => (setAddress(v), setNote(undefined))}
          field={{ placeholder: t("HM-CONN-05.ownPlaceholder"), keyboardType: "url", inputMode: "url", editable: !busy }}
        />
        {/* One primary action at a time: Use while the address is new; then Check, and Stop as a quiet text button. */}
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: s.sm }}>
          {!unchanged ? <Btn label={t("HM-CONN-05.ownSave")} small disabled={busy || !typed} onPress={() => void save()} /> : null}
          <Btn label={t("HM-CONN-05.ownCheck")} kind="secondary" small disabled={busy || !typed} onPress={() => void check()} />
          {view.own ? <Btn label={t("HM-CONN-05.ownRemove")} kind="text" small disabled={busy} onPress={() => void remove()} /> : null}
        </View>
        <View style={{ paddingHorizontal: s.lg }}><RelayNote note={note} /></View>
      </View>

      <Label>{t("HM-CONN-05.dojoTitle")}</Label>
      {/* What Dojo would see is said before the switch, every time, not only after turning it on (US-CONN-10). */}
      <T v="small" color="soft" style={{ marginBottom: s.md, paddingHorizontal: s.lg }}>{t("HM-CONN-05.dojoNote")}</T>
      <Group>
        <Row
          icon="server"
          title={t("HM-CONN-05.dojoSwitch")}
          {...(!view.dojo.available ? { sub: t("HM-CONN-05.dojoUnavailable") } : {})}
          trailing={
            <Toggle
              on={view.dojo.on}
              disabled={busy || !view.dojo.available}
              label={view.dojo.available ? t("HM-CONN-05.dojoSwitch") : `${t("HM-CONN-05.dojoSwitch")}, ${t("HM-CONN-05.dojoUnavailable")}`}
              onChange={(on) => void setDojo(on)}
            />
          }
        />
      </Group>

      <View style={{ marginTop: s.lg, paddingHorizontal: s.lg }}><NoteLine icon="shield" text={t("HM-CONN-05.privacyNote")} /></View>
    </Page>
  );
}

function RelayNote({ note }: { note: Note | undefined }) {
  if (!note) return null;
  if (note.kind === "checking") return <Loading text={t("HM-CONN-05.checking")} />;
  if (note.kind === "error") return <View accessibilityRole="alert"><NoteLine icon="circle-alert" tone="coral" text={t(note.key)} textColor="text" /></View>;
  const r = note.result;
  if (r.kind === "refused") return <View accessibilityRole="alert"><NoteLine icon="circle-alert" tone="coral" text={t(`HM-CONN-05.error.${r.problem}`)} textColor="text" /></View>;
  return <Notice tone={r.providers.length ? "ok" : "info"} text={r.providers.length ? t("HM-CONN-05.checkOk", { providers: r.providers.join(", ") }) : t("HM-CONN-05.checkNone")} />;
}

const PROVIDER_NAME: Record<ClientProvider, string> = { google: "Google", microsoft: "Microsoft" };
const PLACEHOLDER: Record<ClientProvider, string> = { google: "123456789012-abc.apps.googleusercontent.com", microsoft: "00000000-0000-0000-0000-000000000000" };

/**
 * One provider's own client ID (US-CONN-08): a mono field, Use this ID while it is new and Stop using it once saved, what
 * to register at the provider (the package and the redirect Hermit comes back on, Q156 and Q157) and which client signs in now:
 * the user's own, Dojo's, or none yet. A client ID is a public identifier, so it is shown whole.
 */
function ClientId({ provider, saved, dojo, save, remove, onChanged }: {
  provider: ClientProvider; saved?: string; dojo: boolean;
  save(id: string): Promise<{ ok: true } | { ok: false; problem: "bad_client_id" }>; remove(): Promise<void>; onChanged(): void;
}) {
  const [value, setValue] = useState(saved ?? "");
  const [bad, setBad] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => setValue(saved ?? ""), [saved]);
  const typed = value.trim();

  const run = async (work: () => Promise<boolean>) => {
    setBusy(true);
    try {
      if (await work()) onChanged();
    } catch {
      setBad(true);
    } finally {
      setBusy(false);
    }
  };
  const use = () =>
    run(async () => {
      const r = await save(typed);
      setBad(!r.ok);
      return r.ok;
    });
  const stop = () =>
    run(async () => {
      await remove();
      setValue("");
      return true;
    });

  return (
    <View style={{ gap: s.sm }}>
      <Input
        label={t(`HM-CONN-05.client.${provider}`)}
        value={value}
        mono
        invalid={bad}
        onChange={(v) => {
          setValue(v);
          setBad(false);
        }}
        field={{ placeholder: PLACEHOLDER[provider], editable: !busy }}
      />
      <T v="caption" color="soft" style={{ paddingHorizontal: s.lg }}>{t(`HM-CONN-05.clientHelp.${provider}`, { package: ANDROID_PACKAGE })}</T>
      <View style={{ paddingHorizontal: s.lg, gap: 2 }}>
        <T v="caption" color="soft">{t("HM-CONN-05.redirect")}</T>
        <T v="monoSmall" selectable>{APP_REDIRECT_URIS[provider]}</T>
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: s.sm }}>
        {typed !== (saved ?? "") ? <Btn label={t("HM-CONN-05.clientSave")} small disabled={busy || !typed} onPress={() => void use()} /> : null}
        {saved ? <Btn label={t("HM-CONN-05.clientRemove")} kind="text" small disabled={busy} onPress={() => void stop()} /> : null}
      </View>
      <View style={{ paddingHorizontal: s.lg }}>
        {bad ? (
          <View accessibilityRole="alert"><NoteLine icon="circle-alert" tone="coral" text={t("HM-CONN-05.error.bad_client_id", { provider: PROVIDER_NAME[provider] })} textColor="text" /></View>
        ) : saved ? (
          <NoteLine icon="circle-check" text={t("HM-CONN-05.clientSaved")} textColor="text" />
        ) : (
          <NoteLine icon="info" text={t(dojo ? "HM-CONN-05.clientDojo" : "HM-CONN-05.clientNone")} />
        )}
      </View>
    </View>
  );
}
