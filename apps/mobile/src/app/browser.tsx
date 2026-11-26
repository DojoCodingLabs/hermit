// HM-WEB-02: the live browser (US-WEB-06 to US-WEB-11, SL-53). The rules live in @hermit/core (the recipe format, the
// click classifier) and @hermit/runtime (the runner, the cage calls, the one-time offers); this screen draws its states:
// ST-LOAD; the list of saved tasks with Run and Remove and the sites kept signed in (ST-EMPTY-FIRST when none); the
// plan (the site, every step in words, every value, the vault login a sign-in step uses with a picker when the site
// has several (SL-56), Start and Cancel; ST-DISABLED until required values are in); the
// live page with the current step in words, Take over, Resume and Stop (ST-PENDING while a step runs, the paused
// reasons in words); the end (done with the site's answer marked untrusted, stopped, failed or refused in words, Save
// the fix, Stay signed in, Clear the site's data); recording a new task (the address, the live page, the step count,
// Finish); saving it (name, kind, ask-each-time per value, an optional question); ST-ERROR when the offer is gone or the
// module is missing. Approvals open on HM-APPR-01 over this screen.
// Polish round: every state is the app's page. The list, the plan, a new recording's address and saving it have the
// large title; the live page and the recording keep the title small in the bar so the site gets the room. Saved tasks
// are one grouped list (a tap opens the plan, where Start is); the plan's steps are a numbered list in Hermit's words;
// the fields are the kit's (no bordered boxes); the crab sits beside the step Hermit is on; the handoff panel is a
// sheet edge with the reason in amber words; what the site wrote is quoted, on the sunken panel, marked untrusted.
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { classifyClick, draftRecipe, originOf, TASK_KINDS, type Recipe, type RecordedEvent, type TaskKind } from "@hermit/core";
import { stepWords, type SiteLogins, type WebTask, type WebTaskEnd, type WebTaskState } from "@hermit/runtime";
import { HermitBrowserView, type BrowserNativeEvent, type HermitBrowserViewRef } from "../../modules/hermit-browser";
import { browserAvailable, browserMultiProfile, browserRecorder, clearSiteData, countBrowserRequest, siteProfile } from "../adapters/browser";
import { createBrowserPort } from "../browser-port";
import { RECORDER_SCRIPT } from "../browser-script";
import { endKey, liveLine, loginPicker, recordAddress, recordedEvent, recordedSteps, SIGN_IN_MYSELF, startFrom } from "../browser-view";
import { ChoiceList } from "../components/ChoiceList";
import { quoted } from "../format";
import { useHermit } from "../hermit-context";
import { t, tCount } from "../i18n";
import { Icon, type IconName } from "../components/Icon";
import { Btn, Card, Empty, Footer, Group, IconBtn, Input, Label, Loading, Note, Page, Row, T, Tile, Toggle } from "../components/kit";
import { Mascot } from "../components/Mascot";
import type { Pose } from "../mascot";
import { radius, s, shadow } from "../theme";
import { usePalette } from "../use-palette";

type Screen =
  | { kind: "loading" }
  | { kind: "list"; recipes: Recipe[]; kept: string[] }
  | { kind: "plan"; recipe: Recipe; values: Record<string, string> }
  | { kind: "task"; recipe: Recipe; values: Record<string, string> }
  | { kind: "address" }
  | { kind: "recording"; startUrl: string; origin: string }
  | { kind: "save"; startUrl: string; events: RecordedEvent[] }
  | { kind: "error"; key: string };

