// HM-CONN-04: connect a service (US-CONN-04, US-CONN-05, US-CONN-06, SL-55). The rules live in @hermit/connectors
// (ConnectorInstalls) behind the runtime; this screen draws its states: ST-LOAD, ST-EMPTY-FIRST, ST-IDEAL (installed
// connectors with per-operation switches), the one input (a name, a docs link or pasted docs), ST-PENDING while Hermit
// looks and drafts, the MCP hand-off, "send me the docs", the review card (source label, hosts, sign-in, key, test call,
// each operation with its code-derived risk), Install behind a fingerprint, and ST-ERROR.
// Design pass: one input and Find as the primary action, the docs note in amber; installed connectors as outlined cards
// with a switch per operation; the review with its source as a chip (amber when Hermit drafted it), sign-in, key and
// test in the shared fields, the operations with switches and the cage's guards in coral, Install pinned at the foot.
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { Alert, View } from "react-native";
import { SIGN_IN_KINDS, type ConnectProblem, type ConnectReview, type InstallProblem, type InstalledView, type SignInKind } from "@hermit/runtime";
import { ChoiceList } from "../components/ChoiceList";
import { Icon } from "../components/Icon";
import { Badge, Btn, Card, Chip, Failed, Field, Footer, Group, Input, Label, LinkText, Loading, Note as NoteLine, Notice, Page, Row, T, Toggle } from "../components/kit";
import { RiskTile } from "../components/Risk";
import { inputOrigin, installBlocker, signInSentence, startFrom } from "../connect-view";
import { useHermit } from "../hermit-context";
import { t, tCount } from "../i18n";
import { s } from "../theme";
import { usePalette } from "../use-palette";

type Problem = ConnectProblem | InstallProblem | "sign_in_not_in_doc" | "not_changeable" | "bad_key" | "failed";

type Screen =
  | { kind: "loading" }
  | { kind: "list"; installed: InstalledView[] }
  | { kind: "checking" }
  | { kind: "need_docs" }
  | { kind: "mcp"; name: string; serverUrl: string }
  | { kind: "review"; review: ConnectReview; enabled: string[]; note?: Problem }
  | { kind: "error"; problem: Problem };

