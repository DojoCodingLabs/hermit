// HM-CHAT-01: the chat (home). A quiet bar: the small crab and its status in words (C1); the first run stages the crab
// with Hermit's hello and three things to try; replies stream; each turn's steps fold into one line when it ends (C5);
// a confirmed payment is a receipt card (A6) and a payment a cap refused is a coral card (Q144). Bubbles: Hermit sea
// glass, you shell (Q146). New messages rise in; the steps fold with the layout (polish round, docs/design/polish).
import { Link, Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import { AccessibilityInfo, ActivityIndicator, Alert, Animated, FlatList, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View, type ViewStyle } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { outcomeCopyKey } from "@hermit/core";
import { chatReducer, continuable, initialChat, inputControl, replyBlocks, spokenAnnouncement, turnAnnouncement, type ChatItem, type ChatState, type TurnWork } from "@hermit/runtime";
type Reply = Extract<ChatItem, { kind: "assistant" }>;
type PaymentReceipt = NonNullable<Reply["receipt"]>;
import { useAppLock } from "../app-lock";
import { ApprovalSheet } from "../components/ApprovalSheet";
import { CrabHeader } from "../components/CrabHeader";
import { Icon, type IconName } from "../components/Icon";
import { Badge, Btn, Group, Label, LinkText, Row, Stage, T, Tile, typeStyle, WholeAddress } from "../components/kit";
import { Mascot } from "../components/Mascot";
import { MenuSheet } from "../components/MenuSheet";
import { ReplyText } from "../components/ReplyText";
import { CrossFade, Reveal, easeLayout, useMotion, usePress } from "../components/motion";
import { distance } from "../motion";
import { onModelLoading, requestContactsPermission } from "../adapters";
import { useHermit } from "../hermit-context";
import { hasCopy, t } from "../i18n";
import { mascotLabel, type Pose } from "../mascot";
import { endTurn, startTurn } from "../one-turn";
import { skillName } from "../skill-names";
import { radius, s, shadow } from "../theme";
import { usePalette } from "../use-palette";

let seq = 0;
const nextId = () => `m${++seq}`;

/** A step in words: what it is doing (HM-CHAT-01.doing.*) while it runs, the skill's name once done. */
const doingText = (skill: string) => t(hasCopy(`HM-CHAT-01.doing.${skill}`) ? `HM-CHAT-01.doing.${skill}` : "HM-CHAT-01.doing.intent");

export default function Chat() {
  const p = usePalette();
  const router = useRouter();
  const { status, approvals, clearConversation } = useHermit();
  const [chat, dispatch] = useReducer(chatReducer, initialChat);
  // US-CHAT-07: show the kept conversation (after a restart) or the empty one (after clearing).
  const sessionId = status.kind === "ready" ? status.sessionId : undefined;
  const hermit = status.kind === "ready" ? status.hermit : undefined;
  useEffect(() => {
    if (!hermit || !sessionId) return;
    let alive = true;
    void hermit.transcript(sessionId).then((r) => alive && dispatch({ type: "restore", ...r }), () => {});
    return () => {
      alive = false;
    };
  }, [hermit, sessionId]);

  const confirmClear = useCallback(() => {
    Alert.alert(t("HM-CHAT-01.clearTitle"), t("HM-CHAT-01.clearBody"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("HM-CHAT-01.clearConfirm"),
        style: "destructive",
        onPress: () => void clearConversation().catch(() => Alert.alert(t("HM-CHAT-01.clearFailed"))),
      },
    ]);
  }, [clearConversation]);
  // US-SET-07: TalkBack hears a reply once, whole, when the turn ends; the streaming bubble is not a live region.
  // While the app lock is engaged (US-SET-09) it hears only "Hermit replied", never the reply (spokenAnnouncement).
  const { lock } = useAppLock();
  const announcement = turnAnnouncement(chat);
  const announced = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!announcement || announced.current === announcement.id) return;
    announced.current = announcement.id;
    const spoken = spokenAnnouncement(announcement, lock);
    // Q155: a reply that stopped short is followed by its cut line, so it is never silent by ear either.
    AccessibilityInfo.announceForAccessibility("text" in spoken ? [spoken.text, ...(spoken.also ?? []).map((k) => t(k))].filter(Boolean).join(" ") : t(spoken.copyKey, { reason: "", permission: "" }));
  }, [announcement, lock]);
  const [draft, setDraft] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => onModelLoading((loading) => dispatch({ type: "model", loading })), []);
  const [onboarded, setOnboarded] = useState<boolean>();
  useEffect(() => {
    if (status.kind === "ready") void status.hermit.settings.get("onboarding.done").then((v) => setOnboarded(v !== undefined));
    else if (status.kind === "not_wired") setOnboarded(false);
  }, [status]);

  // The running turn's stop switch (US-CHAT-06): aborting it cancels generation and closes any open sheet as denied.
  const turn = useRef<AbortController | undefined>(undefined);
  const stop = useCallback(() => {
    if (!turn.current || turn.current.signal.aborted) return;
    dispatch({ type: "stop" });
    turn.current.abort();
  }, []);
  // Leaving the chat mid-turn stops the turn, so nothing is left waiting (EC-CHAT-06).
  useEffect(() => () => turn.current?.abort(), []);

  // Motion: a sent message and a finished answer ease the list into its new shape; new bubbles rise in (Bubble).
  const motion = useMotion();
  const streamed = useRef(false);
  // Q155: a long answer streams past the bottom of the screen. The list follows the newest words while the user is at
  // the end, and stays where they are once they scroll up to read; their own message always brings it back down.
  const list = useRef<FlatList<ChatItem>>(null);
  const atEnd = useRef(true);
  // W1: the content's last reported height, so a list that only got shorter can go back to its end.
  const contentHeight = useRef(0);
  const send = useCallback(async (said?: string) => {
    const text = (said ?? draft).trim();
    if (!text || chat.busy || status.kind !== "ready") return;
    // One turn at a time: `busy` comes with the next render, the slot at once (a second tap finds it held).
    const controller = startTurn(turn);
    if (!controller) return;
    if (said === undefined) setDraft("");
    streamed.current = false;
    atEnd.current = true;
    easeLayout(motion);
    dispatch({ type: "send", id: nextId(), text, at: Date.now() });
    const off = approvals.subscribe((r) => r && dispatch({ type: "approval_open" }));
    try {
      const view = await status.hermit.send(status.sessionId, text, {
        signal: controller.signal,
        onToken: (tok) => dispatch({ type: "token", text: tok }),
        onThinking: (tok) => dispatch({ type: "thinking", text: tok }),
        onEvent: (event) => {
          // Dev diagnostics: step kind and skill id only, never content.
          console.log(`[hermit] step ${event.kind} ${"skill" in event ? event.skill : ""} ${"ok" in event ? String(event.ok) : ""}`);
          dispatch({ type: "step", event });
        },
      });
      easeLayout(motion);
      dispatch({ type: "finished", id: nextId(), view, at: Date.now() });
      if (__DEV__) console.log(`[hermit:journey] turn ${view.kind}`);
    } catch {
      const outcome = controller.signal.aborted ? "stopped" : "model_error";
      dispatch({ type: "finished", id: nextId(), view: { kind: "outcome", outcome }, at: Date.now() });
      if (__DEV__) console.log(`[hermit:journey] turn ${outcome}`);
    } finally {
      off();
      endTurn(turn, controller);
    }
  }, [draft, chat.busy, status, approvals, motion]);

  // Q155, Seguir: only the user's tap starts it (never on its own); it runs like a turn, so the composer's Stop stops
  // it, and the next part streams into the same bubble. The runtime refuses anything but the latest cut reply. A
  // double tap starts it once: the slot is taken before anything else (review 2026-11-25).
  const goOn = useCallback(async (id: string) => {
    if (chat.busy || status.kind !== "ready") return;
    const controller = startTurn(turn);
    if (!controller) return;
    atEnd.current = true;
    easeLayout(motion);
    dispatch({ type: "continue", id, at: Date.now() });
    try {
      const view = await status.hermit.continueReply(status.sessionId, { signal: controller.signal, onToken: (tok) => dispatch({ type: "token", text: tok }) });
      easeLayout(motion);
      dispatch({ type: "continued", id, view, at: Date.now() });
    } catch {
      dispatch({ type: "continued", id, view: { kind: "outcome", outcome: "model_error" }, at: Date.now() });
    } finally {
      endTurn(turn, controller);
    }
  }, [chat.busy, status, motion]);

  // Dev builds only: hermit://?say=<text>&n=<nonce> sends a message as if typed, so the W1 journey script
  // (scripts/phone/w1-journey.sh) can drive the chat with accents adb can't type. Release builds ignore it;
  // anything that sends, pays or signs in still waits for the approval sheet and a fingerprint.
  const { say, n } = useLocalSearchParams<{ say?: string; n?: string }>();
  const said = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!__DEV__ || !say || status.kind !== "ready" || chat.busy) return;
    const key = `${n ?? ""}|${say}`;
    if (said.current === key) return;
    said.current = key;
    void send(String(say));
  }, [say, n, status, chat.busy, send]);

  const seconds = useElapsed(chat.busy ? chat.live?.startedAt : undefined);

  // SL-26: an interrupted erase finishes first (HM-SET-03 resumes it without asking again).
  if (status.kind === "erase_pending") return <Redirect href="/delete" />;
  if (onboarded === false) return <Redirect href="/welcome" />;

  const empty = chat.items.length === 0;
  const pose: Pose = empty && chat.mascot === "idle" && !chat.busy ? "hello" : chat.mascot;
  const canClear = !empty && !chat.busy;
  const head = headerStatus(chat);
  // Q155: the reply Seguir can continue now, if any.
  const goingOn = continuable(chat);
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: p.canvas }}>
      {/* The first run stages the crab in the page; the bar's small crab takes over once the conversation starts. */}
      <CrabHeader
        pose={pose}
        status={head}
        busy={chat.busy && chat.mascot !== "asking"}
        quiet={empty && !chat.busy}
        onCrab={() => router.push("/activity")}
        onMenu={() => setMenuOpen(true)}
      />

      {status.kind === "not_wired" ? (
        <View style={{ borderRadius: radius.field, backgroundColor: p.sunken, padding: s.md, marginHorizontal: s.gutter, marginBottom: s.sm }}>
          <T v="caption" color="soft">Dev build: {status.slices.join(", ")}</T>
        </View>
      ) : null}

      <FlatList
        ref={list}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: s.gutter, paddingTop: s.sm, paddingBottom: s.lg, flexGrow: 1, justifyContent: "flex-end" }}
        onScroll={(e) => {
          const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
          atEnd.current = contentSize.height - (contentOffset.y + layoutMeasurement.height) < 96;
        }}
        scrollEventThrottle={64}
        onContentSizeChange={(_w, h) => {
          contentHeight.current = h;
          // To the content's own height, which the list clamps to the end: scrollToEnd estimates from row measurements
          // that may not be in yet, and stopped short in the preview.
          if (atEnd.current) list.current?.scrollToOffset({ offset: h, animated: false });
        }}
        // W1: the list gets shorter with no new content (the keyboard opens, or the composer grows by its tainted line
        // when a turn that read messages ends): at the end, it stays at the end, so the newest reply isn't left under it.
        onLayout={() => {
          if (atEnd.current) list.current?.scrollToOffset({ offset: contentHeight.current, animated: false });
        }}
        data={chat.items}
        keyExtractor={(i) => i.id}
        renderItem={({ item, index }) => {
          // A streamed answer arrives once: the finished bubble that replaces the streaming one doesn't rise again.
          if (item.id === "streaming") streamed.current = true;
          const live = !item.id.startsWith("r") && !((item.kind === "assistant" || item.kind === "question") && item.id !== "streaming" && streamed.current);
          // A run from one speaker sits close (3 dp) and only its last bubble is tailed; speakers change 16 dp apart.
          const prev = chat.items[index - 1];
          const next = chat.items[index + 1];
          const gap = !prev ? 0 : speaker(prev) === speaker(item) ? 3 : s.lg;
          const tail = !next || speaker(next) !== speaker(item) || (chat.busy && index === chat.items.length - 1);
          const bubbleItem = <Bubble item={item} tail={tail} {...(chat.busy ? {} : { onChoose: (text: string) => void send(text) })} {...(item.id === goingOn ? { onContinue: () => void goOn(item.id) } : {})} />;
          return <View style={{ marginTop: gap }}>{live ? <Reveal>{bubbleItem}</Reveal> : bubbleItem}</View>;
        }}
        ListFooterComponent={chat.busy ? <LiveSteps chat={chat} seconds={seconds} /> : undefined}
        ListEmptyComponent={<Starters disabled={chat.busy || status.kind !== "ready"} onSend={(text) => void send(text)} />}
      />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={{ paddingHorizontal: s.md, paddingTop: s.sm, paddingBottom: s.md }}>
          {/* One raised card: when the chat read others' content (ST-TAINTED), the warning is its top line, part of
              where you write, rather than a note appended above it. Any send then shows the warning on its sheet. */}
          <View style={{ borderRadius: 28, backgroundColor: p.raised, boxShadow: shadow(p, "lifted") }}>
            {chat.tainted ? (
              <View style={{ flexDirection: "row", gap: s.sm, alignItems: "flex-start", paddingHorizontal: s.lg, paddingTop: s.md, paddingBottom: s.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: p.hairline }} accessibilityLiveRegion="polite">
                <View style={{ height: 18, justifyContent: "center" }}><Icon name="shield-alert" size={20} color={p.amber} /></View>
                <T v="footnote" color="soft" style={{ flex: 1 }}>{t("HM-CHAT-01.tainted")}</T>
              </View>
            ) : null}
            <View style={{ flexDirection: "row", alignItems: "flex-end", minHeight: 56, paddingLeft: s.lg, paddingRight: s.xs, paddingVertical: s.xs }}>
              <TextInput
                value={draft}
                onChangeText={setDraft}
                onSubmitEditing={() => void send()}
                editable={!chat.busy && status.kind === "ready"}
                placeholder={t("HM-CHAT-01.placeholder")}
                accessibilityLabel={t("HM-CHAT-01.placeholder")}
                placeholderTextColor={p.textSoft}
                style={[typeStyle(p, "body"), { flex: 1, minWidth: 0, color: p.text, minHeight: 48, paddingVertical: s.md }]}
                returnKeyType="send"
              />
              <InputControl control={inputControl(chat)} canSend={status.kind === "ready" && draft.trim().length > 0} onSend={() => void send()} onStop={stop} />
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
      <ApprovalSheet />
      <MenuSheet open={menuOpen} onClose={() => setMenuOpen(false)} {...(canClear ? { onClear: confirmClear } : {})} />
    </SafeAreaView>
  );
}