const timing = { sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)), now: () => Date.now() };
const siteOf = (origin: string) => origin.replace(/^https:\/\//, "");

export default function Browser() {
  const router = useRouter();
  const { status } = useHermit();
  const web = status.kind === "ready" ? status.hermit.web : undefined;
  const start = startFrom(useLocalSearchParams<{ offer?: string; recipe?: string; record?: string }>());
  const [screen, setScreen] = useState<Screen>({ kind: "loading" });

  const showList = useCallback(async () => {
    if (!web) return;
    setScreen({ kind: "list", recipes: await web.recipes(), kept: await web.keptSites() });
  }, [web]);

  useEffect(() => {
    if (!web || !browserAvailable() || !HermitBrowserView) {
      if (status.kind === "ready") setScreen({ kind: "error", key: "HM-WEB-02.unavailable" });
      return;
    }
    void (async () => {
      if (start.kind === "offer") {
        // The chat's one-time offer: claimed once; a made-up or used id shows nothing to start.
        const got = await web.claim(start.offerId);
        if (!got) return setScreen({ kind: "error", key: "HM-WEB-02.gone" });
        return setScreen({ kind: "plan", recipe: got.recipe, values: withDefaults(got.recipe, got.values) });
      }
      if (start.kind === "recipe") {
        const recipe = (await web.recipes()).find((r) => r.id === start.id);
        if (!recipe) return setScreen({ kind: "error", key: "HM-WEB-02.gone" });
        return setScreen({ kind: "plan", recipe, values: withDefaults(recipe, {}) });
      }
      if (start.kind === "record") return setScreen({ kind: "address" });
      await showList();
    })();
    // Route params are read once, when the screen opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [web, status.kind]);

  const title = t("HM-WEB-02.title");
  switch (screen.kind) {
    case "loading":
      return <Page title={title}><Loading text={t("common.loading")} /></Page>;
    case "error":
      return <Page title={title}><Empty pose="idle" body={t(screen.key)} live /></Page>;
    case "list":
      return <RecipeList recipes={screen.recipes} kept={screen.kept} onRun={(r) => setScreen({ kind: "plan", recipe: r, values: withDefaults(r, {}) })}
        onRemove={async (r) => { await web!.remove(r.id); await showList(); }}
        onClear={async (o) => { await clearSiteData(o); await web!.cleared(o); await showList(); }}
        onRecord={() => setScreen({ kind: "address" })} />;
    case "plan":
      return <Plan recipe={screen.recipe} values={screen.values} onChange={(values) => setScreen({ ...screen, values })}
        onStart={() => setScreen({ kind: "task", recipe: screen.recipe, values: screen.values })} onCancel={() => router.back()} />;
    case "task":
      return <TaskRun recipe={screen.recipe} values={screen.values} onClose={() => router.back()} />;
    case "address":
      // Recording needs the WebView's web message channel; without it nothing can be recorded safely.
      if (!browserRecorder()) return <Page title={t("HM-WEB-02.record.title")}><Empty pose="idle" body={t("HM-WEB-02.record.unavailable")} live /></Page>;
      return <AddressInput onOpen={async (url) => {
        const r = await web!.record(url);
        if (r.ok) setScreen({ kind: "recording", startUrl: url, origin: r.origin });
        else setScreen({ kind: "error", key: r.reason === "not_https" ? "HM-WEB-02.record.badAddress" : "HM-WEB-02.end.refused.blocked" });
      }} />;
    case "recording":
      return <Recording startUrl={screen.startUrl} origin={screen.origin} onFinish={(events) => setScreen({ kind: "save", startUrl: screen.startUrl, events })} onCancel={() => router.back()} />;
    case "save":
      return <SaveForm startUrl={screen.startUrl} events={screen.events} onSaved={() => void showList()} />;
  }
}

/** The plan's values: what the user said, else the saved default. */
function withDefaults(recipe: Recipe, said: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const prm of recipe.params) {
    const v = said[prm.name] ?? prm.default;
    if (v) out[prm.name] = v;
  }
  return out;
}

function RecipeList(props: { recipes: Recipe[]; kept: string[]; onRun(r: Recipe): void; onRemove(r: Recipe): void; onClear(origin: string): void; onRecord(): void }) {
  return (
    <Page title={t("HM-WEB-02.listTitle")} subtitle={<T v="body" color="soft">{t("HM-WEB-02.listIntro")}</T>}>
      {props.recipes.length === 0 ? (
        <Empty pose="idle" body={t("HM-WEB-02.list.empty")}>
          <Btn label={t("HM-WEB-02.list.record")} icon="plus" full onPress={props.onRecord} />
        </Empty>
      ) : (
        <>
          {/* A tap opens the plan, where Start is; removing stays one tap away, at the row's end, as its own button
              (beside the row's pressable part, not inside it, so TalkBack reaches both). */}
          <Group lead="tile">
            {props.recipes.map((r) => <RecipeRow key={r.id} recipe={r} onRun={() => props.onRun(r)} onRemove={() => props.onRemove(r)} />)}
          </Group>
          <View style={{ marginTop: s.lg }}><Btn label={t("HM-WEB-02.list.record")} kind="secondary" icon="plus" full onPress={props.onRecord} /></View>
        </>
      )}
      <Label>{t("HM-WEB-02.list.sites")}</Label>
      {props.kept.length === 0 ? (
        <T v="footnote" color="soft" style={{ paddingHorizontal: s.lg }}>{t("HM-WEB-02.list.noSites")}</T>
      ) : (
        <Group>
          {props.kept.map((o) => (
            <Row
              key={o}
              icon="cookie"
              iconColor="soft"
              title={siteOf(o)}
              trailing={<IconBtn icon="trash-2" label={t("HM-WEB-02.list.clear", { site: siteOf(o) })} tone="textSoft" onPress={() => props.onClear(o)} />}
            />
          ))}
        </Group>
      )}
    </Page>
  );
}

function RecipeRow({ recipe: r, onRun, onRemove }: { recipe: Recipe; onRun(): void; onRemove(): void }) {
  const p = usePalette();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", paddingRight: s.xs }}>
      <Pressable
        onPress={onRun}
        accessibilityRole="button"
        accessibilityLabel={t("HM-WEB-02.list.runLabel", { name: r.name })}
        style={({ pressed }) => ({ flex: 1, flexDirection: "row", alignItems: "center", gap: s.md, minHeight: 56, paddingVertical: s.md, paddingLeft: s.lg, paddingRight: s.sm, backgroundColor: pressed ? p.pressed : "transparent" })}
      >
        <Tile icon="globe" />
        <View style={{ flex: 1, gap: 2 }}>
          <T v="bodyStrong">{r.name}</T>
          <T v="small" color="soft">{siteOf(r.origin)}</T>
        </View>
      </Pressable>
      <IconBtn icon="trash-2" label={t("HM-WEB-02.list.removeLabel", { name: r.name })} tone="textSoft" onPress={onRemove} />
    </View>
  );
}

/** Steps in Hermit's words, numbered in tonal circles; a step the user pays in is amber (Q121). */
function StepList({ steps }: { steps: Array<{ text: string; pay?: boolean }> }) {
  const p = usePalette();
  return (
    <View style={{ gap: s.md, paddingHorizontal: s.lg }}>
      {steps.map((st, i) => (
        <View key={i} style={{ flexDirection: "row", gap: s.md, alignItems: "flex-start" }}>
          <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: st.pay ? p.amberTint : p.accentTint, alignItems: "center", justifyContent: "center" }} accessible={false}>
            <T v="captionStrong" color={st.pay ? "amber" : "accent"} tabular>{String(i + 1)}</T>
          </View>
          <T v="body" color={st.pay ? "amber" : "text"} style={{ flex: 1, paddingTop: 2 }}>{st.text}</T>
        </View>
      ))}
    </View>
  );
}

