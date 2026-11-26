// HM-VAULT-02: one login (US-VAULT-02, US-VAULT-04). Viewing shows the name and exact origins; the username, password
// and notes stay hidden until a fingerprint reveals them for 30 s (VAULT_REVEAL_MS). Copy is a fingerprint too, and the
// clip is marked sensitive and cleared after 30 s (Q82). Adding or editing validates first (no fingerprint for a
// mistake), then seals with a fingerprint. The generator uses the phone's secure random source. If the vault locks
// while this is open (idle, background, app lock), the screen goes back to HM-VAULT-01. FLAG_SECURE while it shows.
// Design pass: the login as one grouped list (websites, username, password, notes) with "Hidden" until the fingerprint,
// a copy button on the username and password rows (as 1Password puts it beside the field), Show with fingerprint as
// the one primary action, Edit in the bar and Delete as a coral row at the end; the form uses the shared fields, the
// generator in a card, and Save with fingerprint pinned at the foot.
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, View } from "react-native";
import { GENERATOR_DEFAULTS, GENERATOR_LIMITS, normalizeGenerator, type GeneratorOptions, type VaultEntry, type VaultProblem, type VaultSecrets } from "@hermit/core";
import { copySensitive } from "../adapters";
import type { IconName } from "../components/Icon";
import { Btn, Card, Footer, Group, IconBtn, Input, Note, Notice, Page, Row, T, Tile, Toggle } from "../components/kit";
import { useHermit } from "../hermit-context";
import { t } from "../i18n";
import { useSecureScreen } from "../secure-screen";
import { s } from "../theme";

type Note_ = "cancelled" | "not_on_screen" | "lost" | "failed" | "copied" | "gone";

interface Form {
  name: string;
  username: string;
  secret: string;
  notes: string;
  origins: string;
}

const EMPTY: Form = { name: "", username: "", secret: "", notes: "", origins: "" };
const CLASSES = ["lower", "upper", "digits", "symbols"] as const;
const TICK_MS = 1_000;