/** Who a chat item belongs to, for the spacing between bubbles: a run of one speaker sits closer together. */
const speaker = (i: ChatItem) => (i.kind === "user" ? "you" : "hermit");

/** Seconds since `startedAt`, ticking once a second while set. */
function useElapsed(startedAt: number | undefined): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!startedAt) return;
    setNow(Date.now());
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [startedAt]);
  return startedAt ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0;
}

/** The status beside the crab, in words, the same as the pose (C1); idle says where Hermit is (C2). */
function headerStatus(chat: ChatState): string {
  if (chat.mascot === "asking" && chat.busy) return t("HM-CHAT-01.status.waiting");
  if (chat.busy && chat.live) {
    // A skill with no "doing" words of its own (pay, a connector's tool) says "Thinking…" rather than failing.
    return t(hasCopy(chat.live.statusKey) ? chat.live.statusKey : "HM-CHAT-01.doing.intent");
  }
  if (chat.mascot === "blocked") return t("HM-CHAT-01.status.blocked");
  if (chat.mascot === "error" || chat.mascot === "offline") return t(mascotLabel[chat.mascot], { reason: "", permission: "" });
  return t("HM-CHAT-02.onPhone");
}

/**
 * C3, O3: the first run. The crab on its stage says hello at the optical center, with Hermit's promise in two short
 * sentences; under it three asks by skill that work offline, as one grouped list. A tap sends one.
 */
