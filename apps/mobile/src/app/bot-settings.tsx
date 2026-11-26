// HM-BOT-04: one bot's settings (/bot-settings?bot=<id>): its role, look, permissions in plain words, sources, mode and
// notes (its own and the ones every bot shares), then notifications, pin, hide, duplicate, reset and delete. Hermit's
// own are shorter: it holds everything this phone allows, and it is never duplicated, hidden or deleted. A change the
// runtime refuses says why in code's words (HM-BOT-04.refused.*); the fingerprint is asked by the runtime when a
// permission or a mode needs it, and the Save button says so beforehand.
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { AccessibilityInfo, View } from "react-native";
import { MAX_BOT_NAME_CHARS } from "@hermit/core/bots";
import { HERMIT_BOT_ID, type Bot, type MemoryCursor, type Note as Fact, type PermissionMode } from "@hermit/core";
import { formNeedsFingerprint, formPatch, formProblems, fromBot, noteActions, settingsResult, type BotForm } from "../bot-form-view";
import { forgetBotCaches } from "../adapters";
import { BotAvatar } from "../components/BotAvatar";
import { ConfirmSheet, ConnectorsList, GroupsList, LookPicker, Refusal, modeLine, useSourceChoices } from "../components/BotFormParts";
import { ModeSheet } from "../components/ModeSheet";
import { Btn, Chip, Failed, Footer, Group, Input, Label, Loading, Note, Notice, Page, Row, T } from "../components/kit";
import { useHermit } from "../hermit-context";
import { quoted, when } from "../format";
import { currentLocale, t } from "../i18n";
import { s } from "../theme";
import { usePalette } from "../use-palette";

type Screen = { kind: "loading" } | { kind: "error" } | { kind: "gone" } | { kind: "ready"; bot: Bot; base: BotForm; form: BotForm };
type Confirm = { kind: "reset" } | { kind: "delete" } | { kind: "note"; id: number };