export default function VaultItem() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { status } = useHermit();
  const vault = status.kind === "ready" ? status.hermit.vault : undefined;
  const [entry, setEntry] = useState<VaultEntry>();
  const [mode, setMode] = useState<"view" | "form">(id ? "view" : "form");
  const [form, setForm] = useState<Form>(EMPTY);
  const [shown, setShown] = useState<{ secrets: VaultSecrets; hideAt: number }>();
  const [problems, setProblems] = useState<VaultProblem[]>([]);
  const [note, setNote] = useState<Note_>();
  const [busy, setBusy] = useState(false);
  const [gen, setGen] = useState<GeneratorOptions>(GENERATOR_DEFAULTS);
  const [now, setNow] = useState(Date.now());
  const [typedVisible, setTypedVisible] = useState(false);
  useSecureScreen();

  const back = useCallback(() => router.canGoBack() ? router.back() : router.replace("/vault"), [router]);

  useEffect(() => {
    if (!vault || !id) return;
    void vault.entry(id).then((r) => (r.kind === "entry" ? setEntry(r.entry) : r.kind === "gone" ? setNote("gone") : back()));
  }, [vault, id, back]);

  // The reveal countdown and the lock: hide at hideAt, leave the screen once the vault locks.
  useEffect(() => {
    const timer = setInterval(() => {
      const at = Date.now();
      setNow(at);
      if (vault && !vault.isUnlocked()) back();
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [vault, back]);
  useEffect(() => {
    if (shown && now >= shown.hideAt) setShown(undefined);
  }, [now, shown]);
  // Leaving the screen hides what was revealed and drops the form, so nothing secret stays in memory.
  useEffect(() => () => {
    setShown(undefined);
    setForm(EMPTY);
  }, []);

  if (!vault) return <Page title={t("HM-VAULT-02.title")}>{null}</Page>;

  const run = async (f: () => Promise<void>) => {
    setBusy(true);
    setNote(undefined);
    try {
      await f();
    } catch {
      setNote("failed");
    } finally {
      setBusy(false);
    }
  };

  const reveal = () =>
    run(async () => {
      const r = await vault.reveal(id!, t("HM-VAULT-02.revealPrompt"));
      if (r.kind === "revealed") return setShown({ secrets: r.secrets, hideAt: r.hideAt });
      if (r.kind === "locked") return back();
      setNote(r.kind);
    });

  const copy = (field: "username" | "secret") =>
    run(async () => {
      const r = await vault.copy(id!, field, t("HM-VAULT-02.copyPrompt"));
      if (r.kind === "copy") {
        await copySensitive(r.value, r.clearAfterMs);
        return setNote("copied");
      }
      if (r.kind === "locked") return back();
      setNote(r.kind);
    });

  const startEdit = () =>
    run(async () => {
      const r = await vault.reveal(id!, t("HM-VAULT-02.editPrompt"));
      if (r.kind === "locked") return back();
      if (r.kind !== "revealed" || !entry) return setNote(r.kind === "revealed" ? "gone" : r.kind);
      setShown(undefined);
      setForm({ name: entry.name, origins: entry.origins.join("\n"), ...r.secrets });
      setMode("form");
    });

  const save = () =>
    run(async () => {
      const input = { name: form.name, username: form.username, secret: form.secret, notes: form.notes, origins: form.origins.split(/\n|,/), ...(id ? { id } : {}) };
      const r = await vault.save(input, t("HM-VAULT-02.savePrompt"));
      if (r.kind === "invalid") return setProblems(r.problems);
      setProblems([]);
      if (r.kind === "saved") {
        setForm(EMPTY);
        if (!id) return router.replace({ pathname: "/vault-item", params: { id: r.id } });
        const fresh = await vault.entry(id);
        if (fresh.kind === "entry") setEntry(fresh.entry);
        return setMode("view");
      }
      if (r.kind === "locked") return back();
      setNote(r.kind);
    });

  const askDelete = () =>
    Alert.alert(t("HM-VAULT-02.deleteTitle"), t("HM-VAULT-02.deleteBody"), [
      { text: t("HM-VAULT-02.deleteCancel"), style: "cancel" },
      { text: t("HM-VAULT-02.deleteConfirm"), style: "destructive", onPress: () => void run(async () => {
        const r = await vault.remove(id!);
        if (r === "deleted" || r === "gone" || r === "locked") back();
      }) },
    ]);

  const noteView = note ? <Notice tone={note === "copied" ? "ok" : "bad"} text={t(`HM-VAULT-02.note.${note}`)} /> : null;

  if (mode === "view") {
    const secs = shown ? Math.max(0, Math.ceil((shown.hideAt - now) / 1000)) : 0;
    return (
      <Page
        title={entry?.name ?? t("HM-VAULT-02.title")}
        action={entry ? <IconBtn icon="pen-line" label={t("HM-VAULT-02.edit")} disabled={busy} onPress={() => void startEdit()} /> : undefined}
      >
        {noteView}
        {entry ? (
          <View style={{ gap: s.lg }}>
            {/* Each field with its own copy beside it (a fingerprint first, as before); Edit sits in the bar. */}
            <View style={{ gap: s.sm }}>
              <Group>
                <Secret icon="globe" label={t("HM-VAULT-02.origins")} value={entry.origins.join("\n")} mono />
                <Secret icon="user" label={t("HM-VAULT-02.username")} value={shown ? shown.secrets.username || t("HM-VAULT-02.none") : t("HM-VAULT-02.hidden")} hidden={!shown} copyLabel={t("HM-VAULT-02.copyUsername")} onCopy={busy ? undefined : () => void copy("username")} />
                <Secret icon="key-round" label={t("HM-VAULT-02.secret")} value={shown ? shown.secrets.secret : t("HM-VAULT-02.hidden")} mono={!!shown} hidden={!shown} copyLabel={t("HM-VAULT-02.copySecret")} onCopy={busy ? undefined : () => void copy("secret")} />
                {shown && shown.secrets.notes ? <Secret icon="book-open" label={t("HM-VAULT-02.notes")} value={shown.secrets.notes} /> : null}
              </Group>
              <T v="footnote" color="soft" style={{ paddingHorizontal: s.lg }}>{t("HM-VAULT-02.copyNote")}</T>
            </View>
            {shown ? (
              <View style={{ gap: s.sm }}>
                <View accessibilityLiveRegion="polite" style={{ paddingHorizontal: s.lg }}><Note icon="eye" text={t("HM-VAULT-02.hidesIn", { seconds: secs })} textColor="text" /></View>
                <Btn label={t("HM-VAULT-02.hide")} kind="secondary" icon="x" full onPress={() => setShown(undefined)} />
              </View>
            ) : (
              <Btn label={t("HM-VAULT-02.reveal")} icon="fingerprint" full busy={busy} onPress={() => void reveal()} />
            )}
            <Group style={{ marginTop: s.lg }}>
              <Row icon="trash-2" iconColor="coral" title={<T v="bodyStrong" color="coral">{t("HM-VAULT-02.delete")}</T>} a11y={t("HM-VAULT-02.delete")} disabled={busy} onPress={askDelete} />
            </Group>
          </View>
        ) : null}
      </Page>
    );
  }

  const set = (k: keyof Form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  const g = normalizeGenerator(gen);
  // Keyboards must not learn or suggest anything typed here.
  const quiet = { importantForAutofill: "no" as const };
  return (
    <Page
      title={t(id ? "HM-VAULT-02.editTitle" : "HM-VAULT-02.addTitle")}
      footer={
        <Footer>
          <Btn label={t("HM-VAULT-02.save")} icon="fingerprint" busy={busy} style={{ flexGrow: 1 }} onPress={() => void save()} />
          <Btn label={t("HM-VAULT-02.cancel")} kind="text" onPress={() => { setForm(EMPTY); if (id) setMode("view"); else back(); }} />
        </Footer>
      }
    >
      <View style={{ gap: s.lg }}>
        {noteView}
        {problems.length ? (
          <Card tone="coral">
            <View accessibilityRole="alert" style={{ gap: s.xs }}>
              {problems.map((pr) => <Note key={pr} icon="circle-alert" tone="coral" text={t(`HM-VAULT-02.problem.${pr}`)} textColor="text" />)}
            </View>
          </Card>
        ) : null}
        <Input label={t("HM-VAULT-02.name")} value={form.name} onChange={set("name")} field={{ ...quiet, autoCapitalize: "sentences" }} />
        <Input label={t("HM-VAULT-02.originsInput")} hint={t("HM-VAULT-02.originsHint")} value={form.origins} onChange={set("origins")} mono field={{ ...quiet, multiline: true, keyboardType: "url" }} />
        <Input label={t("HM-VAULT-02.username")} value={form.username} onChange={set("username")} field={quiet} />
        <View style={{ gap: s.xs }}>
          <Input
            label={t("HM-VAULT-02.secret")}
            value={form.secret}
            onChange={set("secret")}
            mono
            field={{ ...quiet, secureTextEntry: !typedVisible, keyboardType: typedVisible ? "visible-password" : "default" }}
          />
          <Btn label={t(typedVisible ? "HM-VAULT-02.hideTyped" : "HM-VAULT-02.showTyped")} kind="text" icon="eye" onPress={() => setTypedVisible(!typedVisible)} />
        </View>

        <Card>
          <T v="bodyStrong" role="header">{t("HM-VAULT-02.generator")}</T>
          <View style={{ flexDirection: "row", alignItems: "center", gap: s.md, marginTop: s.sm }}>
            <Btn label="−" kind="secondary" small a11y={t("HM-VAULT-02.shorter")} onPress={() => setGen({ ...g, length: g.length - 1 })} disabled={g.length <= GENERATOR_LIMITS.min} />
            <T v="bodyStrong" center live="polite" style={{ flex: 1 }}>{t("HM-VAULT-02.length", { length: g.length })}</T>
            <Btn label="+" kind="secondary" small a11y={t("HM-VAULT-02.longer")} onPress={() => setGen({ ...g, length: g.length + 1 })} disabled={g.length >= GENERATOR_LIMITS.max} />
          </View>
          {CLASSES.map((c) => (
            <View key={c} style={{ flexDirection: "row", alignItems: "center", minHeight: 48 }}>
              <T v="body" style={{ flex: 1 }}>{t(`HM-VAULT-02.class.${c}`)}</T>
              <Toggle on={g[c]} label={t(`HM-VAULT-02.class.${c}`)} onChange={(v) => setGen({ ...g, [c]: v })} />
            </View>
          ))}
          <Btn label={t("HM-VAULT-02.generate")} kind="secondary" icon="refresh-cw" style={{ marginTop: s.sm }} onPress={() => setForm((f) => ({ ...f, secret: vault.generate(g) }))} />
        </Card>

        <Input label={t("HM-VAULT-02.notes")} value={form.notes} onChange={set("notes")} field={{ ...quiet, multiline: true, autoCapitalize: "sentences" }} />
      </View>
    </Page>
  );
}

/**
 * One field of the login: a tile, the label over the value or "Hidden" (never a secret until the fingerprint), and its
 * copy button. The label and value are one TalkBack stop; the copy button is its own.
 */
function Secret({ icon, label, value, mono, hidden, onCopy, copyLabel }: { icon: IconName; label: string; value: string; mono?: boolean; hidden?: boolean; onCopy?: () => void; copyLabel?: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: s.md, minHeight: 56, paddingVertical: s.md, paddingLeft: s.lg, paddingRight: copyLabel ? s.xs : s.lg }}>
      <Tile icon={icon} />
      <View style={{ flex: 1, gap: 2 }} accessible accessibilityLabel={`${label}: ${value}`}>
        <T v="small" color="soft">{label}</T>
        <T v={mono ? "mono" : "body"} color={hidden ? "soft" : "text"} selectable={false}>{value}</T>
      </View>
      {copyLabel ? <IconBtn icon="copy" label={copyLabel} tone="accent" disabled={!onCopy} onPress={onCopy} /> : null}
    </View>
  );
}
