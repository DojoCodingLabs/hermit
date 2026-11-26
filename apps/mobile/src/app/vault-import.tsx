// HM-VAULT-03: import passwords from a CSV (US-VAULT-03, FR-VAULT-03). The rules live in @hermit/core (vault-import)
// and @hermit/runtime (prepareImport, commitImport). The file comes from the system document picker (no storage
// permission) and is read into memory only; this screen never holds its content, only the preview: names, sites and
// counts. States: start, ST-LOAD (reading), ST-ERROR (the file is refused, with why), locked (unlock to read the file
// again), ST-IDEAL (the preview, duplicates with a choice each, refused rows with their reasons), ST-PROCESSING
// (importing behind one fingerprint) and ST-SUCCESS (counts, and the offer to delete the file). FLAG_SECURE while shown.
// Design pass: start, locked, refused and done are the crab with one action; the preview is a grouped list with each
// duplicate's choice as a segmented control, refused rows on the page color with a coral mark, and Import pinned.
import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, SectionList, StyleSheet, View } from "react-native";
import { IMPORT_LIMITS, type DuplicateChoice, type ImportPreview, type ImportRefused, type RowProblem } from "@hermit/core";
import type { VaultImportCounts } from "@hermit/runtime";
import { deleteCsvFile, pickCsvFile, readCsvFile, type PickedDocument } from "../adapters";
import { Btn, Card, Empty, Footer, Label, Loading, Note, Notice, Page, Segmented, T } from "../components/kit";
import { useHermit } from "../hermit-context";
import { t } from "../i18n";
import { useSecureScreen } from "../secure-screen";
import { radius, s } from "../theme";
import { usePalette } from "../use-palette";
import { choicesFor, importCounts, pickedReadable } from "../vault-import-view";

type Refusal = "too_large" | "too_many_rows" | "not_utf8" | "bad_csv" | "empty" | "no_rows" | "unknown_format" | "unreadable" | "no_picker";
type Phase =
  | { kind: "start" }
  | { kind: "locked" }
  | { kind: "reading" }
  | { kind: "refused"; problem: Refusal }
  | { kind: "preview"; preview: ImportPreview }
  | { kind: "importing"; preview: ImportPreview }
  | { kind: "done"; counts: VaultImportCounts };
type Note = "cancelled" | "failed" | "expired" | "deleted" | "deleteFailed";
type Ready = ImportPreview["ready"][number];

/** How often the preview checks the idle rule (Q83): a locked vault has dropped the rows, so the preview goes too. */
const TICK_MS = 5_000;

const problemsText = (problems: readonly RowProblem[]) => problems.map((p) => t(`HM-VAULT-03.problem.${p}`)).join(", ");