function Plan(props: { recipe: Recipe; values: Record<string, string>; onChange(v: Record<string, string>): void; onStart(): void; onCancel(): void }) {
  const r = props.recipe;
  // The plan in words is the runner's own wording of each step, with these values; never anything a page said.
  const steps = r.steps.map((s) => stepWords(r, s, props.values));
  const missing = r.params.filter((x) => x.required && !props.values[x.name]?.trim()).map((x) => x.name);
  // Q121: Hermit never pays on a site; a pay step is the user's own, in amber, and said up front.
  const payStep = (key: string) => key === "HM-WEB-02.step.pay";
  const pays = steps.some((st) => payStep(st.key));
  return (
    <Page
      title={r.name}
      subtitle={<T v="body" color="soft">{`${t("HM-WEB-02.plan.site", { site: siteOf(r.origin) })} · ${t(`HM-WEB-02.kind.${r.kind}`)}`}</T>}
      footer={
        <Footer>
          <View style={{ flex: 1, minWidth: 140 }}><Btn label={t("HM-WEB-02.plan.cancel")} kind="secondary" full onPress={props.onCancel} /></View>
          <View style={{ flex: 1, minWidth: 140 }}><Btn label={t("HM-WEB-02.plan.start")} icon="play" full disabled={missing.length > 0} onPress={props.onStart} /></View>
        </Footer>
      }
    >
      {r.params.length ? (
        <View style={{ gap: s.lg }}>
          {r.params.map((prm) =>
            prm.kind === "choice" && prm.options ? (
              <View key={prm.name} style={{ gap: s.sm }}>
                <T v="footnoteStrong" color="soft" style={{ paddingHorizontal: s.lg }}>{prm.label}</T>
                <ChoiceList choices={prm.options.map((o) => ({ value: o, label: o }))} selected={props.values[prm.name] ?? ""} onChoose={(v) => props.onChange({ ...props.values, [prm.name]: v })} />
              </View>
            ) : (
              <Input
                key={prm.name}
                label={prm.label}
                value={props.values[prm.name] ?? ""}
                onChange={(v) => props.onChange({ ...props.values, [prm.name]: v })}
                numeric={prm.kind === "number"}
                invalid={missing.includes(prm.name)}
              />
            ),
          )}
        </View>
      ) : null}
      <SignInWith recipe={r} />
      <Label style={r.params.length ? undefined : { marginTop: 0 }}>{t("HM-WEB-02.plan.steps")}</Label>
      <StepList steps={steps.map((st) => ({ text: t(st.key, st.vars), pay: payStep(st.key) }))} />
      {pays ? (
        <Card tone="amber" style={{ marginTop: s.xl, gap: s.xs }}>
          <Note icon="hand-coins" tone="amber" text={t("HM-WEB-02.plan.youPay")} textColor="text" v="bodyStrong" />
          <T v="small" color="soft">{t("HM-WEB-02.plan.note")}</T>
        </Card>
      ) : (
        <View style={{ marginTop: s.xl, paddingHorizontal: s.lg }}>
          <Note icon="shield-check" text={t("HM-WEB-02.plan.note")} />
        </View>
      )}
      {missing.length ? <T v="small" color="coral" live="polite" style={{ marginTop: s.md, paddingHorizontal: s.lg }}>{t("HM-WEB-02.plan.missing", { field: r.params.find((x) => x.name === missing[0])?.label ?? missing[0]! })}</T> : null}
    </Page>
  );
}