function Starters({ disabled, onSend }: { disabled: boolean; onSend(text: string): void }) {
  const starters: Array<[IconName, string]> = [
    ["bell", "HM-CHAT-01.example1"],
    ["calendar", "HM-CHAT-01.example2"],
    ["bookmark", "HM-CHAT-01.example3"],
  ];
  return (
    <View style={{ flexGrow: 1, justifyContent: "center", paddingTop: s.xl }}>
      <Reveal style={{ alignItems: "center", gap: s.md, paddingHorizontal: s.lg }}>
        <Stage pose="hello" width={128} style={{ marginBottom: s.sm }} />
        <T v="display" role="header" center>{t("HM-CHAT-01.helloTitle")}</T>
        <T v="body" color="soft" center style={{ maxWidth: 320 }}>{t("HM-CHAT-01.helloBody")}</T>
      </Reveal>
      <Reveal delay={120} style={{ marginTop: s.section }}>
        <Label style={{ marginTop: 0 }}>{t("HM-CHAT-01.emptyTitle")}</Label>
        <Group>
          {starters.map(([icon, ask]) => (
            <Row key={ask} icon={icon} title={<T v="body">{t(ask)}</T>} a11y={t(ask)} disabled={disabled} onPress={() => onSend(t(ask))} />
          ))}
        </Group>
      </Reveal>
    </View>
  );
}