export default function VaultImport() {
  const p = usePalette();
  const router = useRouter();
  const { status } = useHermit();
  const vault = status.kind === "ready" ? status.hermit.vault : undefined;
  const [phase, setPhase] = useState<Phase>({ kind: "start" });
  const [picked, setPicked] = useState<PickedDocument>();
  const [choices, setChoices] = useState<Record<number, DuplicateChoice>>({});
  const [note, setNote] = useState<Note>();
  const [busy, setBusy] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const vaultRef = useRef(vault);
  vaultRef.current = vault;
  useSecureScreen();

  // Leaving the screen drops whatever was read from the file.
  useEffect(() => () => vaultRef.current?.cancelImport(), []);

  useEffect(() => {
    if (!vault) return;
    void vault.status().then((s) => {
      if (s === "none" || s === "lost") router.back();
      else if (s === "locked") setPhase({ kind: "locked" });
    });
  }, [vault, router]);

  useEffect(() => {
    if (!vault || phase.kind !== "preview") return;
    const id = setInterval(() => {
      if (!vault.isUnlocked()) setPhase({ kind: "locked" });
    }, TICK_MS);
    return () => clearInterval(id);
  }, [vault, phase.kind]);

  const read = useCallback(
    async (file: PickedDocument) => {
      if (!vault) return;
      if (!vault.isUnlocked()) return setPhase({ kind: "locked" });
      if (!pickedReadable(file, IMPORT_LIMITS.bytes)) return setPhase({ kind: "refused", problem: "too_large" });
      setPhase({ kind: "reading" });
      const got = await readCsvFile(file.uri, IMPORT_LIMITS.bytes);
      if (got.kind !== "bytes") return setPhase({ kind: "refused", problem: got.kind });
      const r = await vault.prepareImport(got.bytes);
      setChoices({});
      if (r.kind === "preview") setPhase({ kind: "preview", preview: r.preview });
      else if (r.kind === "refused") setPhase({ kind: "refused", problem: r.problem });
      else if (r.kind === "locked") setPhase({ kind: "locked" });
      else router.back();
    },
    [vault, router],
  );

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

  const choose = () =>
    run(async () => {
      if (!vault) return;
      // The picker sends Hermit to the background: counted like Hermit's own prompt, so a quick pick doesn't lock.
      vault.event({ type: "prompt_open" });
      let r: Awaited<ReturnType<typeof pickCsvFile>>;
      try {
        r = await pickCsvFile();
      } finally {
        vault.event({ type: "prompt_close" });
      }
      if (r.kind === "no_picker") return setPhase({ kind: "refused", problem: "no_picker" });
      if (r.kind === "cancelled") return;
      setPicked(r.file);
      setDeleted(false);
      await read(r.file);
    });

  const unlock = () =>
    run(async () => {
      if (!vault) return;
      const r = await vault.unlock(t("HM-VAULT-03.unlockPrompt"));
      if (r === "cancelled") return setNote("cancelled");
      if (r !== "unlocked") return router.back();
      if (picked) await read(picked);
      else setPhase({ kind: "start" });
    });

  const commit = (preview: ImportPreview) =>
    run(async () => {
      if (!vault) return;
      setPhase({ kind: "importing", preview });
      const r = await vault.commitImport(choices, t("HM-VAULT-03.importPrompt"));
      if (r.kind === "imported") return setPhase({ kind: "done", counts: r.counts });
      if (r.kind === "cancelled") {
        setPhase({ kind: "preview", preview });
        return setNote("cancelled");
      }
      if (r.kind === "locked") return setPhase({ kind: "locked" });
      if (r.kind === "nothing_pending") {
        setPhase({ kind: "start" });
        return setNote("expired");
      }
      router.back();
    });

  const pick = (row: number, choice: DuplicateChoice) => {
    vault?.event({ type: "active", at: Date.now() });
    setChoices((c) => ({ ...c, [row]: choice }));
  };

  const askDelete = () => {
    if (!picked) return;
    Alert.alert(t("HM-VAULT-03.deleteTitle"), t("HM-VAULT-03.deleteBody", { name: picked.name ?? t("HM-VAULT-03.fileFallback") }), [
      { text: t("HM-VAULT-03.deleteCancel"), style: "cancel" },
      {
        text: t("HM-VAULT-03.deleteConfirm"),
        style: "destructive",
        onPress: () =>
          void run(async () => {
            const ok = await deleteCsvFile(picked.uri);
            setDeleted(ok);
            setNote(ok ? "deleted" : "deleteFailed");
          }),
      },
    ]);
  };

  const noteView = note ? <Notice tone={note === "deleted" ? "ok" : "bad"} text={t(`HM-VAULT-03.note.${note}`)} /> : null;

  if (phase.kind === "reading" || phase.kind === "importing") {
    return (
      <Page title={t("HM-VAULT-03.title")}>
        <Loading text={t(phase.kind === "reading" ? "HM-VAULT-03.reading" : "HM-VAULT-03.importing")} />
      </Page>
    );
  }

  if (phase.kind === "start" || phase.kind === "locked" || phase.kind === "refused") {
    const k = phase.kind;
    return (
      <Page title={t("HM-VAULT-03.title")}>
        <Empty
          pose={k === "refused" ? "error" : "idle"}
          title={t(k === "start" ? "HM-VAULT-03.startTitle" : k === "locked" ? "HM-VAULT-03.lockedTitle" : "HM-VAULT-03.refusedTitle")}
          body={k === "refused" ? (
            <View accessibilityRole="alert"><T v="body" center>{t(`HM-VAULT-03.refused.${phase.problem}`)}</T></View>
          ) : t(k === "start" ? "HM-VAULT-03.startBody" : "HM-VAULT-03.lockedBody")}
        >
          {k === "start" ? <Card><Note icon="shield-check" text={t("HM-VAULT-03.private")} textColor="text" /></Card> : null}
          {noteView}
          {k === "locked" ? (
            <Btn label={t("HM-VAULT-03.unlock")} icon="fingerprint" full busy={busy} onPress={() => void unlock()} />
          ) : (
            <Btn label={t(k === "start" ? "HM-VAULT-03.choose" : "HM-VAULT-03.chooseAgain")} icon="download" full busy={busy} onPress={() => void choose()} />
          )}
        </Empty>
      </Page>
    );
  }

  if (phase.kind === "done") {
    const c = phase.counts;
    return (
      <Page title={t("HM-VAULT-03.title")} footer={<Footer><Btn label={t("HM-VAULT-03.done")} kind={deleted || !picked?.canDelete ? "primary" : "secondary"} style={{ flexGrow: 1 }} onPress={() => router.back()} /></Footer>}>
        <Empty pose="done" title={t("HM-VAULT-03.doneTitle")} body={<T v="body" center live="polite">{t("HM-VAULT-03.doneBody", { ...c })}</T>}>
          {/* The CSV holds every password in plain text: amber, "needs you", until it is deleted. */}
          {!deleted ? <Card tone="amber"><Note icon="triangle-alert" tone="amber" text={t("HM-VAULT-03.deleteReminder")} textColor="text" /></Card> : null}
          {noteView}
          {!deleted && picked?.canDelete ? <Btn label={t("HM-VAULT-03.delete")} kind="coral" icon="trash-2" full busy={busy} onPress={askDelete} /> : null}
          {!deleted && picked && !picked.canDelete ? <T v="small" color="soft" center>{t("HM-VAULT-03.deleteUnsupported")}</T> : null}
        </Empty>
      </Page>
    );
  }

  const { preview } = phase;
  const counts = importCounts(preview, choices);
  const sections = [
    { key: "ready", title: t("HM-VAULT-03.sectionReady"), data: preview.ready as (Ready | ImportRefused)[] },
    { key: "refused", title: t("HM-VAULT-03.sectionRefused"), data: preview.refused as (Ready | ImportRefused)[] },
  ].filter((s) => s.data.length);

  return (
    <Page
      title={t("HM-VAULT-03.previewTitle")}
      scroll={false}
      footer={
        <Footer>
          <Btn
            label={counts.toWrite ? t("HM-VAULT-03.import", { count: counts.toWrite }) : t("HM-VAULT-03.importNone")}
            icon="fingerprint"
            busy={busy}
            disabled={!counts.toWrite}
            style={{ flexGrow: 1 }}
            onPress={() => void commit(preview)}
          />
          <Btn
            label={t("HM-VAULT-03.cancel")}
            kind="text"
            onPress={() => {
              vault?.cancelImport();
              router.back();
            }}
          />
        </Footer>
      }
    >
      <SectionList
        sections={sections}
        keyExtractor={(item) => `${item.row}`}
        contentContainerStyle={{ paddingBottom: s.xl }}
        stickySectionHeadersEnabled={false}
        ListHeaderComponent={
          <View style={{ gap: s.sm }}>
            <T v="footnoteStrong" color="soft">{t(`HM-VAULT-03.format.${preview.format}`)}</T>
            <T v="body">{t("HM-VAULT-03.summary", { ready: preview.ready.length - counts.duplicates, duplicates: counts.duplicates, refused: counts.refused })}</T>
            {preview.extrasIgnored ? <Note icon="info" text={t("HM-VAULT-03.extras", { count: preview.extrasIgnored })} /> : null}
            {noteView}
          </View>
        }
        renderSectionHeader={({ section }) => <Label>{section.title}</Label>}
        renderItem={({ item, section, index }) =>
          section.key === "ready" ? (
            // The rows to import, as one grouped list (first and last round the container).
            <View style={{ backgroundColor: p.surface, overflow: "hidden", ...corners(index, section.data.length), borderTopWidth: index ? 1 : 0, borderTopColor: p.dark ? p.line : p.bg }}>
              <ReadyRow row={item as Ready} choice={choices[item.row] ?? "skip"} onChoose={(c) => pick(item.row, c)} />
            </View>
          ) : (
            // Refused rows sit on the page color: the coral mark keeps its contrast there (a11y-scan's pairs).
            <View style={{ paddingVertical: s.md, paddingHorizontal: s.lg, gap: 2, borderTopWidth: index ? StyleSheet.hairlineWidth : 0, borderTopColor: p.hairline }}>
              <T v="bodyStrong">{(item as ImportRefused).name || t("HM-VAULT-03.row", { row: item.row })}</T>
              {(item as ImportRefused).site ? <T v="monoSmall" color="soft">{(item as ImportRefused).site!}</T> : null}
              <Note icon="circle-x" tone="coral" textColor="text" text={`${t("HM-VAULT-03.row", { row: item.row })}: ${problemsText((item as ImportRefused).problems)}`} />
            </View>
          )
        }
      />
    </Page>
  );
}

