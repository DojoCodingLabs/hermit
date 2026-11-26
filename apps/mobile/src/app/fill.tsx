// HM-FORM-01: the fill preview (US-FORM-01, FR-FORM-01, Q79), and HM-APPR-01 for a login (SL-36, US-FORM-02).
// Android's autofill service opens it (hermit://fill) when the user taps Hermit's suggestion in another app's form.
// The rules live in @hermit/runtime (createFormFill): the requester is identified again with the exact-origin rule,
// the cage decides the fill in the signed log, and this sheet shows who gets what: the requester by its verified
// identity (a website reported by a trusted browser, or an app by its package and signing key).
// - A profile form: each field with its value, a sensitive one masked. Fill is a tap for plain fields and the vault's
//   fingerprint when any field is sensitive.
// - A login: the login's name and which fields fill, never the username or the password. Approve is the approval
//   key's fingerprint, whose system prompt shows the site (or app) and browser from the signed payload, then the
//   vault's fingerprint to open the login.
// Then the values go back to Android and the user is back in the form, where sending stays their own tap. States:
// ST-LOAD; refused (each reason in its own words, with Back to the form, and Set up the approval key when it's
// missing); ST-IDEAL preview (the not-secure warning and held-back fields for a profile form); cancelled fingerprint
// (stays); done (filled, denied, expired, changed, lost, not signed, ended). FLAG_SECURE while it shows.
// Design pass: laid out like the approval sheets (A1 to A3): the asking crab and the amber Needs your OK chip, the title,
// who asks and what fills as grouped lists (a login's username and password are only ever the mask), "Signed on this
// phone" at the foot of a login, and the approve button with the fingerprint pinned with Deny under it.
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import type { FillPrepared, FillRefusal, Requester } from "@hermit/runtime";
import { ApprovalSignError, cancelFill, completeFill, pendingFill, signLogin } from "../adapters";
import { Btn, Card, Empty, Footer, Group, Label, Loading, Note as NoteLine, Notice, Page, Row, T } from "../components/kit";
import { NeedsOk, SignedFoot } from "../components/Sheet";
import { useHermit } from "../hermit-context";
import { t } from "../i18n";
import { useSecureScreen } from "../secure-screen";
import { s } from "../theme";

type Preview = Extract<FillPrepared, { kind: "preview" }>;
type Login = Extract<FillPrepared, { kind: "login" }>;
type Done = "filled" | "denied" | "expired" | "changed" | "lost" | "not_on_screen" | "gone" | "failed" | "not_signed" | "key_lost" | "no_biometric";
type View_ =
  | { kind: "loading" }
  | { kind: "refused"; reason: FillRefusal | "ended" | "no_module" | "not_ready" }
  | { kind: "preview"; preview: Preview; note?: "cancelled" }
  | { kind: "login"; login: Login; note?: "cancelled" | "lockout" }
  | { kind: "done"; outcome: Done; login?: boolean };

const MASK = "••••••";

/** Login outcomes with their own words; the rest read the same for a form and a login. */
const LOGIN_DONE: ReadonlySet<Done> = new Set(["filled", "changed", "lost", "not_signed", "key_lost", "no_biometric"]);

/** Refusals that the approval key screen fixes. */
const KEY_SETUP: ReadonlySet<string> = new Set(["key_none", "key_lost"]);