/**
 * C4 and US-CHAT-06: one round button inside the composer, Send, or Stop while a turn runs; after a press it waits,
 * disabled. A 40 dp disc in a 48 dp target; it sinks on press.
 */
function InputControl({ control, canSend, onSend, onStop }: { control: "send" | "stop" | "stopping"; canSend: boolean; onSend(): void; onStop(): void }) {
  const p = usePalette();
  const pressed = usePress("scale");
  const disc = { width: 40, height: 40, borderRadius: 20, alignItems: "center" as const, justifyContent: "center" as const };
  if (control === "send") {
    return (
      <Pressable
        onPress={onSend}
        {...pressed.handlers}
        disabled={!canSend}
        accessibilityRole="button"
        accessibilityLabel={t("HM-CHAT-01.send")}
        accessibilityState={{ disabled: !canSend }}
        style={{ width: 48, height: 48, alignItems: "center", justifyContent: "center" }}
      >
        <Animated.View style={[disc, { backgroundColor: canSend ? p.accent : p.sunken }, pressed.style]}>
          <Icon name="arrow-up" size={20} color={canSend ? p.onAccent : p.textSoft} strokeWidth={2} fixed />
        </Animated.View>
      </Pressable>
    );
  }
  const stopping = control === "stopping";
  return (
    <Pressable
      onPress={onStop}
      {...pressed.handlers}
      disabled={stopping}
      accessibilityRole="button"
      accessibilityLabel={t(stopping ? "HM-CHAT-01.stopping" : "HM-CHAT-01.stopA11y")}
      accessibilityState={{ disabled: stopping, busy: stopping }}
      style={{ width: 48, height: 48, alignItems: "center", justifyContent: "center", opacity: stopping ? 0.5 : 1 }}
    >
      <Animated.View style={[disc, { backgroundColor: p.text }, pressed.style]}>
        <View style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: p.canvas }} />
      </Animated.View>
    </Pressable>
  );
}