export default function Connect() {
  const router = useRouter();
  const { status } = useHermit();
  const connect = status.kind === "ready" ? status.hermit.connect : undefined;
  // A deep link is never chat provenance: only the chat's one-time offer id is (the runtime checks it again). A link
  // with only `request` prefills the field as the user's own typing, which their tap on Find confirms.
  const initial = startFrom(useLocalSearchParams<{ request?: string; offer?: string }>());
  const [screen, setScreen] = useState<Screen>({ kind: "loading" });
  const [text, setText] = useState(initial.text);
  // Editing the words makes them the user's typing or pasting here, and the offer id is no longer sent.
  const origin = useRef<"typed" | "pasted" | "chat">(initial.origin);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!connect) return;
    try {
      setScreen({ kind: "list", installed: await connect.list() });
    } catch {
      setScreen({ kind: "error", problem: "failed" });
    }
  }, [connect]);
  useFocusEffect(useCallback(() => void load(), [load]));

  const find = async () => {
    if (!connect) return;
    setScreen({ kind: "checking" });
    try {
      const r = await connect.start({ text, origin: origin.current, ...(origin.current === "chat" && initial.offerId ? { offerId: initial.offerId } : {}) });
      // The offer is used once; a retry is the user's own request.
      origin.current = origin.current === "chat" ? "typed" : origin.current;
      if (r.kind === "review") return setScreen({ kind: "review", review: r.review, enabled: [] });
      if (r.kind === "mcp") return setScreen({ kind: "mcp", name: r.name, serverUrl: r.serverUrl });
      if (r.kind === "need_docs") return setScreen({ kind: "need_docs" });
      setScreen({ kind: "error", problem: r.problem });
    } catch {
      setScreen({ kind: "error", problem: "failed" });
    }
  };

  const cancel = async (draftId?: string) => {
    if (draftId) await connect?.cancel(draftId).catch(() => {});
    setText("");
    origin.current = "typed";
    await load();
  };

  if (!connect || screen.kind === "loading" || screen.kind === "checking") {
    return (
      <Page title={t("HM-CONN-04.title")}>
        <Loading text={t(screen.kind === "checking" ? "HM-CONN-04.checking" : "HM-CONN-04.loading")} />
      </Page>
    );
  }

  if (screen.kind === "error") {
    return (
      <Page title={t("HM-CONN-04.title")}>
        <Failed text={t(`HM-CONN-04.error.${screen.problem}`)} onRetry={() => void cancel()} />
      </Page>
    );
  }

  if (screen.kind === "mcp") {
    return (
      <Page
        title={t("HM-CONN-04.mcpTitle", { name: screen.name })}
        footer={
          <Footer>
            <Btn label={t("HM-CONN-04.mcpOpen")} icon="server" style={{ flexGrow: 1 }} onPress={() => router.push({ pathname: "/mcp", params: { url: screen.serverUrl } })} />
            <Btn label={t("HM-CONN-04.cancel")} kind="text" onPress={() => void cancel()} />
          </Footer>
        }
      >
        <View style={{ gap: s.lg }}>
          <T v="body" color="soft">{t("HM-CONN-04.mcpBody", { name: screen.name })}</T>
          <Card><T v="mono" selectable>{screen.serverUrl}</T></Card>
        </View>
      </Page>
    );
  }

  if (screen.kind === "review") {
    return <Review screen={screen} setScreen={setScreen} busy={busy} setBusy={setBusy} onDone={() => void cancel()} onCancel={() => void cancel(screen.review.draftId)} />;
  }

  return (
    <Page title={t("HM-CONN-04.title")} subtitle={<T v="body" color="soft">{t("HM-CONN-04.intro")}</T>}>
      <View style={{ gap: s.md }}>
        {screen.kind === "need_docs" ? (
          <Card>
            <View style={{ gap: s.xs }} accessibilityLiveRegion="polite">
              <NoteLine icon="info" text={t("HM-CONN-04.needDocs")} textColor="text" v="body" />
              <T v="small" color="soft">{t("HM-CONN-04.noApi")}</T>
              <LinkText label={t("HM-CONN-04.openVault")} icon="key-round" onPress={() => router.push("/vault")} />
              {/* SL-56: a service with no API is a web task on HM-WEB-02, signed in with the vault's login. */}
              <LinkText label={t("HM-CONN-04.openWebTasks")} icon="globe" onPress={() => router.push("/browser")} />
            </View>
          </Card>
        ) : null}
        <Input
          label={t("HM-CONN-04.inputLabel")}
          value={text}
          onChange={(v) => {
            origin.current = inputOrigin(text, v);
            setText(v);
          }}
          field={{ multiline: true, placeholder: t("HM-CONN-04.placeholder") }}
        />
        <NoteLine icon="shield-alert" tone="amber" text={t("HM-CONN-04.untrustedNote")} />
        <Btn label={t("HM-CONN-04.find")} icon="search" full disabled={!text.trim()} onPress={() => void find()} />
      </View>
      {screen.kind === "list" && screen.installed.length === 0 ? <View style={{ marginTop: s.xl }}><NoteLine icon="plug" text={t("HM-CONN-04.empty")} /></View> : null}
      {screen.kind === "list" && screen.installed.length ? (
        <>
          <Label>{t("HM-CONN-04.installed")}</Label>
          <View style={{ gap: s.md }}>{screen.installed.map((c) => <Installed key={c.id} connector={c} onChanged={load} />)}</View>
        </>
      ) : null}
    </Page>
  );
}