export default function Fill() {
  const router = useRouter();
  const { request } = useLocalSearchParams<{ request?: string }>();
  const { status } = useHermit();
  const forms = status.kind === "ready" ? status.hermit.forms : undefined;
  const [view, setView] = useState<View_>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  /** The preview still waiting for an answer: leaving the screen denies it and ends the native request. */
  const open = useRef<string | undefined>(undefined);
  useSecureScreen();

  useEffect(() => {
    if (!request) return setView({ kind: "refused", reason: "ended" });
    // Hermit can't fill (it failed to start, or this build has no vault): say so and end the waiting request now,
    // instead of leaving the other app waiting for its timeout.
    const cannot = status.kind === "failed" || status.kind === "not_wired" || status.kind === "erase_pending" || (status.kind === "ready" && !forms);
    if (cannot) {
      cancelFill(request);
      return setView({ kind: "refused", reason: "not_ready" });
    }
    if (!forms) return; // still starting: ST-LOAD
    const pending = pendingFill(request);
    if (pending.kind !== "request") return setView({ kind: "refused", reason: pending.kind });
    let live = true;
    void forms.prepare(pending.request).then(
      (r) => {
        if (r.kind !== "refused") open.current = r.id;
        if (!live) return;
        if (r.kind === "preview") setView({ kind: "preview", preview: r });
        else if (r.kind === "login") setView({ kind: "login", login: r });
        else setView({ kind: "refused", reason: r.reason });
      },
      () => live && setView({ kind: "refused", reason: "bad_request" }),
    );
    return () => {
      live = false;
    };
  }, [request, forms, status.kind]);

  // Leaving with a preview unanswered is a no: it is signed as denied and the other app stops waiting.
  useEffect(
    () => () => {
      const id = open.current;
      if (!id) return;
      open.current = undefined;
      void forms?.deny(id).catch(() => {});
      if (request) cancelFill(request);
    },
    [forms, request],
  );

  /** Back to the other app with nothing filled. */
  const leave = () => {
    if (request) cancelFill(request);
  };

  /** The values go to Android; the log records whether they got there. */
  const hand = async (id: string, values: Record<string, string>, login: boolean) => {
    if (!forms || !request) return;
    const ok = completeFill(request, values);
    await forms.delivered(id, ok);
    setView({ kind: "done", outcome: ok ? "filled" : "gone", login });
  };

  const approve = async (preview: Preview) => {
    if (!forms || !request) return;
    setBusy(true);
    try {
      const r = await forms.approve(preview.id, t("HM-FORM-01.prompt"));
      if (r.kind === "cancelled") return setView({ kind: "preview", preview, note: "cancelled" });
      if (r.kind !== "not_on_screen") open.current = undefined;
      if (r.kind !== "fill") {
        setView({ kind: "done", outcome: r.kind === "not_signed" ? "failed" : r.kind });
        return;
      }
      await hand(preview.id, r.values, false);
    } catch {
      setView({ kind: "done", outcome: "failed" });
    } finally {
      setBusy(false);
    }
  };

  /**
   * SL-36: two fingerprints. The approval key's prompt signs this login's exact payload (the system prompt shows the
   * site or app and the browser from it); the runtime verifies it, then the vault's own prompt opens the login.
   */
  const approveLogin = async (login: Login) => {
    if (!forms || !request) return;
    setBusy(true);
    try {
      let signature: string;
      try {
        signature = await signLogin(login.signed.message);
      } catch (e) {
        const code = e instanceof ApprovalSignError ? e.code : "failed";
        if (code === "cancelled" || code === "lockout") return setView({ kind: "login", login, note: code });
        // The key is gone or the approval can't be signed: this login ends here, signed as denied.
        open.current = undefined;
        await forms.deny(login.id).catch(() => {});
        setView({ kind: "done", outcome: code === "lost" ? "key_lost" : code === "expired" ? "expired" : code === "no_biometric" ? "no_biometric" : "not_signed", login: true });
        return;
      }
      const r = await forms.approve(login.id, t("HM-APPR-01.login.vaultPrompt"), signature);
      if (r.kind === "cancelled") return setView({ kind: "login", login: r.signed ? { ...login, signed: r.signed } : login, note: "cancelled" });
      if (r.kind !== "not_on_screen") open.current = undefined;
      if (r.kind !== "fill") {
        setView({ kind: "done", outcome: r.kind === "not_signed" ? (r.reason === "key_lost" ? "key_lost" : "not_signed") : r.kind, login: true });
        return;
      }
      await hand(login.id, r.values, true);
    } catch {
      setView({ kind: "done", outcome: "failed", login: true });
    } finally {
      setBusy(false);
    }
  };

  const deny = async (id: string, login: boolean) => {
    open.current = undefined;
    await forms?.deny(id).catch(() => {});
    setView({ kind: "done", outcome: "denied", login });
    leave();
  };

  // The header follows the mode: a login says so, never "Fill this form?" over "Log in with Hermit?".
  const loginMode = view.kind === "login" || (view.kind === "done" && view.login === true);
  const title = t(loginMode ? "HM-APPR-01.login.title" : "HM-FORM-01.title");

  if (view.kind === "loading") {
    return (
      <Page title={title} back={false}>
        <Loading text={t("HM-FORM-01.loading")} />
      </Page>
    );
  }

  if (view.kind === "refused" || view.kind === "done") {
    const message =
      view.kind === "refused"
        ? t(`HM-FORM-01.refused.${view.reason}`)
        : view.login && LOGIN_DONE.has(view.outcome)
          ? t(`HM-APPR-01.login.done.${view.outcome}`)
          : t(`HM-FORM-01.done.${view.outcome}`);
    const filled = view.kind === "done" && view.outcome === "filled";
    const setUp = (view.kind === "refused" && KEY_SETUP.has(view.reason)) || (view.kind === "done" && view.outcome === "key_lost");
    return (
      <Page title={title} back={false}>
        <Empty pose={filled ? "done" : view.kind === "done" && view.outcome === "denied" ? "idle" : "blocked"} body={<View accessibilityRole="alert"><T v="body" center>{message}</T></View>}>
          {setUp ? <Btn label={t("HM-APPR-01.signed.setUp")} icon="fingerprint" full onPress={() => router.push("/approval-key")} /> : null}
          {filled ? null : <Btn label={t("HM-FORM-01.close")} kind="secondary" full onPress={leave} />}
        </Empty>
      </Page>
    );
  }

  /** Who asks, by verified identity: the same block on both sheets. */
  const who = (r: Requester) =>
    r.kind === "web" ? (
      <View accessible accessibilityLabel={`${t("HM-FORM-01.site")}: ${r.origin}`}>
        <Row icon="globe" top title={<T v="small" color="soft">{t("HM-FORM-01.site")}</T>} sub={<View><T v="mono" selectable>{r.origin}</T><T v="small" color="soft">{t("HM-FORM-01.browser", { browser: r.browser })}</T></View>} />
      </View>
    ) : (
      <View accessible accessibilityLabel={`${t("HM-FORM-01.app")}: ${r.label ?? r.packageName}, ${r.packageName}`}>
        <Row
          icon="smartphone"
          top
          title={<T v="small" color="soft">{t("HM-FORM-01.app")}</T>}
          sub={<View><T v="body" selectable>{r.label ? t("HM-FORM-01.appValue", { label: r.label, package: r.packageName }) : r.packageName}</T><T v="monoSmall" color="soft">{t("HM-FORM-01.appKey", { key: r.key })}</T><T v="small" color="soft">{t("HM-FORM-01.appCheck")}</T></View>}
        />
      </View>
    );

  /** One field that fills, with its value or the mask; a secret is never shown here. */
  const field = (key: string, label: string, value: string, spoken: string, note?: string) => (
    <View key={key} accessible accessibilityLabel={`${label}: ${spoken}`}>
      <Row top title={<T v="small" color="soft">{label}</T>} sub={<View><T v="body">{value}</T>{note ? <T v="small" color="soft">{note}</T> : null}</View>} />
    </View>
  );

  if (view.kind === "login") {
    const { login, note } = view;
    return (
      <Page
        title={undefined}
        back={false}
        footer={
          <Footer>
            <Btn label={t("HM-APPR-01.login.approve")} icon="fingerprint" full busy={busy} onPress={() => void approveLogin(login)} />
            <Btn label={t("HM-APPR-01.login.deny")} kind="text" full disabled={busy} onPress={() => void deny(login.id, true)} />
          </Footer>
        }
      >
        {/* PDR-013: TalkBack reads the login, who asks, what fills and the notes, and only then the buttons. */}
        <NeedsOk label={t("HM-APPR-01.needsOk")} />
        <T v="display" role="header">{t("HM-APPR-01.login.title")}</T>
        <Group style={{ marginTop: s.lg }}>
          <View accessible accessibilityLabel={`${t("HM-APPR-01.login.item")}: ${login.name}`}>
            <Row icon="key-round" top title={<T v="small" color="soft">{t("HM-APPR-01.login.item")}</T>} sub={<View style={{ gap: 2 }}><T v="bodyStrong">{login.name}</T><T v="footnote" color="soft">{t("HM-APPR-01.login.source")}</T></View>} />
          </View>
          {who(login.requester)}
        </Group>

        <Label>{t("HM-FORM-01.fields")}</Label>
        <Group>
          {login.fields.map((k) => field(k, t(`HM-APPR-01.login.${k}`), MASK, t("HM-APPR-01.login.hidden"), t("HM-APPR-01.login.hidden")))}
        </Group>
        <SignedFoot text={t("HM-APPR-01.signedFoot")} />
        <View style={{ gap: s.sm, marginTop: s.md }}>
          <T v="caption" color="soft">{t("HM-APPR-01.login.signedNote")}</T>
          <T v="caption" color="soft">{t("HM-APPR-01.login.vaultNote")}</T>
          <T v="caption" color="soft">{t("HM-APPR-01.login.submitNote")}</T>
          {note ? <Notice tone="bad" text={t(`HM-APPR-01.login.note.${note}`)} /> : null}
        </View>
      </Page>
    );
  }

  const { preview, note } = view;
  const r = preview.requester;
  const approveLabel = t(preview.requireBiometric ? "HM-FORM-01.approveFingerprint" : "HM-FORM-01.approve");
  return (
    <Page
      back={false}
      footer={
        <Footer>
          <Btn label={approveLabel} {...(preview.requireBiometric ? { icon: "fingerprint" as const } : {})} full busy={busy} onPress={() => void approve(preview)} />
          <Btn label={t("HM-FORM-01.deny")} kind="text" full disabled={busy} onPress={() => void deny(preview.id, false)} />
        </Footer>
      }
    >
      {/* PDR-013: TalkBack reads who asks, any warning, each field in order, and only then the buttons. */}
      <NeedsOk label={t("HM-APPR-01.needsOk")} />
      <T v="display" role="header">{t("HM-FORM-01.title")}</T>
      <Group style={{ marginTop: s.lg }}>{who(r)}</Group>
      {r.kind === "web" && !r.secure ? (
        <Card tone="coral" style={{ marginTop: s.md }}>
          <NoteLine icon="shield-alert" tone="coral" text={t("HM-FORM-01.notSecure")} textColor="text" />
        </Card>
      ) : null}

      <Label>{t("HM-FORM-01.fields")}</Label>
      <Group>
        {preview.lines.map((l) => {
          const label = t(`HM-FORM-02.kind.${l.kind}`);
          const value = l.sensitive ? MASK : l.value ?? "";
          return field(l.key, label, value, l.sensitive ? t("HM-FORM-01.masked") : value, l.sensitive ? t("HM-FORM-01.masked") : undefined);
        })}
      </Group>
      <View style={{ gap: s.sm, marginTop: s.md }}>
        {preview.skipped.map((sk) => (
          <NoteLine key={`skip-${sk.key}`} icon="ban" tone="coral" textColor="text" text={t("HM-FORM-01.heldBack", { field: t(`HM-FORM-02.kind.${sk.kind}`) })} />
        ))}
        {preview.requireBiometric ? <T v="caption" color="soft">{t("HM-FORM-01.fingerprintNote")}</T> : null}
        <T v="caption" color="soft">{t("HM-FORM-01.submitNote")}</T>
        {note ? <Notice tone="bad" text={t(`HM-FORM-01.done.${note}`)} /> : null}
      </View>
    </Page>
  );
}