export default function BotSettings() {
  const p = usePalette();
  const router = useRouter();
  const { status } = useHermit();
  const hermit = status.kind === "ready" ? status.hermit : undefined;
  const sessions = status.kind === "ready" ? status.sessions : undefined;
  const { bot: param } = useLocalSearchParams<{ bot?: string }>();
  const botId = typeof param === "string" && param ? param : HERMIT_BOT_ID;
  const [screen, setScreen] = useState<Screen>({ kind: "loading" });
  const [globalMode, setGlobalMode] = useState<PermissionMode>("ask");
  const [notes, setNotes] = useState<Fact[]>([]);
  const [notesState, setNotesState] = useState<"loading" | "ok" | "failed">("loading");
  const [more, setMore] = useState<MemoryCursor>();
  const [modeOpen, setModeOpen] = useState(false);
  const [confirm, setConfirm] = useState<Confirm>();
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string>();
  const [flash, setFlash] = useState<"saved" | "reset">();
  const choices = useSourceChoices();

  const load = useCallback(async () => {
    if (!hermit) return;
    try {
      const bot = await hermit.bots.get(botId);
      if (!bot) return setScreen({ kind: "gone" });
      const base = fromBot(bot);
      setScreen({ kind: "ready", bot, base, form: base });
      setGlobalMode(await hermit.modes.global().catch(() => "ask" as const));
    } catch {
      setScreen({ kind: "error" });
    }
  }, [hermit, botId]);
  const loadNotes = useCallback(async (after?: MemoryCursor) => {
    if (!hermit) return;
    try {
      const page = await hermit.bots.notes(botId, after ? { after } : undefined);
      setNotes((old) => (after ? [...old, ...page.notes] : page.notes));
      setMore(page.next);
      setNotesState("ok");
    } catch {
      setNotesState("failed");
    }
  }, [hermit, botId]);
  useEffect(() => {
    void load();
    void loadNotes();
  }, [load, loadNotes]);
  useEffect(() => {
    if (status.kind === "failed") setScreen({ kind: "error" });
  }, [status]);

  // The result is pinned above the footer (the actions are far down the page) and spoken for TalkBack. A refusal names
  // the bot it is about (a busy bot is this one).
  const result = settingsResult(refused, flash, screen.kind === "ready" ? screen.bot.name : "");
  const resultText = result ? t(result.key, result.vars) : undefined;
  useEffect(() => {
    if (resultText) AccessibilityInfo.announceForAccessibility(resultText);
  }, [resultText]);

  /** The bot read again after a change that isn't a field (pin, hide, mode): what the user is typing stays. */
  const refresh = useCallback(async () => {
    if (!hermit) return;
    const bot = await hermit.bots.get(botId);
    if (!bot) return setScreen({ kind: "gone" });
    setScreen((old) => (old.kind === "ready" ? { kind: "ready", bot, base: { ...old.base, mode: bot.mode }, form: { ...old.form, mode: bot.mode } } : old));
  }, [hermit, botId]);

  type Done = { kind: "done"; bot?: Bot; sessionId?: string };
  /** Runs one change; a refusal shows its words, a done change reads the bot again unless `then` takes over. */
  const run = async (change: () => Promise<Done | { kind: "refused"; reason: string }>, then?: (r: Done) => void | Promise<void>) => {
    setBusy(true);
    setRefused(undefined);
    setFlash(undefined);
    try {
      const r = await change();
      if (r.kind === "refused") return setRefused(r.reason);
      if (then) await then(r);
      else await refresh();
    } catch {
      // A change that threw failed; it isn't passed off as a busy bot.
      setRefused("failed");
    } finally {
      setBusy(false);
    }
  };

  if (screen.kind === "loading") {
    return (
      <Page title={t("HM-BOT-04.title")}>
        <Loading text={t("HM-BOT-04.loading")} />
      </Page>
    );
  }
  if (screen.kind === "error") {
    return (
      <Page title={t("HM-BOT-04.title")}>
        <Failed text={t("HM-BOT-04.failed")} onRetry={() => { setScreen({ kind: "loading" }); void load(); void loadNotes(); }} />
      </Page>
    );
  }
  if (screen.kind === "gone") {
    return (
      <Page title={t("HM-BOT-04.title")}>
        <T v="body" color="soft">{t("HM-BOT-04.gone")}</T>
      </Page>
    );
  }

  const { bot, base, form } = screen;
  const hermitBot = bot.primary;
  const edit = (patch: Partial<BotForm>) => {
    setRefused(undefined);
    setFlash(undefined);
    setScreen({ ...screen, form: { ...form, ...patch } });
  };
  const patch = formPatch(form, base);
  const dirty = Object.keys(patch).length > 0;
  const problems = formProblems(form);
  const needsFinger = formNeedsFingerprint(form, { grants: base.grants, mode: form.mode });
  const mode = modeLine(bot.mode, globalMode);
  const now = Date.now();

  const save = () =>
    void run(() => hermit!.bots.update(bot.id, patch), (r) => {
      if (r.bot) {
        const saved = fromBot(r.bot);
        setScreen({ kind: "ready", bot: r.bot, base: saved, form: saved });
      }
      setFlash("saved");
    });
  const setMode = (next: PermissionMode | null, typed?: string) =>
    void run(async () => {
      const r = await hermit!.modes.setBot(bot.id, next, typed ? { typed } : undefined);
      return r === "set" ? { kind: "done" as const } : { kind: "refused" as const, reason: r };
    });
  const doConfirmed = () => {
    const c = confirm;
    if (!c) return;
    if (c.kind === "note") {
      void run(async () => ((await hermit!.bots.deleteNote(bot.id, c.id)) ? { kind: "done" as const } : { kind: "refused" as const, reason: "not_found" }), () => void loadNotes());
    } else if (c.kind === "reset") {
      // The same act as the chat menu's clear: the bot's chat goes on in the fresh session the reset made.
      void run(() => sessions!.clear(bot.id), () => setFlash("reset"));
    } else {
      void run(() => hermit!.bots.remove(bot.id), () => {
        sessions?.forget(bot.id);
        // Its prompt caches hold its conversation: they go with its chats and notes (a failure is logged; the next load sweeps).
        void forgetBotCaches(bot.id, "delete");
        router.dismissAll();
      });
    }
    setConfirm(undefined);
  };

  const noteRow = (n: Fact) => {
    const can = noteActions(n, hermitBot);
    const at = when(n.createdAt, now, currentLocale());
    return (
      <Row
        key={n.id}
        title={<T v="body" lines={4}>{n.tainted ? quoted(n.fact) : n.fact}</T>}
        sub={
          <View style={{ gap: s.xs }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: s.sm, flexWrap: "wrap" }}>
              {n.shared ? <Chip label={t("HM-BOT-04.noteShared")} tone="hermit" /> : null}
              {n.tainted ? <Chip label={t("HM-MEM-01.fromMessage")} tone="amber" /> : null}
              <T v="footnote" color="soft">{t(at.key, at.vars)}</T>
            </View>
            {can.share || can.delete ? (
              <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: s.sm, marginLeft: -s.md }}>
                {can.share ? <Btn label={t("HM-BOT-04.noteShare")} kind="text" icon="user" small disabled={busy} onPress={() => void run(async () => ((await hermit!.bots.shareNote(bot.id, n.id)) ? { kind: "done" as const } : { kind: "refused" as const, reason: "not_found" }), () => void loadNotes())} /> : null}
                {can.delete ? <Btn label={t("HM-BOT-04.noteDelete")} kind="text" icon="trash-2" small disabled={busy} onPress={() => setConfirm({ kind: "note", id: n.id })} /> : null}
              </View>
            ) : null}
          </View>
        }
        a11y={`${n.fact}${n.shared ? `, ${t("HM-BOT-04.noteShared")}` : ""}`}
      />
    );
  };

  const confirmWords =
    confirm?.kind === "delete" ? { title: t("HM-BOT-04.deleteTitle", { name: bot.name }), body: t("HM-BOT-04.deleteBody"), confirm: t("HM-BOT-04.deleteConfirm") }
    : confirm?.kind === "reset" ? { title: t("HM-BOT-04.resetTitle"), body: t("HM-BOT-04.resetBody"), confirm: t("HM-BOT-04.reset") }
    : { title: t("HM-MEM-02.deleteTitle"), body: t("HM-MEM-02.deleteBody"), confirm: t("HM-BOT-04.noteDelete") };

  return (
    <Page
      title={bot.name}
      footer={
        dirty || result ? (
          <Footer>
            <View style={{ flex: 1, gap: s.sm }}>
              {result ? <Notice text={resultText!} tone={result.tone} /> : null}
              {dirty && needsFinger ? <Note icon="fingerprint" text={t("HM-BOT-03.fingerprintNote")} /> : null}
              {dirty ? <Btn label={t("HM-BOT-04.save")} icon="check" full disabled={problems.length > 0} busy={busy} onPress={save} /> : null}
            </View>
          </Footer>
        ) : undefined
      }
    >
      <View style={{ gap: s.lg }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: s.lg }}>
          <BotAvatar bot={{ primary: hermitBot, look: form.look, name: form.name || bot.name }} size={64} dark={p.dark} />
          {hermitBot ? (
            <T v="body" color="soft" style={{ flex: 1 }}>{t("HM-BOT-04.hermitRole")}</T>
          ) : (
            <Input label={t("HM-BOT-03.name")} value={form.name} onChange={(name) => edit({ name })} invalid={problems.includes("name_too_long") || problems.includes("name_empty")} style={{ flex: 1 }} field={{ autoCapitalize: "words", maxLength: MAX_BOT_NAME_CHARS }} />
          )}
        </View>
        {problems.includes("name_empty") ? <Refusal reason="name_empty" name={bot.name} /> : null}
        {problems.includes("name_too_long") ? <Refusal reason="name_too_long" name={bot.name} /> : null}

        {hermitBot ? null : (
          <>
            <View>
              <Label style={{ marginTop: 0 }}>{t("HM-BOT-03.look")}</Label>
              <LookPicker look={form.look} onChange={(look) => edit({ look })} />
            </View>
            <Input label={t("HM-BOT-03.role")} hint={t("HM-BOT-03.roleHint")} value={form.role} onChange={(role) => edit({ role })} invalid={problems.includes("role_too_long")} field={{ multiline: true, autoCapitalize: "sentences" }} />
            {problems.includes("role_too_long") ? <Refusal reason="role_too_long" name={bot.name} /> : null}
          </>
        )}

        <View>
          <Label style={{ marginTop: s.sm }}>{t("HM-BOT-03.permissions")}</Label>
          {hermitBot ? (
            <Group>
              <Row icon="shield-check" title={t("HM-BOT-04.groupAll")} />
            </Group>
          ) : (
            <>
              <T v="small" color="soft" style={{ paddingHorizontal: s.lg, marginBottom: s.md }}>{t("HM-BOT-03.permissionsHint")}</T>
              <GroupsList grants={form.grants} onChange={(grants) => edit({ grants })} />
            </>
          )}
        </View>

        {hermitBot ? null : (
          <View>
            <Label style={{ marginTop: s.sm }}>{t("HM-BOT-03.sources")}</Label>
            <T v="small" color="soft" style={{ paddingHorizontal: s.lg, marginBottom: s.md }}>{t("HM-BOT-03.sourcesHint")}</T>
            <View style={{ gap: s.lg }}>
              <Input label={t("HM-BOT-03.sites")} hint={t("HM-BOT-03.sitesHint")} value={form.sites} onChange={(sites) => edit({ sites })} invalid={problems.includes("bad_site")} mono field={{ multiline: true, keyboardType: "url" }} />
              {problems.includes("bad_site") ? <Refusal reason="bad_site" name={bot.name} /> : null}
              <View style={{ gap: s.sm }}>
                <T v="footnoteStrong" color="soft" style={{ paddingHorizontal: s.lg }}>{t("HM-BOT-03.connectors")}</T>
                <ConnectorsList choices={choices} on={form.connectors} onChange={(connectors) => edit({ connectors })} />
              </View>
            </View>
          </View>
        )}

        <View>
          <Label style={{ marginTop: s.sm }}>{t("HM-BOT-03.mode")}</Label>
          <Group>
            <Row title={mode.title} sub={mode.sub} chevron a11y={`${t("HM-BOT-03.mode")}: ${mode.title}. ${mode.sub}`} disabled={busy} onPress={() => setModeOpen(true)} />
          </Group>
        </View>

        <View>
          <Label style={{ marginTop: s.sm }}>{t("HM-BOT-04.notes")}</Label>
          <T v="small" color="soft" style={{ paddingHorizontal: s.lg, marginBottom: s.md }}>{t("HM-BOT-04.notesHint")}</T>
          {notesState === "failed" ? (
            <Failed text={t("HM-BOT-04.notesFailed")} onRetry={() => void loadNotes()} />
          ) : notesState === "loading" ? (
            <Loading text={t("HM-BOT-04.loading")} />
          ) : notes.length ? (
            <Group>{notes.map(noteRow)}</Group>
          ) : (
            <T v="small" color="soft" style={{ paddingHorizontal: s.lg }}>{t("HM-BOT-04.notesEmpty")}</T>
          )}
          {more ? <Btn label={t("HM-BOT-04.noteMore")} kind="text" onPress={() => void loadNotes(more)} /> : null}
        </View>

        <Group style={{ marginTop: s.sm }}>
          {/* Wave 2 adds `notify` to BotPatch and the Notifications row comes back (nothing runs in the background in wave 1). */}
          {hermitBot ? null : (
            <Row
              icon="pin"
              title={t(bot.pinOrder !== null ? "HM-BOT-01.unpin" : "HM-BOT-01.pin")}
              disabled={busy || (bot.hidden && bot.pinOrder === null)}
              onPress={() => void run(() => hermit!.bots.pin(bot.id, bot.pinOrder === null))}
            />
          )}
          {hermitBot ? null : (
            <Row icon={bot.hidden ? "eye" : "eye-off"} title={t(bot.hidden ? "HM-BOT-01.show" : "HM-BOT-01.hide")} disabled={busy} onPress={() => void run(() => hermit!.bots.hide(bot.id, !bot.hidden))} />
          )}
          {hermitBot ? null : (
            <Row
              icon="copy"
              title={t("HM-BOT-04.duplicate")}
              sub={t("HM-BOT-04.duplicateSub")}
              disabled={busy}
              onPress={() => void run(() => hermit!.bots.duplicate(bot.id), (r) => r.bot && router.replace({ pathname: "/bot-settings", params: { bot: r.bot.id } }))}
            />
          )}
          <Row icon="refresh-cw" title={t("HM-BOT-04.reset")} disabled={busy} onPress={() => setConfirm({ kind: "reset" })} />
        </Group>

        {hermitBot ? null : (
          <Group>
            <Row icon="trash-2" iconColor="coral" title={<T v="bodyStrong" color="coral">{t("HM-BOT-04.delete")}</T>} a11y={t("HM-BOT-04.delete")} disabled={busy} onPress={() => setConfirm({ kind: "delete" })} />
          </Group>
        )}
      </View>

      <ModeSheet open={modeOpen} current={bot.mode} global={globalMode} allowInherit onConfirm={setMode} onClose={() => setModeOpen(false)} />
      <ConfirmSheet visible={!!confirm} title={confirmWords.title} body={confirmWords.body} confirm={confirmWords.confirm} busy={busy} onConfirm={doConfirmed} onClose={() => setConfirm(undefined)} />
    </Page>
  );
}