/** One step of a turn: a spinner while it runs, a check once done, and its words. */
function Step({ done, text, seconds }: { done: boolean; text: string; seconds?: number }) {
  const p = usePalette();
  return (
    <View style={{ flexDirection: "row", gap: s.md, alignItems: "center", minHeight: 32 }}>
      <View style={{ width: 20, alignItems: "center" }}>{done ? <Icon name="circle-check" size={20} color={p.mark} /> : <ActivityIndicator size="small" color={p.accent} />}</View>
      <T v={done ? "small" : "smallStrong"} color={done ? "soft" : "text"} style={{ flex: 1 }}>{text}</T>
      {!done && seconds !== undefined && seconds >= 3 ? <T v="footnote" color="soft" tabular>{t("HM-CHAT-01.elapsed", { seconds: String(seconds) })}</T> : null}
    </View>
  );
}

/** C5 live: each step of the running turn as it happens, then the reasoning behind a toggle (Q36). */
function LiveSteps({ chat, seconds }: { chat: ChatState; seconds: number }) {
  const [open, setOpen] = useState(false);
  const motion = useMotion();
  const steps = chat.steps ?? [];
  const thinking = chat.live?.thinking.trim() ?? "";
  if (!steps.length && !thinking) return null;
  return (
    <View style={{ gap: s.xs, marginTop: s.lg }}>
      {steps.map((st, i) => (
        <Reveal key={`${st.skill}-${i}`} rise={6}>
          <Step done={st.done} text={st.done ? t(skillName(st.skill)) : doingText(st.skill)} seconds={seconds} />
        </Reveal>
      ))}
      {thinking ? <Reasoning text={thinking} open={open} onToggle={() => { easeLayout(motion); setOpen((o) => !o); }} labelKey="HM-CHAT-01.reasoning" /> : null}
    </View>
  );
}

/** A disclosure in the secondary color: a chevron that turns and a label, the body under it when open. */
function Disclosure({ label, open, onToggle, children }: { label: string; open: boolean; onToggle(): void; children?: ReactNode }) {
  const p = usePalette();
  return (
    <View>
      <Pressable onPress={onToggle} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ expanded: open }} style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: s.xs, minHeight: 48, alignSelf: "flex-start", paddingRight: s.md, opacity: pressed ? 0.6 : 1 })}>
        <CrossFade id={open ? "open" : "shut"}>
          {(state) => <Icon name={state === "open" ? "chevron-down" : "chevron-right"} size={20} color={p.textSoft} />}
        </CrossFade>
        <T v="footnoteStrong" color="soft">{label}</T>
      </Pressable>
      {open ? <Reveal rise={distance.unfold}>{children}</Reveal> : null}
    </View>
  );
}

function Reasoning({ text, open, onToggle, labelKey }: { text: string; open: boolean; onToggle(): void; labelKey: string }) {
  const p = usePalette();
  return (
    <Disclosure label={t(labelKey)} open={open} onToggle={onToggle}>
      <ScrollView style={{ maxHeight: 160, borderRadius: radius.field, backgroundColor: p.sunken, paddingHorizontal: s.md, paddingVertical: s.sm }} nestedScrollEnabled>
        <T v="footnote" color="soft">{text.trim().slice(-1500)}</T>
      </ScrollView>
    </Disclosure>
  );
}

/** C5 folded: the finished turn's steps as one line, "Worked for 9 s · 2 steps", that unfolds them again. */
function Folded({ work }: { work: TurnWork }) {
  const [open, setOpen] = useState(false);
  const motion = useMotion();
  return (
    <Disclosure
      label={work.skills.length === 1 ? t("HM-CHAT-01.workedForOne", { seconds: work.seconds }) : t("HM-CHAT-01.workedFor", { seconds: work.seconds, steps: work.skills.length })}
      open={open}
      onToggle={() => {
        easeLayout(motion);
        setOpen((o) => !o);
      }}
    >
      <View style={{ gap: s.xs, paddingBottom: s.xs }}>
        {work.skills.map((skill, i) => <Step key={`${skill}-${i}`} done text={t(skillName(skill))} />)}
      </View>
    </Disclosure>
  );
}

/**
 * A bubble: radius 20 all round, and the tail (a 6 dp corner on the speaker's side, at the bottom) only on the last
 * bubble of a run from one speaker, so a run reads as one group. At most 80% of the row.
 */
