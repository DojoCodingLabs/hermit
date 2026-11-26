// HM-VAULT-01: the vault (US-VAULT-01, US-VAULT-02). The rules live in @hermit/runtime (createVault); this screen
// draws its states: ST-LOAD, no vault yet (create it with a fingerprint, or no fingerprint on the phone), locked
// (unlock with a fingerprint), lost (new fingerprints invalidated the key: start over), ST-EMPTY-FIRST, ST-IDEAL
// (names and origins only, never a username or a secret) and ST-ERROR. FLAG_SECURE while it shows.
// Design pass: the closed states are the crab, a line and the one action (fingerprint); the list is one grouped list
// with each login's initial, built row by row as it scrolls (an import can bring thousands); Add is the primary
// action with Import beside it, and Lock sits in the header.
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, View } from "react-native";
import type { VaultEntry } from "@hermit/core";
import { VAULT_IDLE_MS, type VaultStatus } from "@hermit/runtime";
import { Avatar, Btn, Empty, Failed, Footer, IconBtn, Loading, Note, Notice, Page, Row } from "../components/kit";
import { useHermit } from "../hermit-context";
import { useSecureScreen } from "../secure-screen";
import { t } from "../i18n";
import { s } from "../theme";

type Closed = Exclude<VaultStatus, "unlocked">;
type View_ =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "none" }
  | { kind: "locked" }
  | { kind: "lost" }
  | { kind: "unlocked"; items: VaultEntry[] };

const closed = (kind: Closed): View_ => ({ kind }) as View_;

type Note_ = "cancelled" | "unavailable" | "failed";

/** How often the open screen checks the idle rule (Q83), so a vault left open shows locked. */
const TICK_MS = 5_000;

export default function Vault() {
  const router = useRouter();
  const { status } = useHermit();
  const vault = status.kind === "ready" ? status.hermit.vault : undefined;
  const [view, setView] = useState<View_>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note_>();
  useSecureScreen();

  const load = useCallback(async () => {
    if (!vault) return;
    try {
      const s = await vault.status();
      if (s !== "unlocked") return setView(closed(s));
      const list = await vault.list();
      setView(list.kind === "items" ? { kind: "unlocked", items: list.items } : closed(list.kind));
    } catch {
      setView({ kind: "error" });
    }
  }, [vault]);

  useFocusEffect(useCallback(() => void load(), [load]));
  useEffect(() => {
    if (status.kind === "failed") setView({ kind: "error" });
  }, [status]);
  useEffect(() => {
    if (!vault || view.kind !== "unlocked") return;
    const id = setInterval(() => {
      if (!vault.isUnlocked()) setView({ kind: "locked" });
    }, TICK_MS);
    return () => clearInterval(id);
  }, [vault, view.kind]);

  const act = async (run: () => Promise<string>) => {
    setBusy(true);
    setNote(undefined);
    try {
      const out = await run();
      if (out === "cancelled" || out === "unavailable") setNote(out);
      await load();
    } catch {
      setNote("failed");
    } finally {
      setBusy(false);
    }
  };

  const askReset = () =>
    Alert.alert(t("HM-VAULT-01.resetTitle"), t("HM-VAULT-01.resetBody"), [
      { text: t("HM-VAULT-01.resetCancel"), style: "cancel" },
      { text: t("HM-VAULT-01.resetConfirm"), style: "destructive", onPress: () => void act(async () => (await vault!.reset(), "ok")) },
    ]);

  const noteView = note ? <Notice tone="bad" text={t(`HM-VAULT-01.note.${note}`)} /> : null;

  if (view.kind === "loading") {
    return (
      <Page title={t("HM-VAULT-01.title")}>
        <Loading text={t("HM-VAULT-01.loading")} />
      </Page>
    );
  }

  if (view.kind === "error") {
    return (
      <Page title={t("HM-VAULT-01.title")}>
        <Failed text={t("HM-VAULT-01.error")} onRetry={() => { setView({ kind: "loading" }); void load(); }} />
      </Page>
    );
  }

  if (view.kind === "none" || view.kind === "locked" || view.kind === "lost") {
    const k = view.kind;
    return (
      <Page title={t("HM-VAULT-01.title")}>
        <Empty pose={k === "none" ? "hello" : k === "lost" ? "error" : "idle"} title={t(`HM-VAULT-01.${k}Title`)} body={t(`HM-VAULT-01.${k}Body`, { minutes: VAULT_IDLE_MS / 60_000 })}>
          {noteView}
          {k === "none" ? (
            <Btn label={t("HM-VAULT-01.create")} icon="fingerprint" full busy={busy} onPress={() => void act(() => vault!.create(t("HM-VAULT-01.createPrompt")))} />
          ) : k === "locked" ? (
            <Btn label={t("HM-VAULT-01.unlock")} icon="fingerprint" full busy={busy} onPress={() => void act(() => vault!.unlock(t("HM-VAULT-01.unlockPrompt")))} />
          ) : (
            <Btn label={t("HM-VAULT-01.reset")} kind="coral" icon="trash-2" full busy={busy} onPress={askReset} />
          )}
        </Empty>
      </Page>
    );
  }

  const items = view.items;
  const lockNow = () => {
    vault?.lock();
    setView({ kind: "locked" });
  };
  return (
    <Page
      title={t("HM-VAULT-01.title")}
      action={<IconBtn icon="lock" label={t("HM-VAULT-01.lock")} onPress={lockNow} />}
      footer={items.length ? (
        <Footer>
          <Btn label={t("HM-VAULT-01.add")} icon="plus" style={{ flexGrow: 1 }} onPress={() => router.push("/vault-item")} />
          <Btn label={t("HM-VAULT-01.import")} kind="secondary" icon="download" style={{ flexGrow: 1 }} onPress={() => router.push("/vault-import")} />
        </Footer>
      ) : undefined}
      list={{
        data: items,
        keyOf: (item) => item.id,
        lead: "avatar",
        // Each login with its initial, its name and the site in words: no mono, and no "https://" (a plain
        // "http://" stays, since a login on an insecure page is worth noticing).
        row: (item) => (
          <Row
            leading={<Avatar name={item.name} tone="plain" />}
            title={item.name}
            sub={item.origins.map((o) => o.replace(/^https:\/\//, "")).join(", ")}
            chevron
            a11y={t("HM-VAULT-01.itemLabel", { name: item.name, origin: item.origins[0] ?? "" })}
            hint={t("HM-VAULT-01.openHint")}
            onPress={() => router.push({ pathname: "/vault-item", params: { id: item.id } })}
          />
        ),
        top: (
          <View style={{ gap: s.sm, marginBottom: s.lg, paddingHorizontal: s.lg }}>
            <Note icon="shield-check" text={t("HM-VAULT-01.private")} />
            {noteView}
          </View>
        ),
        empty: (
          <Empty pose="hello" body={t("HM-VAULT-01.empty")}>
            <Btn label={t("HM-VAULT-01.add")} icon="plus" full onPress={() => router.push("/vault-item")} />
            <Btn label={t("HM-VAULT-01.import")} kind="secondary" icon="download" full onPress={() => router.push("/vault-import")} />
          </Empty>
        ),
      }}
    />
  );
}