/**
 * SL-56: which vault login the sign-in step uses on this exact site. Names only, never a value. With several, the
 * user's tap picks one (kept per site); until then the user signs in on the page themselves.
 */
function SignInWith(props: { recipe: Recipe }) {
  const { status } = useHermit();
  const web = status.kind === "ready" ? status.hermit.web : undefined;
  const origin = props.recipe.origin;
  const [logins, setLogins] = useState<SiteLogins | undefined>();
  const hasLogin = props.recipe.steps.some((s) => s.op === "login");
  useEffect(() => {
    if (!web || !hasLogin) return;
    void web.loginsFor(origin).then(setLogins);
  }, [web, origin, hasLogin]);
  const view = loginPicker(props.recipe, logins, t("HM-WEB-02.plan.signInMyself"));
  if (view.kind === "none") return null;
  return (
    <View>
      <Label>{t("HM-WEB-02.plan.signInWith")}</Label>
      <View style={{ gap: s.sm }}>
        {view.kind === "yourself" ? <T v="small" color="soft" style={{ paddingHorizontal: s.lg }}>{t("HM-WEB-02.plan.signInNone")}</T> : null}
        {view.kind === "one" ? (
          <Group><Row icon="key-round" title={t("HM-WEB-02.plan.signInOne", { name: view.name })} /></Group>
        ) : null}
        {view.kind === "pick" ? (
          <>
            <T v="small" color="soft" style={{ paddingHorizontal: s.lg }}>{t("HM-WEB-02.plan.signInPick")}</T>
            <ChoiceList choices={view.choices} selected={view.selected} onChoose={async (v) => {
              if (!web) return;
              await web.chooseLogin(origin, v === SIGN_IN_MYSELF ? undefined : v);
              setLogins(await web.loginsFor(origin));
            }} />
          </>
        ) : null}
      </View>
    </View>
  );
}

