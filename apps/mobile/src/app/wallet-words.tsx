// HM-PAY-02: recovery words (US-PAY-01, US-PAY-02). FLAG_SECURE while it shows; nothing here copies to the clipboard
// and no field learns what is typed (no suggestions, no autofill).
// Backup (`mode=backup`): intro (the words are the wallet; nobody, including Dojo Coding, can recover them) with Show the
// words behind a fresh fingerprint; the words, numbered; the check (three of them typed); done. A wrong word drops the
// check and starts again from the intro (another fingerprint). Already backed up: never shown again.
// Restore (`mode=restore`): the words typed, checked as they are typed (count, unknown words by number, checksum); one
// fingerprint derives the wallet; the preview shows its address and balance before anything is saved; Use this wallet
// or Not my wallet; done. Leaving the screen, the app going to the background or the app lock drops what is on it.
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
// Design pass: the warning that the words are the wallet in amber before Show the words (fingerprint); the words as a
// numbered two-column grid that is never selectable; the check and restore fields in the shared style with the same
// private keyboard; the preview's address and balance in a card; each step's one action pinned at the foot.
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, View } from "react-native";
import { formatMoney, type Money, type PhraseCheck } from "@hermit/core";
import { onPrompt } from "../adapters";
import { Btn, Card, Empty, Failed, Footer, Input, Loading, Note as NoteLine, Notice, Page, T } from "../components/kit";
import { useHermit } from "../hermit-context";
import { currentLocale, t } from "../i18n";
import { LIST_MIN_DECIMALS } from "../wallet-view";
import { useSecureScreen } from "../secure-screen";
import { radius, s } from "../theme";
import { usePalette } from "../use-palette";

type Note = "cancelled" | "unavailable" | "failed" | "not_on_screen" | "lost";
type Step =
  | { kind: "intro" }
  | { kind: "working" }
  | { kind: "words"; words: string[]; positions: number[] }
  | { kind: "check"; positions: number[]; answers: string[] }
  | { kind: "backed_up" }
  | { kind: "no_wallet" }
  | { kind: "done" }
  | { kind: "restore"; text: string }
  | { kind: "preview"; address: string; balance?: Money }
  | { kind: "exists" }
  | { kind: "restored" };

/** Keyboards that learn or suggest never see the words: Android's visible-password type turns suggestions off. */
const PRIVATE_INPUT = { autoCapitalize: "none", autoCorrect: false, autoComplete: "off", importantForAutofill: "no", keyboardType: "visible-password", spellCheck: false, contextMenuHidden: true } as const;

/** The restore field's problem, in words, with 1-based word numbers. */
function problemText(check: Exclude<PhraseCheck, { ok: true }>): string {
  if (check.problem === "word_count") return t("HM-PAY-02.problem.word_count", { count: String(check.count) });
  if (check.problem === "unknown_words") return t("HM-PAY-02.problem.unknown_words", { positions: check.positions.map((p) => p + 1).join(", ") });
  return t("HM-PAY-02.problem.checksum");
}

