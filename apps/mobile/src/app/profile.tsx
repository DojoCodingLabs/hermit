// HM-FORM-02: the personal profile (US-FORM-03). The rules live in @hermit/runtime (createProfile): plain details are
// stored as typed in the encrypted database and listed here; a sensitive one (every ID number, and any detail the
// user marks) is sealed with the vault's key behind its fingerprint and never shown again, only filled after a
// fingerprint (HM-FORM-01). States: ST-LOAD; ST-ERROR with retry; ST-EMPTY-FIRST (nothing saved yet); ST-IDEAL (each
// detail saved, protected or not saved); editing (problems named before any fingerprint; cancelled; no vault, with a
// link to HM-VAULT-01; lost); the autofill-off note with a link to Settings. FLAG_SECURE while it shows.
import { useFocusEffect, useRouter } from "expo-router";
// Design pass: every detail as a row in one grouped list (a lock icon for a protected one, Change or Add in words); the
// row opens in place as an editor with the shared field, the protect switch, Save (with fingerprint when protected) and
// Cancel; autofill off is an amber card with Settings.
import { useCallback, useState } from "react";
import { Alert, View } from "react-native";
import { ALWAYS_SENSITIVE, PROFILE_KINDS, type ProfileKind, type ProfileProblem } from "@hermit/core";
import type { ProfileFieldView } from "@hermit/runtime";
import { autofillSelected } from "../adapters";
import type { IconName } from "../components/Icon";
import { Btn, Card, Failed, Group, Input, Loading, Note as NoteLine, Notice, Page, Row, Status, T, Toggle } from "../components/kit";
import { useHermit } from "../hermit-context";
import { t } from "../i18n";
import { useSecureScreen } from "../secure-screen";
import { s } from "../theme";

type Note = "saved" | "no_vault" | "lost" | "cancelled" | "failed";
type Editing = { kind: ProfileKind; value: string; sensitive: boolean; problem?: ProfileProblem };

export default function Profile() {
  const router = useRouter();
  const { status } = useHermit();
  const profile = status.kind === "ready" ? status.hermit.profile : undefined;
  const [rows, setRows] = useState<ProfileFieldView[]>();
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState<Editing>();
  const [note, setNote] = useState<Note>();
  const [busy, setBusy] = useState(false);
  const [autofillOn, setAutofillOn] = useState<boolean>();
  useSecureScreen();

  const load = useCallback(async () => {
    if (!profile) return;
    setFailed(false);
    try {
      setRows(await profile.list());
    } catch {
      setFailed(true);
    }
    try {
      setAutofillOn(autofillSelected());
    } catch {
      setAutofillOn(undefined);
    }
  }, [profile]);

  useFocusEffect(useCallback(() => void load(), [load]));

  const byKind = new Map((rows ?? []).map((r) => [r.kind, r]));

  const startEdit = (kind: ProfileKind) => {
    const row = byKind.get(kind);
    setNote(undefined);
    // A sensitive value is never shown again: editing it means typing a new one.
    setEditing({ kind, value: row && !row.sensitive ? row.value ?? "" : "", sensitive: row?.sensitive ?? ALWAYS_SENSITIVE.has(kind) });
  };

  const save = async (e: Editing) => {
    if (!profile) return;
    setBusy(true);
    setNote(undefined);
    try {
      const r = await profile.save(e.kind, e.value, e.sensitive, t("HM-FORM-02.savePrompt"));
      if (r.kind === "invalid") return setEditing({ ...e, problem: r.problem });
      if (r.kind === "saved") setEditing(undefined);
      setNote(r.kind);
      await load();
    } catch {
      setNote("failed");
    } finally {
      setBusy(false);
    }
  };

  const askDelete = (kind: ProfileKind) => {
    const field = t(`HM-FORM-02.kind.${kind}`);
    Alert.alert(t("HM-FORM-02.deleteTitle"), t("HM-FORM-02.deleteBody", { field }), [
      { text: t("HM-FORM-02.deleteCancel"), style: "cancel" },
      {
        text: t("HM-FORM-02.deleteConfirm"),
        style: "destructive",
        onPress: () =>
          void profile?.remove(kind).then(
            () => {
              setEditing(undefined);
              return load();
            },
            () => setNote("failed"),
          ),
      },
    ]);
  };

  if (failed || status.kind === "failed") {
    return (
      <Page title={t("HM-FORM-02.title")}>
        <Failed text={t("HM-FORM-02.error")} onRetry={() => void load()} />
      </Page>
    );
  }

  if (!rows) {
    return (
      <Page title={t("HM-FORM-02.title")}>
        <Loading text={t("HM-FORM-02.loading")} />
      </Page>
    );
  }

  return (
    <Page title={t("HM-FORM-02.title")}>
      <View style={{ gap: s.md, marginBottom: s.lg }}>
        <T v="body" color="soft">{t("HM-FORM-02.intro")}</T>
        {autofillOn === false ? (
          <Card tone="amber">
            <View style={{ gap: s.sm }}>
              <NoteLine icon="triangle-alert" tone="amber" text={t("HM-FORM-02.autofillOff")} textColor="text" />
              <Btn label={t("HM-FORM-02.openSettings")} kind="secondary" icon="settings" small onPress={() => router.push("/settings")} />
            </View>
          </Card>
        ) : null}
        {!rows.length ? <NoteLine icon="user" text={t("HM-FORM-02.empty")} textColor="text" v="body" /> : null}
        {note ? (
          <View style={{ gap: s.sm }}>
            <Notice tone={note === "saved" ? "ok" : "bad"} text={t(`HM-FORM-02.note.${note}`)} />
            {note === "no_vault" || note === "lost" ? <Btn label={t("HM-FORM-02.openVault")} kind="secondary" icon="key-round" small onPress={() => router.push("/vault")} /> : null}
          </View>
        ) : null}
      </View>

      <Group>
        {PROFILE_KINDS.map((kind) => {
          const row = byKind.get(kind);
          const label = t(`HM-FORM-02.kind.${kind}`);
          if (editing?.kind === kind) return <Editor key={kind} editing={editing} busy={busy} onChange={setEditing} onSave={() => void save(editing)} onCancel={() => setEditing(undefined)} onDelete={row ? () => askDelete(kind) : undefined} />;
          const shown = !row ? t("HM-FORM-02.notSet") : row.sensitive ? t("HM-FORM-02.protected") : row.value ?? "";
          return (
            <Row
              key={kind}
              icon={row?.sensitive ? "lock" : KIND_ICON[kind] ?? "user"}
              iconColor={row ? "mark" : "soft"}
              title={label}
              sub={<T v="small" color={row && !row.sensitive ? "text" : "soft"}>{shown}</T>}
              // A filled field opens on a tap (a chevron, not "Change" eight times); an empty one invites "Add".
              {...(row ? { chevron: true } : { trailing: <Status text={t("HM-FORM-02.add")} tone="link" /> })}
              a11y={`${label}: ${shown}`}
              hint={t(row ? "HM-FORM-02.change" : "HM-FORM-02.add")}
              disabled={editing !== undefined}
              onPress={() => startEdit(kind)}
            />
          );
        })}
      </Group>
    </Page>
  );
}