/** The native page with its events wired to the port, the host counter and the recorder. */
function useLivePage(origin: string, opts: { recording?: boolean; onRecord?(json: string): void } = {}) {
  const ref = useRef<HermitBrowserViewRef>(null);
  const port = useMemo(
    () => createBrowserPort({
      load: (url) => ref.current?.load(url) ?? Promise.resolve(false),
      evaluate: (s) => ref.current?.evaluate(s) ?? Promise.resolve("null"),
      currentUrl: () => ref.current?.currentUrl() ?? Promise.resolve(""),
    }, timing),
    [],
  );
  const onBrowserEvent = useCallback((e: { nativeEvent: BrowserNativeEvent }) => {
    const ev = e.nativeEvent;
    if (ev.type === "request") return countBrowserRequest(ev.url);
    if (ev.type === "record") return ev.event ? opts.onRecord?.(ev.event) : undefined;
    port.onEvent({ type: ev.type, url: ev.url });
    // The native view puts a fresh token of its own into the recorder and accepts only messages that carry it.
    if (ev.type === "load" && opts.recording) void ref.current?.injectRecorder(RECORDER_SCRIPT).catch(() => false);
  }, [port, opts]);
  const NativePage = HermitBrowserView!;
  const view = <NativePage ref={ref} style={{ flex: 1 }} profile={siteProfile(origin)} allowedOrigin={origin} recording={opts.recording ?? false} onBrowserEvent={onBrowserEvent} />;
  return { ref, port, view };
}

/** After a task or a recording, the site's data goes unless the user keeps it (US-WEB-06). */
function useClearOnLeave(origin: string) {
  const { status } = useHermit();
  const web = status.kind === "ready" ? status.hermit.web : undefined;
  useEffect(() => () => {
    void (async () => {
      const kept = web && browserMultiProfile() ? await web.keptSites() : [];
      if (!kept.includes(origin)) await clearSiteData(origin);
    })();
  }, [web, origin]);
}