function Review(props: {
  screen: Extract<Screen, { kind: "review" }>;
  setScreen(s: Screen): void;
  busy: boolean;
  setBusy(b: boolean): void;
  onDone(): void;
  onCancel(): void;
}) {
  const { status } = useHermit();
  const connect = status.kind === "ready" ? status.hermit.connect! : undefined;
  const p = usePalette();
  const sc = props.screen;
  const r = sc.review;
  const [key, setKey] = useState("");
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [kind, setKind] = useState<SignInKind>(r.signIn.reading?.kind ?? "bearer");
  const [name, setName] = useState(r.signIn.reading?.name ?? "");
  const [prefix, setPrefix] = useState(r.signIn.reading?.prefix ?? "");
  const update = (review: ConnectReview) => props.setScreen({ kind: "review", review, enabled: sc.enabled.filter((n) => review.operations.some((o) => o.name === n)) });
  const sentence = signInSentence(r.signIn.reading);
  const blocker = installBlocker(r);
  const label = r.source === "drafted" ? "HM-CONN-04.source.drafted" : r.source === "openapi" ? "HM-CONN-04.source.openapi" : "HM-CONN-04.source.catalog";

  const run = async (f: () => Promise<void>) => {
    props.setBusy(true);
    try {
      await f();
    } catch {
      props.setScreen({ kind: "error", problem: "failed" });
    } finally {
      props.setBusy(false);
    }
  };

  const applySignIn = () => run(async () => {
    const out = await connect!.setSignIn(r.draftId, { kind, ...(name.trim() ? { name: name.trim() } : {}), ...(prefix.trim() ? { prefix: prefix.trim() } : {}) });
    if (out.kind === "review") update(out.review);
    else props.setScreen({ ...sc, note: out.problem });
  });
  const saveKey = () => run(async () => {
    const out = await connect!.saveKey(r.draftId, r.signIn.needs === "basic" ? { username: user, password } : { key });
    setKey("");
    setPassword("");
    if (out.kind === "review") update(out.review);
    else props.setScreen({ ...sc, note: out.problem });
  });
  const test = () => run(async () => {
    const out = await connect!.testCall(r.draftId);
    update({ ...r, ...(out.result !== "unknown_draft" ? { tested: { operation: r.testable[0] ?? "", result: out.result } } : {}) });
  });
  const install = () => run(async () => {
    const out = await connect!.install(r.draftId, { enabled: sc.enabled });
    if (out.ok) props.onDone();
    else props.setScreen({ ...sc, note: out.problem });
  });
  const secret = { secureTextEntry: true, importantForAutofill: "no" as const };

  return (
    <Page
      title={t("HM-CONN-04.reviewTitle", { name: r.name })}
      footer={
        <Footer>
          <Btn label={t("HM-CONN-04.install")} icon="fingerprint" busy={props.busy} disabled={!!blocker} style={{ flexGrow: 1 }} onPress={() => void install()} />
          <Btn label={t("HM-CONN-04.cancel")} kind="text" onPress={props.onCancel} />
        </Footer>
      }
    >
      <View style={{ gap: s.sm }}>
        {/* Made by Hermit from docs: amber, check every line. */}
        <Chip label={t(label)} icon={r.madeByHermit ? "triangle-alert" : r.source === "catalog" ? "shield-check" : "book-open"} tone={r.madeByHermit ? "amber" : "plain"} />
        {r.docHost ? <T v="small" color="soft">{t("HM-CONN-04.docsFrom", { host: r.docHost })}</T> : null}
        {r.replaces ? <NoteLine icon="triangle-alert" tone="amber" text={t("HM-CONN-04.replaces")} textColor="text" /> : null}
        <Field label={t("HM-CONN-04.hosts")} value={r.hosts.join(", ")} mono />
      </View>

      <Label>{t("HM-CONN-04.signInTitle")}</Label>
      {!r.signIn.available ? (
        <NoteLine icon="ban" tone="coral" text={t("HM-CONN-04.error.sign_in_unavailable")} textColor="text" v="body" />
      ) : (
        <View style={{ gap: s.md }}>
          <NoteLine icon="key-round" text={t(sentence.key, sentence.vars)} textColor="text" v="body" />
          {r.signIn.changeable ? (
            <View style={{ gap: s.sm }}>
              <T v="small" color="soft">{t("HM-CONN-04.signInChange")}</T>
              <ChoiceList<SignInKind> choices={SIGN_IN_KINDS.map((k) => ({ value: k, label: t(`HM-CONN-04.kind.${k}`) }))} selected={kind} onChoose={setKind} />
              {kind === "header_key" || kind === "query_key" ? (
                <>
                  <Input label={t("HM-CONN-04.nameLabel")} value={name} onChange={setName} mono />
                  {kind === "header_key" ? <Input label={t("HM-CONN-04.prefixLabel")} value={prefix} onChange={setPrefix} mono /> : null}
                </>
              ) : null}
              <Btn label={t("HM-CONN-04.signInApply")} kind="secondary" busy={props.busy} onPress={() => void applySignIn()} />
            </View>
          ) : null}
          {r.signIn.needs === "basic" ? (
            <>
              <Input label={t("HM-CONN-04.userLabel")} value={user} onChange={setUser} />
              <Input label={t("HM-CONN-04.passwordLabel")} value={password} onChange={setPassword} field={secret} />
            </>
          ) : (
            <Input label={t("HM-CONN-04.keyLabel")} value={key} onChange={setKey} mono field={secret} />
          )}
          <NoteLine icon={r.keySaved ? "circle-check" : "lock"} text={t(r.keySaved ? "HM-CONN-04.keySaved" : "HM-CONN-04.keyNote")} />
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: s.sm }}>
            <Btn label={t("HM-CONN-04.saveKey")} kind="secondary" icon="lock" busy={props.busy} disabled={r.signIn.needs === "basic" ? !user : !key.trim()} onPress={() => void saveKey()} />
            {r.testable.length ? <Btn label={t("HM-CONN-04.test", { name: r.testable[0]! })} kind="secondary" icon="play" busy={props.busy} disabled={!r.keySaved} onPress={() => void test()} /> : null}
          </View>
          {r.testable.length ? (
            r.tested ? <Notice tone={r.tested.result === "ok" ? "ok" : "bad"} text={t(`HM-CONN-04.tested.${r.tested.result}`)} /> : null
          ) : (
            <T v="small" color="soft">{t("HM-CONN-04.noTest")}</T>
          )}
        </View>
      )}

      <Label>{t("HM-CONN-04.opsTitle")}</Label>
      <T v="small" color="soft" style={{ marginBottom: s.md, paddingHorizontal: s.lg }}>{t("HM-CONN-04.opsNote")}</T>
      {/* Each operation with its risk tile and words; a guard line is coral, the cage's own words. */}
      <Group lead="tile">
        {r.operations.map((op) => {
          const on = sc.enabled.includes(op.name);
          return (
            <View key={op.name} style={{ flexDirection: "row", alignItems: "flex-start", gap: s.md, paddingVertical: s.md, paddingHorizontal: s.lg }}>
              <RiskTile risk={op.risk} destructive={op.destructive} />
              <View style={{ flex: 1, gap: 2 }}>
                <T v="bodyStrong">{op.title}</T>
                <T v="monoSmall" color="soft">{op.method} {op.path}</T>
                {op.args.length ? <T v="small" color="soft">{t("HM-CONN-04.args", { args: op.args.map((a) => `${a.name}${a.required ? "*" : ""} (${a.in})`).join(", ") })}</T> : null}
                <T v="small" color="soft">{t(`HM-CONN-03.risk.${op.risk}`)}{op.destructive ? ` · ${t("HM-CONN-03.destructive")}` : ""}</T>
                {op.guard.map((g) => <NoteLine key={g.effect} icon="shield-alert" tone="coral" textColor="text" text={t(`HM-CONN-04.guard.${g.effect}`, { word: g.word })} />)}
              </View>
              <Toggle on={on} label={t("HM-CONN-04.useOp", { name: op.title })} onChange={(v) => props.setScreen({ ...sc, enabled: v ? [...sc.enabled, op.name] : sc.enabled.filter((n) => n !== op.name) })} />
            </View>
          );
        })}
      </Group>
      <View style={{ gap: s.xs, marginTop: s.md, paddingHorizontal: s.lg }}>
        {r.skipped.length ? <T v="small" color="soft">{tCount("HM-CONN-04.skipped", r.skipped.length)}</T> : null}
        {r.repairs ? <T v="small" color="soft">{tCount("HM-CONN-04.repairs", r.repairs)}</T> : null}
        {sc.note ? <View accessibilityRole="alert"><NoteLine icon="circle-alert" tone="coral" text={t(`HM-CONN-04.error.${sc.note}`)} textColor="text" /></View> : null}
        {blocker ? <NoteLine icon="info" text={t(`HM-CONN-04.blocked.${blocker}`)} /> : null}
      </View>
    </Page>
  );
}

