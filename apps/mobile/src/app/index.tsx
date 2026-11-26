// HM-BOT-01: the roster, the app's home. Hermit first (the crab, always), then up to two pinned bots, then the rest by
// latest activity; a search over names and roles; hidden bots stay under "Ocultos" and keep working. A tap opens that
// bot's chat (HM-BOT-02); press and hold pins or hides. The app's own menu lives here now. The first-run and erase
// redirects the chat used to make are made here, since this is where the app opens.
import { Redirect, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { HERMIT_BOT_ID } from "@hermit/core";
import type { BotRefusal, Roster, RosterRow } from "@hermit/runtime";
import { BotAvatar } from "../components/BotAvatar";
import { Icon } from "../components/Icon";
import { Chip, Failed, Group, IconBtn, Loading, Note, Page, Row, SearchField, T, TitleLine } from "../components/kit";
import { MenuSheet } from "../components/MenuSheet";
import { SheetModal } from "../components/Sheet";
import { useHermit } from "../hermit-context";
import { currentLocale, t } from "../i18n";
import { when } from "../format";
import { modeChip, rowLine, rowSpoken, rowTime } from "../roster-view";
import { s } from "../theme";
import { usePalette } from "../use-palette";

type View_ = { kind: "loading" } | { kind: "error" } | { kind: "ready"; roster: Roster };

const said = (at: number) => {
  const w = when(at, Date.now(), currentLocale());
  return t(w.key, w.vars);
};

export default function RosterScreen() {
  const p = usePalette();
  const router = useRouter();
  const { status } = useHermit();
  const hermit = status.kind === "ready" ? status.hermit : undefined;
  const [view, setView] = useState<View_>({ kind: "loading" });
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [hiddenOpen, setHiddenOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [acting, setActing] = useState<RosterRow>();
  const [refused, setRefused] = useState<BotRefusal>();

  // Only the newest request may write the screen (typing fires one per keystroke).
  const ticket = useRef(0);
  const load = useCallback(async (q: string) => {
    if (!hermit) return;
    const mine = ++ticket.current;
    try {
      const roster = await hermit.bots.roster(q.trim() ? { query: q.trim() } : undefined);
      if (mine === ticket.current) setView({ kind: "ready", roster });
    } catch {
      if (mine === ticket.current) setView((v) => (v.kind === "ready" ? v : { kind: "error" }));
    }
  }, [hermit]);
  // Back from a chat or a bot's settings (it may have been pinned, hidden, reset or deleted): read the roster again.
  useFocusEffect(useCallback(() => void load(query), [load, query]));
  useEffect(() => {
    if (status.kind === "failed") setView({ kind: "error" });
  }, [status]);

  const [onboarded, setOnboarded] = useState<boolean>();
  useEffect(() => {
    if (status.kind === "ready") void status.hermit.settings.get("onboarding.done").then((v) => setOnboarded(v !== undefined));
    else if (status.kind === "not_wired") setOnboarded(false);
  }, [status]);
  // Dev builds only: hermit://?say=<text>&n=<nonce> still reaches the chat (scripts/phone/w1-journey.sh), Hermit's.
  const { say, n } = useLocalSearchParams<{ say?: string; n?: string }>();

  const change = useCallback(async (run: () => Promise<{ kind: "done" } | { kind: "refused"; reason: BotRefusal }>) => {
    try {
      const r = await run();
      if (r.kind === "refused") return setRefused(r.reason);
      setActing(undefined);
      setRefused(undefined);
      await load(query);
    } catch {
      setRefused("busy");
    }
  }, [load, query]);

  // SL-26: an interrupted erase finishes first (HM-SET-03 resumes it without asking again).
  if (status.kind === "erase_pending") return <Redirect href="/delete" />;
  if (onboarded === false) return <Redirect href="/welcome" />;
  if (__DEV__ && say) return <Redirect href={{ pathname: "/chat", params: { bot: HERMIT_BOT_ID, say: String(say), ...(n ? { n: String(n) } : {}) } }} />;

  const open = (row: RosterRow) => router.push({ pathname: "/chat", params: { bot: row.bot.id } });
  const listed = view.kind === "ready" ? view.roster.rows : [];
  const hidden = view.kind === "ready" ? view.roster.hidden : [];
  const q = query.trim();

  const rowOf = (row: RosterRow) => {
    const line = rowLine(row);
    const preview = "key" in line ? t(line.key, line.vars) : line.text;
    const at = rowTime(row);
    const time = at === undefined ? "" : said(at);
    const chip = modeChip(row.mode);
    const pinned = row.bot.pinOrder !== null;
    return (
      <Row
        key={row.bot.id}
        leading={<BotAvatar bot={row.bot} size={40} dark={p.dark} />}
        title={<TitleLine title={row.bot.name} lines={1} {...(time ? { aside: time } : {})} {...(row.bot.primary ? { mark: <Icon name="star" size={14} color={p.textSoft} filled /> } : {})} />}
        sub={
          <View style={{ flexDirection: "row", alignItems: "center", gap: s.sm }}>
            {pinned ? <Icon name="pin" size={14} color={p.textSoft} /> : null}
            <T v="small" color="soft" lines={1} style={{ flex: 1 }}>{preview}</T>
            {chip ? <Chip label={t(chip.key)} tone={chip.tone} /> : null}
          </View>
        }
        a11y={rowSpoken({ name: row.bot.name, primary: row.bot.primary, preview, time, pinned, ...(chip ? { chip: t(chip.key) } : {}) }, { primary: t("HM-BOT-01.primary"), pinned: t("HM-BOT-01.pinned") })}
        {...(row.bot.primary ? {} : { hint: t("HM-BOT-01.longPressHint"), onLongPress: () => { setRefused(undefined); setActing(row); } })}
        onPress={() => open(row)}
      />
    );
  };

  const bar = (
    <View style={{ flexDirection: "row", alignItems: "center" }}>
      <IconBtn icon="search" label={searching ? t("HM-BOT-01.searchClose") : t("HM-BOT-01.searchOpen")} onPress={() => { setSearching((on) => !on); setQuery(""); void load(""); }} />
      <IconBtn icon="plus" label={t("HM-BOT-01.add")} onPress={() => router.push("/bot-new")} />
      <IconBtn icon="menu" label={t("HM-CHAT-01.menuA11y")} onPress={() => setMenuOpen(true)} />
    </View>
  );

  const body =
    view.kind === "loading" ? <Loading text={t("HM-BOT-01.loading")} /> :
    view.kind === "error" ? <Failed text={t("HM-BOT-01.failed")} onRetry={() => { setView({ kind: "loading" }); void load(query); }} /> :
    null;

  const overlays = (
    <>
      <MenuSheet open={menuOpen} onClose={() => setMenuOpen(false)} />
      <SheetModal visible={!!acting} onClose={() => setActing(undefined)} dismissable closeLabel={t("HM-CHAT-01.menuClose")}>
        {acting ? (
          <>
            <T v="title" role="header" style={{ marginBottom: s.lg }}>{acting.bot.name}</T>
            <View style={{ gap: s.md }}>
              <Group>
                {acting.bot.hidden ? null : (
                  <Row
                    icon="pin"
                    title={t(acting.bot.pinOrder !== null ? "HM-BOT-01.unpin" : "HM-BOT-01.pin")}
                    onPress={() => void change(() => hermit!.bots.pin(acting.bot.id, acting.bot.pinOrder === null))}
                  />
                )}
                <Row
                  icon={acting.bot.hidden ? "eye" : "eye-off"}
                  title={t(acting.bot.hidden ? "HM-BOT-01.show" : "HM-BOT-01.hide")}
                  onPress={() => void change(() => hermit!.bots.hide(acting.bot.id, !acting.bot.hidden))}
                />
              </Group>
              {refused ? <View accessibilityLiveRegion="polite"><Note icon="circle-alert" tone="amber" textColor="text" text={t(refused === "too_many_pins" ? "HM-BOT-01.pinLimit" : "HM-BOT-01.changeFailed")} /></View> : null}
            </View>
          </>
        ) : null}
      </SheetModal>
    </>
  );

  if (body) {
    return (
      <>
        <Page title={t("HM-BOT-01.title")} back={false} action={bar}>{body}</Page>
        {overlays}
      </>
    );
  }
  return (
    <>
      <Page
        title={t("HM-BOT-01.title")}
        back={false}
        action={bar}
        list={{
          data: listed,
          keyOf: (row: RosterRow) => row.bot.id,
          row: rowOf,
          lead: "avatar" as const,
          top: (
            <View style={{ gap: s.md, marginBottom: searching ? s.lg : 0 }}>
              {status.kind === "not_wired" ? (
                <Note icon="info" text={`Dev build: ${status.slices.join(", ")}`} />
              ) : null}
              {searching ? <SearchField label={t("HM-BOT-01.search")} value={query} onChange={(v) => { setQuery(v); void load(v); }} /> : null}
            </View>
          ),
          empty: q && !hidden.length ? <T v="body" color="soft" center style={{ marginTop: s.xl }}>{t("HM-BOT-01.noMatch", { query: q })}</T> : undefined,
          bottom: (
            <View style={{ marginTop: s.xl, gap: s.lg }}>
              {hidden.length ? (
                <Group>
                  <Row
                    title={t("HM-BOT-01.hidden")}
                    trailing={
                      <View style={{ flexDirection: "row", alignItems: "center", gap: s.sm }}>
                        <T v="small" color="soft" tabular>{String(hidden.length)}</T>
                        <Icon name={hiddenOpen || !!q ? "chevron-up" : "chevron-down"} size={20} color={p.textSoft} />
                      </View>
                    }
                    a11y={`${t("HM-BOT-01.hidden")}, ${hidden.length}`}
                    onPress={() => setHiddenOpen((on) => !on)}
                  />
                  {hiddenOpen || q ? hidden.map(rowOf) : null}
                </Group>
              ) : null}
              {listed.length === 1 && !q && !hidden.length ? (
                <Group>
                  <Row icon="plus" title={t("HM-BOT-01.add")} role="link" chevron onPress={() => router.push("/bot-new")} />
                </Group>
              ) : null}
            </View>
          ),
        }}
      />
      {overlays}
    </>
  );
}