export default function WalletWords() {
  const p = usePalette();
  const router = useRouter();
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const restoring = mode === "restore";
  const { status } = useHermit();
  const wallet = status.kind === "ready" ? status.hermit.wallet : undefined;
  const initial: Step = restoring ? { kind: "restore", text: "" } : { kind: "intro" };
  const [step, setStep] = useState<Step>(initial);
  const [note, setNote] = useState<Note>();
  const [mismatch, setMismatch] = useState(false);
  useSecureScreen();

  // Leaving the screen or the app drops the words, a pending check and a pending restore.
  const reset = useCallback(() => {
    wallet?.lock();
    setStep(restoring ? { kind: "restore", text: "" } : { kind: "intro" });
  }, [wallet, restoring]);
  useFocusEffect(useCallback(() => () => wallet?.lock(), [wallet]));
  // Hermit's own fingerprint prompt can send the app to the background for a moment; that trip is not leaving.
  const prompting = useRef(false);
  useEffect(() => onPrompt((open) => void (prompting.current = open)), []);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "background" && !prompting.current) reset();
    });
    return () => sub.remove();
  }, [reset]);

  const show = async () => {
    if (!wallet) return;
    setNote(undefined);
    setMismatch(false);
    setStep({ kind: "working" });
    const r = await wallet.reveal(t("HM-PAY-02.showPrompt")).catch(() => ({ kind: "failed" as const }));
    if (r.kind === "words") return setStep({ kind: "words", words: r.words, positions: r.positions });
    if (r.kind === "backed_up") return setStep({ kind: "backed_up" });
    if (r.kind === "none") return setStep({ kind: "no_wallet" });
    setNote(r.kind);
    setStep({ kind: "intro" });
  };

  const confirm = async (answers: string[]) => {
    if (!wallet) return;
    const r = await wallet.confirmBackup(answers).catch(() => "nothing_pending" as const);
    if (r === "confirmed") return setStep({ kind: "done" });
    setMismatch(true);
    setStep({ kind: "intro" });
  };

  const restore = async (text: string) => {
    if (!wallet) return;
    setNote(undefined);
    setStep({ kind: "working" });
    const r = await wallet.restore(text, t("HM-PAY-02.restorePrompt")).catch(() => ({ kind: "failed" as const }));
    if (r.kind === "preview") return setStep(r.balance ? { kind: "preview", address: r.address, balance: r.balance } : { kind: "preview", address: r.address });
    if (r.kind === "exists") return setStep({ kind: "exists" });
    if (r.kind !== "invalid") setNote(r.kind);
    setStep({ kind: "restore", text });
  };

  const use = async () => {
    if (!wallet) return;
    const r = await wallet.commitRestore().catch(() => "nothing_pending" as const);
    if (r === "restored") return setStep({ kind: "restored" });
    setNote("failed");
    setStep({ kind: "restore", text: "" });
  };

  const notMine = async () => {
    await wallet?.cancelRestore().catch(() => {});
    setStep({ kind: "restore", text: "" });
  };

  const noteView = note ? <Notice tone="bad" text={t(`HM-PAY-02.note.${note}`)} /> : null;
  const backToWallet = <Btn label={t("HM-PAY-02.back")} icon="wallet" full onPress={() => router.back()} />;
  const title = t(restoring ? "HM-PAY-02.restoreTitle" : "HM-PAY-02.title");

  if (!wallet) {
    return (
      <Page title={title}>
        <Failed text={t("HM-PAY-01.notInBuild")} />
      </Page>
    );
  }

  switch (step.kind) {
    case "working":
      return (
        <Page title={title}>
          <Loading text={t("HM-PAY-02.working")} />
        </Page>
      );
    case "intro":
      return (
        <Page title={title} footer={<Footer><Btn label={t("HM-PAY-02.show")} icon="fingerprint" style={{ flexGrow: 1 }} onPress={() => void show()} /></Footer>}>
          <View style={{ gap: s.lg }}>
            {/* The words are the wallet: amber, "needs you", before anything is shown. */}
            <Card tone="amber">
              <NoteLine icon="key-round" tone="amber" text={t("HM-PAY-02.intro")} textColor="text" v="body" />
            </Card>
            <NoteLine icon="pen-line" text={t("HM-PAY-02.paper")} textColor="text" />
            {mismatch ? <Notice tone="bad" text={t("HM-PAY-02.mismatch")} /> : null}
            {noteView}
          </View>
        </Page>
      );
    case "words":
      return (
        <Page
          title={title}
          footer={<Footer><Btn label={t("HM-PAY-02.wrote")} icon="check" style={{ flexGrow: 1 }} onPress={() => setStep({ kind: "check", positions: step.positions, answers: step.positions.map(() => "") })} /></Footer>}
        >
          <NoteLine icon="pen-line" text={t("HM-PAY-02.paper")} textColor="text" />
          {/* Numbered, two columns, never selectable; nothing here reaches the clipboard. */}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: s.sm, marginTop: s.lg }}>
            {step.words.map((word, i) => (
              <View key={i} style={{ flexBasis: "47%", flexGrow: 1, flexDirection: "row", alignItems: "center", gap: s.sm, backgroundColor: p.surface, borderRadius: radius.field, paddingVertical: s.md, paddingHorizontal: s.md, minHeight: 48 }} accessible accessibilityLabel={t("HM-PAY-02.wordLabel", { n: String(i + 1), word })}>
                <T v="monoSmall" color="soft" style={{ minWidth: 20, textAlign: "right" }}>{`${i + 1}`}</T>
                <T v="mono" selectable={false} style={{ fontSize: 16 }}>{word}</T>
              </View>
            ))}
          </View>
        </Page>
      );
    case "check": {
      const [a, b, c] = step.positions.map((x) => String(x + 1));
      return (
        <Page title={t("HM-PAY-02.checkTitle")} footer={<Footer><Btn label={t("HM-PAY-02.confirm")} style={{ flexGrow: 1 }} onPress={() => void confirm(step.answers)} /></Footer>}>
          <View style={{ gap: s.lg }}>
            <T v="body" color="soft">{t("HM-PAY-02.checkBody", { a: a!, b: b!, c: c! })}</T>
            {step.positions.map((pos, i) => (
              <Input
                key={pos}
                label={t("HM-PAY-02.checkField", { n: String(pos + 1) })}
                value={step.answers[i]!}
                mono
                onChange={(v) => setStep({ ...step, answers: step.answers.map((x, j) => (j === i ? v : x)) })}
                field={PRIVATE_INPUT}
              />
            ))}
          </View>
        </Page>
      );
    }
    case "done":
    case "restored":
      return (
        <Page title={title}>
          <Empty pose="done" title={t(step.kind === "done" ? "HM-PAY-02.doneTitle" : "HM-PAY-02.restoredTitle")} body={t(step.kind === "done" ? "HM-PAY-02.doneBody" : "HM-PAY-02.restoredBody")}>
            {backToWallet}
          </Empty>
        </Page>
      );
    case "backed_up":
    case "no_wallet":
    case "exists":
      return (
        <Page title={title}>
          <Empty pose="idle" body={t(step.kind === "backed_up" ? "HM-PAY-02.alreadyBackedUp" : step.kind === "exists" ? "HM-PAY-02.exists" : "HM-PAY-02.noWallet")}>
            {backToWallet}
          </Empty>
        </Page>
      );
    case "restore": {
      const check = step.text.trim() ? wallet.checkPhrase(step.text) : undefined;
      const count = step.text.trim() ? step.text.trim().split(/\s+/).length : 0;
      return (
        <Page title={title} footer={<Footer><Btn label={t("HM-PAY-02.restoreCheck")} icon="fingerprint" disabled={!check?.ok} style={{ flexGrow: 1 }} onPress={() => void restore(step.text)} /></Footer>}>
          <View style={{ gap: s.lg }}>
            <T v="body" color="soft">{t("HM-PAY-02.restoreBody")}</T>
            <Card tone="amber">
              <NoteLine icon="key-round" tone="amber" text={t("HM-PAY-02.intro")} textColor="text" />
            </Card>
            <View style={{ gap: s.xs }}>
              <Input label={t("HM-PAY-02.restoreField")} value={step.text} mono onChange={(text) => setStep({ kind: "restore", text })} field={{ ...PRIVATE_INPUT, multiline: true }} />
              <T v="small" color="soft" live="polite">{t("HM-PAY-02.restoreCount", { count: String(count) })}</T>
            </View>
            {check && !check.ok && count >= 12 ? <Notice tone="bad" text={problemText(check)} /> : null}
            {noteView}
          </View>
        </Page>
      );
    }
    case "preview":
      return (
        <Page
          title={t("HM-PAY-02.previewTitle")}
          footer={
            <Footer>
              <Btn label={t("HM-PAY-02.use")} icon="check" style={{ flexGrow: 1 }} onPress={() => void use()} />
              <Btn label={t("HM-PAY-02.notMine")} kind="secondary" style={{ flexGrow: 1 }} onPress={() => void notMine()} />
            </Footer>
          }
        >
          <View style={{ gap: s.lg }}>
            <T v="body" color="soft">{t("HM-PAY-02.previewBody")}</T>
            <Card>
              <T v="mono" selectable>{step.address}</T>
              <T v="lead" style={{ marginTop: s.md }}>
                {step.balance ? t("HM-PAY-02.previewBalance", { amount: formatMoney(step.balance, currentLocale(), 2, LIST_MIN_DECIMALS) }) : t("HM-PAY-02.previewBalanceUnknown")}
              </T>
            </Card>
          </View>
        </Page>
      );
  }
}