function Installed({ connector: c, onChanged }: { connector: InstalledView; onChanged(): Promise<void> }) {
  const p = usePalette();
  const { status } = useHermit();
  const connect = status.kind === "ready" ? status.hermit.connect! : undefined;
  const remove = () =>
    Alert.alert(t("HM-CONN-04.removeTitle", { name: c.name }), t("HM-CONN-04.removeBody"), [
      { text: t("HM-CONN-04.cancel"), style: "cancel" },
      { text: t("HM-CONN-04.remove"), style: "destructive", onPress: () => void connect?.remove(c.id).then(onChanged) },
    ]);
  // One grouped list: the connector (its name, its hosts raw in mono, a drafted badge), its operations with their risk
  // tiles and switches, then Remove as a coral row.
  return (
    <Group>
      <Row
        icon="plug"
        top
        title={c.name}
        sub={
          <View style={{ gap: s.xs, marginTop: 2 }}>
            <T v="monoSmall" color="soft">{c.hosts.join(", ")}</T>
            {c.madeByHermit ? <Badge label={t("HM-CONN-04.source.drafted")} tone="amber" /> : null}
            {c.changed ? <NoteLine icon="triangle-alert" tone="amber" text={t("HM-CONN-04.changed")} textColor="text" /> : null}
            {c.tested === "untested" ? <T v="small" color="soft">{t("HM-CONN-04.untested")}</T> : null}
          </View>
        }
      />
      {c.operations.map((op) => (
        <View key={op.name} style={{ flexDirection: "row", alignItems: "center", gap: s.md, minHeight: 56, paddingVertical: s.md, paddingHorizontal: s.lg }}>
          <RiskTile risk={op.risk} destructive={op.destructive} />
          <View style={{ flex: 1, gap: 2 }}>
            <T v="bodyStrong">{op.title}</T>
            <T v="small" color="soft">{t(`HM-CONN-03.risk.${op.risk}`)}{op.destructive ? ` · ${t("HM-CONN-03.destructive")}` : ""}</T>
          </View>
          <Toggle on={op.enabled} disabled={c.changed} label={t("HM-CONN-04.useOp", { name: op.title })} onChange={(v) => void connect?.setOperation(c.id, op.name, v).then(onChanged)} />
        </View>
      ))}
      <Row icon="trash-2" iconColor="coral" title={<T v="bodyStrong" color="coral">{t("HM-CONN-04.remove")}</T>} a11y={t("HM-CONN-04.removeTitle", { name: c.name })} onPress={remove} />
    </Group>
  );
}