function TaskRun(props: { recipe: Recipe; values: Record<string, string>; onClose(): void }) {
  const router = useRouter();
  const p = usePalette();
  const { status } = useHermit();
  const web = status.kind === "ready" ? status.hermit.web : undefined;
  const origin = props.recipe.origin;
  const site = siteOf(origin);
  const { port, view } = useLivePage(origin);
  const [state, setState] = useState<WebTaskState>({ kind: "ready" });
  const [kept, setKept] = useState(false);
  const [note, setNote] = useState<string | undefined>();
  const task = useRef<WebTask | undefined>(undefined);
  useClearOnLeave(origin);

  useEffect(() => {
    if (!web) return;
    const tk = web.task(props.recipe, port);
    task.current = tk;
    const off = tk.subscribe(setState);
    void web.keptSites().then((k) => setKept(k.includes(origin)));
    void tk.start(props.values);
    return () => {
      off();
      tk.stop();
    };
  }, [web, port, props.recipe, props.values, origin]);

  const line = liveLine(state);
  const end: WebTaskEnd | undefined = state.kind === "finished" ? state.end : undefined;
  const fix = end?.kind === "done" && end.repaired > 0 ? task.current?.repairedRecipe() : undefined;
  const paused = state.kind === "paused" ? state : undefined;
  const pause = paused ? PAUSE_LOOK[paused.reason] ?? { icon: "hand" as IconName } : undefined;
  // B2: the crab and one line say who drives the page; the page sits in a sea-glass ring while Hermit drives it.
  const pose: Pose = end ? (end.kind === "done" ? "done" : end.kind === "stopped" ? "idle" : "blocked") : paused ? "asking" : "working";
  const chip = end ? t("HM-WEB-02.live.finished", { site }) : paused ? t("HM-WEB-02.live.paused", { site }) : t("HM-WEB-02.live.driving", { site });
  const footer = end ? (
    // Outside the scrolling receipt, so Close is always on screen however long the site's answer is.
    <Footer><View style={{ flex: 1 }}><Btn label={t("HM-WEB-02.end.close")} full onPress={props.onClose} /></View></Footer>
  ) : paused ? (
    // B3: a handoff panel: a sheet's edge over the page, the reason in amber words, Resume and Stop. Never an error tone.
    <View style={{ backgroundColor: p.overlay, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, boxShadow: shadow(p, "overlay"), paddingHorizontal: s.xl, paddingTop: s.xl, paddingBottom: s.lg, gap: s.md }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: s.sm }}>
        <Icon name={pause!.icon} size={20} color={p.amber} />
        <T v="footnoteStrong" color="amber" style={{ flex: 1 }}>{t("HM-WEB-02.paused.yourTurn")}</T>
        {line ? <T v="footnote" color="soft" tabular>{t("HM-WEB-02.live.stepOf", { n: line.vars.n!, total: line.vars.total! })}</T> : null}
      </View>
      {pause!.title ? <T v="title">{t(pause!.title)}</T> : null}
      <T v="body" color="soft" live="assertive">{t(`HM-WEB-02.paused.${paused!.reason}`)}</T>
      <View style={{ flexDirection: "row", gap: s.sm, flexWrap: "wrap" }}>
        <View style={{ flex: 1, minWidth: 130 }}><Btn label={t("HM-WEB-02.live.stop")} kind="secondary" full onPress={() => task.current?.stop()} /></View>
        <View style={{ flex: 1, minWidth: 130 }}><Btn label={t("HM-WEB-02.live.resume")} icon="play" full onPress={() => task.current?.resume()} /></View>
      </View>
    </View>
  ) : (
    // B2: the crab beside the step it is on says who drives; Take over and Stop are always one tap away.
    <Footer>
      <View style={{ width: "100%", flexDirection: "row", gap: s.md, alignItems: "center", marginBottom: s.xs }}>
        <Mascot state={pose} dark={p.dark} width={36} />
        <T v="body" style={{ flex: 1 }} live="polite">
          {state.kind === "ready" ? t("HM-WEB-02.live.starting", { site }) : line && state.kind === "running" ? t(line.key, { ...line.vars, doing: t(state.doing.key, state.doing.vars) }) : ""}
        </T>
      </View>
      <View style={{ flex: 1, minWidth: 130 }}><Btn label={t("HM-WEB-02.live.takeOver")} kind="secondary" full onPress={() => task.current?.takeOver()} /></View>
      <View style={{ flex: 1, minWidth: 130 }}><Btn label={t("HM-WEB-02.live.stop")} kind="secondary" full onPress={() => task.current?.stop()} /></View>
    </Footer>
  );
  return (
    <Page title={chip} compact scroll={false} footer={footer}>
      {end ? (
        // B4: the receipt: how it ended, what the site said as a quote marked untrusted, the cookie outcome (Q122).
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: s.lg, gap: s.lg }}>
          <View style={{ alignItems: "center", gap: s.sm, paddingVertical: s.md }}>
            <Mascot state={pose} dark={p.dark} width={96} />
            <T v="display" center live="polite">{t(endKey(end))}</T>
            <T v="small" color="soft" center>{props.recipe.name}</T>
          </View>
          {end.kind === "done" && end.answer ? (
            <View style={{ gap: s.sm }}>
              <T v="footnoteStrong" color="soft" style={{ paddingHorizontal: s.lg }}>{t("HM-WEB-02.end.answer")}</T>
              <View style={{ backgroundColor: p.sunken, borderRadius: radius.field, padding: s.lg }}>
                <T v="body" selectable>{quoted(end.answer.text)}</T>
              </View>
              <View style={{ paddingHorizontal: s.lg }}><Note icon="shield-alert" tone="amber" text={t("HM-WEB-02.end.untrusted")} /></View>
            </View>
          ) : null}
          {fix && web ? (
            <Card style={{ gap: s.sm }}>
              <T v="small" color="soft">{tCount("HM-WEB-02.end.fixHint", end.kind === "done" ? end.repaired : 0)}</T>
              <Btn label={t("HM-WEB-02.end.saveFix")} kind="secondary" icon="refresh-cw" onPress={async () => setNote((await web.saveFix(fix)).ok ? "HM-WEB-02.end.fixSaved" : "HM-WEB-02.save.error.not_yours")} />
            </Card>
          ) : null}
          <Group>
            {browserMultiProfile() ? (
              <Row icon="cookie" title={t("HM-WEB-02.end.keep", { site })} sub={t("HM-WEB-02.end.keepHint")} top
                trailing={<Toggle on={kept} label={t("HM-WEB-02.end.keep", { site })} onChange={async (on) => { setKept(on); await web?.keepSignedIn(origin, on); }} />} />
            ) : <Row icon="cookie" title={t("HM-WEB-02.sharedProfile")} />}
            <Row icon="shield-check" title={t("HM-WEB-02.end.inActivity")} sub={t("HM-WEB-02.end.inActivitySub")} chevron role="link" onPress={() => router.push("/activity")} />
          </Group>
          <Btn label={t("HM-WEB-02.end.clear", { site })} kind="coralOutline" icon="trash-2" full onPress={async () => { await clearSiteData(origin); await web?.cleared(origin); setKept(false); setNote("HM-WEB-02.end.cleared"); }} />
          {note ? <T v="small" color="soft" live="polite" style={{ paddingHorizontal: s.lg }}>{t(note)}</T> : null}
        </ScrollView>
      ) : null}
      {/* The live page stays mounted until the screen closes; at the end it gives its room to the receipt. While
          Hermit drives, the page sits in a sea-glass ring; on the user's turn the ring goes quiet. */}
      <View style={end ? { height: 0, overflow: "hidden" } : { flex: 1, marginTop: s.xs, marginBottom: s.sm, borderRadius: radius.card, borderWidth: paused ? 1 : 2, borderColor: paused ? p.hairline : p.mark, overflow: "hidden" }}>
        {view}
      </View>
    </Page>
  );
}