const corners = (i: number, n: number) => ({
  borderTopLeftRadius: i === 0 ? radius.card : 0, borderTopRightRadius: i === 0 ? radius.card : 0,
  borderBottomLeftRadius: i === n - 1 ? radius.card : 0, borderBottomRightRadius: i === n - 1 ? radius.card : 0,
});

function ReadyRow({ row, choice, onChoose }: { row: Ready; choice: DuplicateChoice; onChoose(c: DuplicateChoice): void }) {
  const options = choicesFor(row);
  const labels = options.map((o) => t(`HM-VAULT-03.choice.${o}`));
  return (
    <View style={{ paddingHorizontal: s.lg, paddingVertical: s.md, gap: s.xs }}>
      <T v="bodyStrong">{row.name}</T>
      <T v="monoSmall" color="soft">{row.origins.join(", ")}</T>
      {row.dropped.map((d) => (
        <Note key={d.site} icon="triangle-alert" tone="amber" textColor="text" text={t("HM-VAULT-03.dropped", { site: d.site, reason: t(`HM-VAULT-03.problem.${d.problem}`) })} />
      ))}
      {options.length ? (
        <View style={{ gap: s.sm, marginTop: s.xs }}>
          <T v="small" color="soft">{t("HM-VAULT-03.duplicateOf", { names: row.existing.map((e) => e.name).join(", ") })}</T>
          <Segmented
            options={labels}
            value={Math.max(0, options.indexOf(choice))}
            label={row.name}
            a11yOf={(label) => t("HM-VAULT-03.choiceLabel", { choice: label, name: row.name })}
            onChange={(i) => onChoose(options[i]!)}
          />
        </View>
      ) : null}
    </View>
  );
}