const bubble = (mine: boolean, tail: boolean): ViewStyle => ({
  alignSelf: mine ? "flex-end" : "flex-start", maxWidth: "80%", borderRadius: radius.bubble, paddingHorizontal: s.lg, paddingTop: 10, paddingBottom: 11,
  ...(tail ? (mine ? { borderBottomRightRadius: 6 } : { borderBottomLeftRadius: 6 }) : {}),
});

function UserBubble({ text, tail = true }: { text: string; tail?: boolean }) {
  const p = usePalette();
  return (
    <View style={[bubble(true, tail), { backgroundColor: p.userBubble }]}>
      <T v="body" color="userText" selectable>{text}</T>
    </View>
  );
}

/**
 * Hermit's bubble. Q155: its text is drawn as structure (headings, steps, bullets; ReplyText), and a structured or long
 * reply takes more of the row (92%), so a recipe reads as a recipe and lines don't wrap a word at a time at 200%.
 */
function HermitBubble({ text, tail = true }: { text: string; tail?: boolean }) {
  const p = usePalette();
  const blocks = useMemo(() => replyBlocks(text), [text]);
  const wide = blocks.length > 1 || text.length > 280;
  return (
    <View style={[bubble(false, tail), { backgroundColor: p.hermitBubble }, wide ? { maxWidth: "92%" } : null]}>
      <ReplyText blocks={blocks} text={text} color="hermitText" />
    </View>
  );
}

/** A card in the thread: the raised surface and its soft shadow; a refusal says so with its coral mark and words. */
function ThreadCard({ children }: { children: ReactNode; tone?: "coral" }) {
  const p = usePalette();
  return (
    <View style={{ alignSelf: "stretch", borderRadius: radius.card, backgroundColor: p.raised, boxShadow: shadow(p, "raised"), padding: s.lg, gap: s.sm }}>
      {children}
    </View>
  );
}

/**
 * A6: a payment the network confirmed, from the payment code's receipt only (amount, payee or host, transaction) in
 * fixed copy, linked to Activity. The reply's own text, which can quote a merchant page, is a normal bubble under it;
 * when the reply is only the payment code's words (`receiptOnly`), the card says it all and no bubble repeats it.
 */
function PaidCard({ receipt }: { receipt: PaymentReceipt }) {
  const router = useRouter();
  // Address poisoning: a recipient with no saved name arrives as the whole address, and stays whole here (mono).
  const address = /^0x[0-9a-fA-F]{40}$/.test(receipt.to);
  return (
    <ThreadCard>
      <View style={{ flexDirection: "row", gap: s.md, alignItems: "center" }}>
        <Tile icon="circle-check" />
        <T v="bodyStrong" style={{ flex: 1 }}>{address ? t("HM-CHAT-01.receipt.paidAddress", { amount: receipt.amount }) : t("HM-CHAT-01.receipt.paid", { amount: receipt.amount, to: receipt.to })}</T>
      </View>
      {address ? <WholeAddress address={receipt.to} v="mono" color="text" /> : null}
      <T v="small" color="soft">{receipt.hash ? t("HM-CHAT-01.receipt.confirmedTx", { hash: receipt.hash }) : t("HM-CHAT-01.receipt.confirmedNet")}</T>
      <LinkText label={t("HM-CHAT-01.receipt.inActivity")} onPress={() => router.push("/activity")} />
    </ThreadCard>
  );
}

/** Q144: a payment a cap refused, as a coral card in the thread: the tucked-in crab, the hold's own words, the caps. */
function RefusedCard({ text }: { text: string }) {
  const p = usePalette();
  const router = useRouter();
  return (
    <ThreadCard tone="coral">
      <View style={{ flexDirection: "row", gap: s.sm, alignItems: "center", flexWrap: "wrap" }}>
        <Mascot state="blocked" dark={p.dark} width={40} />
        <Badge label={t("HM-APPR-02.blockedLabel")} tone="coral" />
      </View>
      <T v="body" selectable>{text}</T>
      <Btn label={t("HM-APPR-02.seeCaps")} kind="text" icon="sliders-horizontal" onPress={() => router.push("/wallet-caps")} style={{ marginLeft: -s.md }} />
    </ThreadCard>
  );
}

/** A quiet line in the thread: the icon of what happened and the words from copy (ST-SUCCESS, denials). */
function Quiet({ icon, text, tone = "mark", children }: { icon: IconName; text: string; tone?: "mark" | "soft" | "coral"; children?: ReactNode }) {
  const p = usePalette();
  return (
    <View style={{ gap: 2 }}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: s.sm }}>
        <View style={{ height: 20, justifyContent: "center" }}><Icon name={icon} size={20} color={p[tone]} /></View>
        <T v="small" color={tone === "coral" ? "coral" : "soft"} style={{ flex: 1 }}>{text}</T>
      </View>
      {children}
    </View>
  );
}