/** B3: the handoff panel's icon and title by why Hermit paused; the reason itself is today's copy. */
const PAUSE_LOOK: Record<string, { icon: IconName; title?: string }> = {
  pay_yourself: { icon: "hand-coins", title: "HM-WEB-02.paused.payTitle" },
  code_wait: { icon: "message-square", title: "HM-WEB-02.paused.codeTitle" },
  verify_yourself: { icon: "shield-question", title: "HM-WEB-02.paused.captchaTitle" },
  take_over: { icon: "hand" },
  sign_in_yourself: { icon: "log-in" },
  type_yourself: { icon: "keyboard" },
  do_step: { icon: "mouse-pointer-click" },
  check_sign_in: { icon: "log-in" },
};

function AddressInput(props: { onOpen(url: string): void }) {
  const [text, setText] = useState("");
  const [bad, setBad] = useState(false);
  const open = () => {
    const url = recordAddress(text);
    if (url) props.onOpen(url);
    else setBad(true);
  };
  return (
    <Page
      title={t("HM-WEB-02.record.title")}
      subtitle={<T v="body" color="soft">{t("HM-WEB-02.record.hint")}</T>}
      footer={<Footer><View style={{ flex: 1 }}><Btn label={t("HM-WEB-02.record.open")} full onPress={open} /></View></Footer>}
    >
      <Input
        label={t("HM-WEB-02.record.address")}
        value={text}
        onChange={(v) => { setText(v); setBad(false); }}
        mono
        invalid={bad}
        field={{ placeholder: "https://", keyboardType: "url", onSubmitEditing: open }}
      />
      {bad ? <T v="small" color="coral" live="polite" style={{ marginTop: s.sm, paddingHorizontal: s.lg }}>{t("HM-WEB-02.record.badAddress")}</T> : null}
    </Page>
  );
}

function Recording(props: { startUrl: string; origin: string; onFinish(events: RecordedEvent[]): void; onCancel(): void }) {
  const p = usePalette();
  const events = useRef<RecordedEvent[]>([]);
  const [count, setCount] = useState(0);
  const onRecord = useCallback((json: string) => {
    const ev = recordedEvent(json, classifyClick);
    if (!ev) return;
    events.current.push(ev);
    setCount(events.current.length);
  }, []);
  const opts = useMemo(() => ({ recording: true, onRecord }), [onRecord]);
  const { port, view } = useLivePage(props.origin, opts);
  useClearOnLeave(props.origin);
  useEffect(() => {
    void port.open(props.startUrl);
  }, [port, props.startUrl]);
  return (
    <Page
      title={t("HM-WEB-02.record.title")}
      compact
      scroll={false}
      footer={
        <Footer>
          <View style={{ width: "100%", gap: 2, marginBottom: s.xs }}>
            <T v="bodyStrong" live="polite">{t("HM-WEB-02.record.count", { count: String(count) })}</T>
            <T v="footnote" color="soft">{t("HM-WEB-02.record.hint")}</T>
          </View>
          <View style={{ flex: 1, minWidth: 130 }}><Btn label={t("HM-WEB-02.plan.cancel")} kind="secondary" full onPress={props.onCancel} /></View>
          <View style={{ flex: 1, minWidth: 130 }}><Btn label={t("HM-WEB-02.record.finish")} full onPress={() => props.onFinish([...events.current])} /></View>
        </Footer>
      }
    >
      {/* The user drives while recording: the page in a quiet ring, never Hermit's sea glass. */}
      <View style={{ flex: 1, marginTop: s.xs, marginBottom: s.sm, borderRadius: radius.card, borderWidth: 1, borderColor: p.hairline, overflow: "hidden" }}>
        {view}
      </View>
    </Page>
  );
}

