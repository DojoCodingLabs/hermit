// HM-MEM-01: everything Hermit remembers, newest first, with search and provenance marks (US-MEM-04).
// A fact saved after reading others' text is marked "From a message". States: ST-LOAD, ST-EMPTY-FIRST
// (nothing saved yet), ST-EMPTY-CLEARED (search finds nothing), ST-ERROR (retry), ST-IDEAL, older pages as ST-LAZY.
// Polish round: a search field, then one grouped list where the fact leads and the date reads relative to now; only
// what came from a message carries a badge (amber, quoted as someone else's words); the empty state is the staged crab
// and "Go to the chat". The list builds only the rows on screen, and older pages load as it nears its end.
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { View } from "react-native";
import type { MemoryCursor, Note as Fact } from "@hermit/core";
import { Badge, Btn, Empty, Failed, LinkText, Loading, Note, Page, Row, SearchField, T } from "../components/kit";
import { useHermit } from "../hermit-context";
import { quoted, when } from "../format";
import { currentLocale, t } from "../i18n";
import { s } from "../theme";

type Screen = { kind: "loading" } | { kind: "error" } | { kind: "list"; notes: Fact[]; next?: MemoryCursor; query: string };

export default function Memories() {
  const router = useRouter();
  const { status } = useHermit();
  const hermit = status.kind === "ready" ? status.hermit : undefined;
  const [query, setQuery] = useState("");
  const [view, setView] = useState<Screen>({ kind: "loading" });
  const [more, setMore] = useState(false);
  // Only the newest request may write the screen (typing fires one per keystroke).
  const ticket = useRef(0);

  const load = useCallback(async (q: string) => {
    if (!hermit) return;
    const mine = ++ticket.current;
    try {
      const page = await hermit.memories.list({ query: q });
      if (mine === ticket.current) setView({ kind: "list", query: q, notes: page.notes, ...(page.next ? { next: page.next } : {}) });
    } catch {
      if (mine === ticket.current) setView({ kind: "error" });
    }
  }, [hermit]);

  // Back from HM-MEM-02 (maybe after a delete): reload what is on screen.
  useFocusEffect(useCallback(() => void load(query), [load, query]));
  useEffect(() => {
    if (status.kind === "failed") setView({ kind: "error" });
  }, [status]);

  // Scroll events arrive faster than a render: a ref, not the state, keeps it to one page at a time.
  const fetching = useRef(false);
  const loadMore = useCallback(async () => {
    if (!hermit || view.kind !== "list" || !view.next || fetching.current) return;
    fetching.current = true;
    setMore(true);
    const mine = ticket.current;
    try {
      const page = await hermit.memories.list({ query: view.query, after: view.next });
      if (mine === ticket.current) setView({ kind: "list", query: view.query, notes: [...view.notes, ...page.notes], ...(page.next ? { next: page.next } : {}) });
    } catch {
      // The rows already shown stay; scrolling again retries.
    } finally {
      fetching.current = false;
      setMore(false);
    }
  }, [hermit, view]);

  const searching = query.trim().length > 0;

  if (view.kind === "loading") {
    return (
      <Page title={t("HM-MEM-01.title")}>
        <Loading text={t("HM-MEM-01.loading")} />
      </Page>
    );
  }

  if (view.kind === "error") {
    return (
      <Page title={t("HM-MEM-01.title")}>
        <Failed text={t("HM-MEM-01.error")} onRetry={() => { setView({ kind: "loading" }); void load(query); }} />
      </Page>
    );
  }

  // ST-EMPTY-FIRST: nothing saved at all (not a search with no match).
  if (!view.notes.length && !view.query.trim() && !searching) {
    return (
      <Page title={t("HM-MEM-01.title")}>
        <Empty pose="idle" title={t("HM-MEM-01.emptyTitle")} body={t("HM-MEM-01.emptyBody")}>
          <Btn label={t("HM-MEM-01.emptyAction")} icon="message-circle" full onPress={() => router.back()} />
        </Empty>
      </Page>
    );
  }

  const now = Date.now();
  return (
    <Page
      title={t("HM-MEM-01.title")}
      list={{
        data: view.notes,
        keyOf: (item) => String(item.id),
        // The fact leads, then when it was saved (relative); a badge only on what came from a message.
        row: (item) => {
          const at = when(item.createdAt, now, currentLocale());
          const date = t(at.key, at.vars);
          return (
            <Row
              title={<T v="body" lines={3}>{item.tainted ? quoted(item.fact) : item.fact}</T>}
              sub={
                <View style={{ flexDirection: "row", alignItems: "center", gap: s.sm, flexWrap: "wrap", marginTop: 2 }}>
                  {item.tainted ? <Badge label={t("HM-MEM-01.fromMessage")} tone="amber" /> : null}
                  <T v="footnote" color="soft">{date}</T>
                </View>
              }
              chevron
              a11y={`${item.fact}, ${t(item.tainted ? "HM-MEM-01.fromMessage" : "HM-MEM-01.fromYou")}, ${date}`}
              onPress={() => router.push({ pathname: "/memory", params: { id: String(item.id) } })}
            />
          );
        },
        top: (
          <View style={{ gap: s.md, marginBottom: s.lg }}>
            <SearchField label={t("HM-MEM-01.search")} value={query} onChange={setQuery} />
            {view.notes.some((n) => n.tainted) ? <View style={{ paddingHorizontal: s.lg }}><Note icon="shield-alert" tone="amber" text={t("HM-MEM-01.fromMessageNote")} /></View> : null}
          </View>
        ),
        // ST-EMPTY-CLEARED: the search found nothing; memories exist.
        empty: (
          <View style={{ paddingVertical: s.xl, gap: s.xs }}>
            <Note icon="search" text={t("HM-MEM-01.noMatch", { query: query.trim() })} textColor="text" v="body" />
            <LinkText label={t("HM-MEM-01.clearSearch")} icon="x" onPress={() => setQuery("")} />
          </View>
        ),
        bottom: more ? <Loading text={t("HM-MEM-01.loading")} /> : undefined,
        onEnd: () => void loadMore(),
      }}
    />
  );
}