/** The mail screen a turn's answer links to (SL-48, SL-49). */
const MAIL_LINK: Record<NonNullable<Extract<ChatItem, { kind: "assistant" }>["mail"]>, { href: "/mail-summary" | "/mail-search" | "/mail-draft"; icon: IconName; label: string }> = {
  "HM-MAIL-02": { href: "/mail-summary", icon: "mail", label: "HM-CHAT-01.mail.list" },
  "HM-MAIL-03": { href: "/mail-search", icon: "search", label: "HM-CHAT-01.mail.search" },
  "HM-MAIL-04": { href: "/mail-draft", icon: "pen-line", label: "HM-CHAT-01.mail.draft" },
};

/** A link under an answer (connect a service, open a web task's plan): a text button with its icon. */
function ThreadLink({ href, icon, label }: { href: Parameters<typeof Link>[0]["href"]; icon: IconName; label: string }) {
  const p = usePalette();
  return (
    <Link href={href} asChild>
      <Pressable accessibilityRole="link" accessibilityLabel={label} style={({ pressed }) => ({ minHeight: 48, justifyContent: "center", alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: s.sm, opacity: pressed ? 0.6 : 1 })}>
        <Icon name={icon} size={20} color={p.accent} />
        <T v="smallStrong" color="link">{label}</T>
      </Pressable>
    </Link>
  );
}

/**
 * Q155: under a reply that stopped short, one quiet line says so ("Me detuve aquí.", or "Lo detuviste aquí." after a
 * stop), with Seguir on the latest one: a 48 dp tonal button with its own TalkBack label. While Seguir writes, the line
 * says so instead (the composer's Stop stops it); if it failed, the line says that and Seguir stays. If it found nothing
 * new, the line says that ("No encontré nada más que agregar.") and Seguir is gone: the reply is whole.
 */
function CutLine({ item, onContinue }: { item: Reply; onContinue?: () => void }) {
  const p = usePalette();
  if (item.continuing) {
    return (
      <View style={{ flexDirection: "row", alignItems: "center", gap: s.sm, minHeight: 48, paddingLeft: s.xs }}>
        <View style={{ width: 20, alignItems: "center" }}><ActivityIndicator size="small" color={p.accent} /></View>
        <T v="small" color="soft" style={{ flexShrink: 1 }}>{t("HM-CHAT-01.cut.continuing")}</T>
      </View>
    );
  }
  const line = item.continueFailed ? "HM-CHAT-01.cut.failed" : item.nothingMore ? "HM-CHAT-01.cut.nothingMore" : item.stopped ? "HM-CHAT-01.cut.stopped" : "HM-CHAT-01.cut.line";
  return (
    <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", columnGap: s.md, paddingLeft: s.xs }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: s.sm, minHeight: 48, flexShrink: 1 }}>
        <Icon name={item.continueFailed ? "circle-alert" : item.nothingMore ? "circle-check" : "circle-pause"} size={20} color={p.textSoft} />
        <T v="small" color="soft" style={{ flexShrink: 1 }}>{t(line)}</T>
      </View>
      {onContinue ? <Btn label={t("HM-CHAT-01.cut.continue")} a11y={t("HM-CHAT-01.cut.continueA11y")} kind="secondary" icon="play" small onPress={onContinue} /> : null}
    </View>
  );
}