function SaveForm(props: { startUrl: string; events: RecordedEvent[]; onSaved(): void }) {
  const { status } = useHermit();
  const web = status.kind === "ready" ? status.hermit.web : undefined;
  const [name, setName] = useState("");
  const [kind, setKind] = useState<TaskKind>("reorder");
  const [fixed, setFixed] = useState<string[]>([]);
  const [question, setQuestion] = useState("");
  const [error, setError] = useState<string | undefined>();
  // The values the draft would ask each time, named as the recipe will name them.
  const preview = useMemo(() => draftRecipe({ startUrl: props.startUrl, events: props.events, name: "preview", kind, now: 0, id: "preview" }), [props.startUrl, props.events, kind]);
  const params = preview.ok ? preview.recipe.params : [];
  const steps = useMemo(() => recordedSteps(props.events), [props.events]);
  const site = (originOf(props.startUrl) ?? props.startUrl).replace(/^https:\/\//, "");
  const save = async () => {
    if (!name.trim()) return setError("HM-WEB-02.save.error.name");
    const r = await web!.save({ startUrl: props.startUrl, events: props.events, name, kind, fixed, ...(question.trim() ? { question } : {}) });
    if (r.ok) props.onSaved();
    else setError(`HM-WEB-02.save.error.${r.reason}`);
  };
  return (
    <Page
      title={t("HM-WEB-02.save.title")}
      subtitle={<T v="body" color="soft">{t("HM-WEB-02.save.steps", { site })}</T>}
      footer={<Footer><View style={{ flex: 1 }}><Btn label={t("HM-WEB-02.save.save")} full onPress={() => void save()} /></View></Footer>}
    >
      {/* Every recorded step for the user to check before Save: the site, the kind, the element and the value, secrets masked. */}
      {steps.length ? (
        <StepList steps={steps.map((st) => ({ text: t(st.key, { ...st.vars, role: t(st.roleKey) }), pay: st.key === "HM-WEB-02.save.step.pay" }))} />
      ) : (
        <T v="small" color="soft" style={{ paddingHorizontal: s.lg }}>{t("HM-WEB-02.save.noSteps")}</T>
      )}
      <View style={{ marginTop: s.xl }}>
        <Input label={t("HM-WEB-02.save.name")} value={name} onChange={setName} field={{ placeholder: t("HM-WEB-02.save.namePlaceholder"), maxLength: 60, autoCapitalize: "sentences", autoCorrect: true }} />
      </View>
      <Label>{t("HM-WEB-02.save.kind")}</Label>
      <ChoiceList<TaskKind> choices={TASK_KINDS.map((k) => ({ value: k, label: t(`HM-WEB-02.kind.${k}`) }))} selected={kind} onChoose={setKind} />
      {params.length ? (
        <>
          <Label>{t("HM-WEB-02.save.values")}</Label>
          <Group>
            {params.map((prm) => (
              <Row
                key={prm.name}
                title={t("HM-WEB-02.save.ask", { field: prm.label })}
                sub={t("HM-WEB-02.save.askHint", { value: prm.default ?? "" })}
                top
                trailing={<Toggle on={!fixed.includes(prm.name)} label={t("HM-WEB-02.save.ask", { field: prm.label })} onChange={(ask) => setFixed((f) => (ask ? f.filter((x) => x !== prm.name) : [...f, prm.name]))} />}
              />
            ))}
          </Group>
        </>
      ) : null}
      <View style={{ marginTop: s.xl }}>
        <Input label={t("HM-WEB-02.save.question")} value={question} onChange={setQuestion} field={{ placeholder: t("HM-WEB-02.save.questionPlaceholder"), maxLength: 200, autoCapitalize: "sentences", autoCorrect: true }} />
      </View>
      {error ? <T v="small" color="coral" live="polite" style={{ marginTop: s.md, paddingHorizontal: s.lg }}>{t(error)}</T> : null}
    </Page>
  );
}