const KIND_ICON: Partial<Record<ProfileKind, IconName>> = {
  email: "mail", phone: "smartphone", street_address: "map-pin", address_line2: "map-pin", city: "map-pin", region: "map-pin", postal_code: "map-pin", country: "globe", birth_date: "calendar",
};

function Editor({ editing, busy, onChange, onSave, onCancel, onDelete }: { editing: Editing; busy: boolean; onChange(e: Editing): void; onSave(): void; onCancel(): void; onDelete?: () => void }) {
  const label = t(`HM-FORM-02.kind.${editing.kind}`);
  const locked = ALWAYS_SENSITIVE.has(editing.kind);
  return (
    <View style={{ padding: s.lg, gap: s.md }}>
      <T v="bodyStrong" role="header">{t("HM-FORM-02.editTitle", { field: label })}</T>
      {editing.sensitive ? <T v="small" color="soft">{t("HM-FORM-02.replaceHint")}</T> : null}
      <Input
        label={label}
        value={editing.value}
        invalid={!!editing.problem}
        onChange={(value) => onChange({ ...editing, value, problem: undefined })}
        field={{
          autoFocus: true,
          autoCapitalize: editing.kind === "email" ? "none" : "words",
          keyboardType: editing.kind === "email" ? "email-address" : editing.kind === "phone" ? "phone-pad" : "default",
          secureTextEntry: editing.sensitive,
          importantForAutofill: "no",
          maxLength: 400,
        }}
      />
      {editing.problem ? <Notice tone="bad" text={t(`HM-FORM-02.problem.${editing.problem}`)} /> : null}
      <View style={{ flexDirection: "row", alignItems: "center", gap: s.md }}>
        <View style={{ flex: 1 }}>
          <T v="body">{t("HM-FORM-02.sensitive")}</T>
          <T v="small" color="soft">{t(locked ? "HM-FORM-02.alwaysSensitive" : "HM-FORM-02.sensitiveHint")}</T>
        </View>
        <Toggle on={editing.sensitive} label={t("HM-FORM-02.sensitive")} disabled={locked || busy} onChange={(sensitive) => onChange({ ...editing, sensitive })} />
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: s.sm }}>
        <Btn label={t(editing.sensitive ? "HM-FORM-02.saveFingerprint" : "HM-FORM-02.save")} {...(editing.sensitive ? { icon: "fingerprint" as const } : {})} busy={busy} style={{ flexGrow: 1 }} onPress={onSave} />
        <Btn label={t("HM-FORM-02.cancel")} kind="secondary" disabled={busy} style={{ flexGrow: 1 }} onPress={onCancel} />
      </View>
      {onDelete ? <Btn label={t("HM-FORM-02.delete")} kind="text" icon="trash-2" disabled={busy} onPress={onDelete} /> : null}
    </View>
  );
}