function Bubble({ item, onChoose, tail, onContinue }: { item: ChatItem; onChoose?: (text: string) => void; tail: boolean; onContinue?: () => void }) {
  const p = usePalette();
  const motion = useMotion();
  const [open, setOpen] = useState(false);
  switch (item.kind) {
    case "user":
      return <UserBubble text={item.text} tail={tail} />;
    case "assistant":
    case "question":
      return (
        <View style={{ gap: s.sm }}>
          {item.work ? <Folded work={item.work} /> : null}
          {item.thinking ? <Reasoning text={item.thinking} open={open} onToggle={() => { easeLayout(motion); setOpen((o) => !o); }} labelKey="HM-CHAT-01.reasoningDone" /> : null}
          {item.kind === "assistant" && item.receipt ? <PaidCard receipt={item.receipt} /> : null}
          {item.kind === "assistant" && item.card === "refused" ? <RefusedCard text={item.text} />
            : item.kind === "assistant" && item.receipt && item.receiptOnly ? null
            : <HermitBubble text={item.text} tail={tail} />}
          {item.kind === "assistant" && (item.cut || item.continuing || item.continueFailed || item.nothingMore) ? <CutLine item={item} {...(onContinue ? { onContinue } : {})} /> : null}
          {item.kind === "question" && item.choices?.length ? (
            // PDR-028: each candidate as a tonal button; the tap sends only the picked number or address as the user's words.
            <View accessibilityLabel={t("HM-CHAT-01.people.choices")} style={{ flexDirection: "row", flexWrap: "wrap", gap: s.sm }}>
              {item.choices.map((c) => (
                <Btn key={c.text} label={c.label} kind="secondary" small disabled={!onChoose} onPress={() => onChoose?.(c.text)} />
              ))}
            </View>
          ) : null}
          {item.kind === "assistant" && item.page ? (
            // HM-WEB-01: the page this answer used, as a source card.
            <Link href={{ pathname: "/web", params: { id: item.page.id } }} asChild>
              <Pressable
                accessibilityRole="link"
                accessibilityLabel={`${t("HM-CHAT-01.seePage")}: ${item.page.title}, ${item.page.domain}`}
                style={({ pressed }) => ({ alignSelf: "flex-start", maxWidth: "86%", flexDirection: "row", gap: s.md, alignItems: "center", borderRadius: radius.card, backgroundColor: pressed ? p.sunken : p.raised, boxShadow: shadow(p, "raised"), paddingHorizontal: s.md, paddingVertical: s.md, minHeight: 56 })}
              >
                <Tile icon="globe" />
                <View style={{ flexShrink: 1 }}>
                  <T v="smallStrong">{item.page.title}</T>
                  <T v="footnote" color="soft">{item.page.domain}</T>
                </View>
                <Icon name="chevron-right" size={20} color={p.textSoft} />
              </Pressable>
            </Link>
          ) : null}
          {item.kind === "assistant" && item.connect ? (
            // SL-55: the user's own words go to HM-CONN-04; nothing is looked up until they tap.
            <ThreadLink href={{ pathname: "/connect", params: { request: item.connect.request, offer: item.connect.offerId } }} icon="plug" label={t("HM-CHAT-01.connect.open")} />
          ) : null}
          {item.kind === "assistant" && item.webTask ? (
            // SL-53: the plan for a saved web task, by the runtime's one-time offer id; nothing opens until Start.
            <ThreadLink href={{ pathname: "/browser", params: { offer: item.webTask.offerId } }} icon="list-checks" label={t("HM-CHAT-01.web.open")} />
          ) : null}
          {item.kind === "assistant" && item.mail ? (
            // SL-48 and SL-49: the emails this answer used, the search results, or the draft, from the app's mail data.
            <ThreadLink href={MAIL_LINK[item.mail].href} icon={MAIL_LINK[item.mail].icon} label={t(MAIL_LINK[item.mail].label)} />
          ) : null}
        </View>
      );
    case "offer":
      return <ContactsOffer />;
    case "outcome":
      return <Quiet icon={item.outcome === "stopped" ? "circle-pause" : item.outcome === "offline" ? "cloud-off" : "circle-alert"} tone={item.outcome === "stopped" ? "soft" : "coral"} text={t(outcomeCopyKey(item.outcome), { reason: "", permission: "" })} />;
    case "system":
      // SL-37: a payment or password blocked for want of the approval key links the screen that sets it up.
      if (item.copyKey === "HM-APPR-01.signed.approval_key_none" || item.copyKey === "HM-APPR-01.signed.approval_key_lost") {
        return (
          <Quiet icon="ban" tone="coral" text={t(item.copyKey)}>
            <View style={{ paddingLeft: s.xl + s.xs }}>
              <ThreadLink href="/approval-key" icon="fingerprint" label={t("HM-APPR-01.signed.setUp")} />
            </View>
          </Quiet>
        );
      }
      return <Quiet {...systemLook(item.copyKey)} text={t(item.copyKey, item.vars ?? {})} />;
  }
}

/** A quiet row's icon and tone: a cage refusal is coral, a saved note is Hermit's, a denial is plain. */
function systemLook(copyKey: string): { icon: IconName; tone: "mark" | "soft" | "coral" } {
  if (copyKey === "common.outcome.blocked" || copyKey.startsWith("HM-APPR-01.signed.")) return { icon: "ban", tone: "coral" };
  if (copyKey === "HM-CHAT-01.saved") return { icon: "bookmark", tone: "mark" };
  if (copyKey.startsWith("HM-APPR-01.denied")) return { icon: "circle-x", tone: "soft" };
  return { icon: "info", tone: "soft" };
}

/** PDR-028: the one-time offer to allow contacts. Allow shows the system prompt; either answer is final (never nags). */
function ContactsOffer() {
  const [answer, setAnswer] = useState<"allowed" | "notAllowed">();
  const allow = async () => setAnswer((await requestContactsPermission().catch(() => false)) ? "allowed" : "notAllowed");
  return (
    <Quiet icon="contact" tone="mark" text={t(answer ? `HM-CHAT-01.people.${answer}` : "HM-CHAT-01.people.offer")}>
      {answer ? null : <Btn label={t("HM-CHAT-01.people.allow")} kind="secondary" small onPress={() => void allow()} style={{ marginLeft: s.xl + s.xs }} />}
    </Quiet>
  );
}
