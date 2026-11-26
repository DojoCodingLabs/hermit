// HM-MAIL-04: the draft (US-MAIL-04, SL-49). A draft Hermit saved in the account's Drafts, from the app's drafts store
// (mailDraftView), never from the model's answer: the sending account, then To, Cc, Subject and body, all editable. Send
// checks the addresses, then puts draftSendCall through the cage (hermit.mailSend): the normal approval sheet with the
// fingerprint, warning when the draft was written after reading others' mail; an untouched reply stays a reply in its
// thread. Nothing is optimistic: "Sent" only after the provider took it. States: ST-LOAD; ST-EMPTY-FIRST (no draft);
// ST-IDEAL with "saved, nothing sent" or "your changes stay on this phone"; the taint note (amber); an invalid address
// (coral, on its field); ST-PENDING while the sheet is open; declined, unavailable, blocked, failed (said, the draft
// kept); sent and discarded (the phone's copy goes, the provider's Drafts copy stays, and the screen says so).
import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, View } from "react-native";
import type { MailDraftScreen } from "@hermit/mail";
import type { MailSendOutcome } from "@hermit/runtime";
import { mailService } from "../adapters/mail";
import { Btn, Empty, Field, Footer, Input, Loading, Note, Notice, Page } from "../components/kit";
import { useHermit } from "../hermit-context";
import { t } from "../i18n";
import { s } from "../theme";

type Fields = { to: string; cc: string; subject: string; body: string };
type Ended = "sent" | "discarded" | "gone";

const fieldsOf = (d: MailDraftScreen): Fields => {
  const v = (key: keyof Fields) => d.view.fields.find((f) => f.key === key)?.value ?? "";
  return { to: v("to"), cc: v("cc"), subject: v("subject"), body: v("body") };
};

const OUTCOME_KEY: Record<Exclude<MailSendOutcome, "sent">, string> = {
  declined: "HM-MAIL-04.declined", unavailable: "HM-MAIL-04.unavailable", blocked: "HM-MAIL-04.blocked", failed: "HM-MAIL-04.failed",
};

export default function MailDraft() {
  const { status } = useHermit();
  const hermit = status.kind === "ready" ? status.hermit : undefined;
  const params = useLocalSearchParams<{ ref?: string }>();
  const mail = mailService();
  const [draft, setDraft] = useState<MailDraftScreen>();
  const [fields, setFields] = useState<Fields>({ to: "", cc: "", subject: "", body: "" });
  const [bad, setBad] = useState<"to" | "cc">();
  const [sending, setSending] = useState(false);
  const [said, setSaid] = useState<string>();
  const [ended, setEnded] = useState<Ended>();

  const load = useCallback(() => {
    if (!mail) return;
    const d = mail.draft(typeof params.ref === "string" ? params.ref : undefined);
    if (!d) return setEnded("gone");
    setDraft(d);
    setFields(fieldsOf(d));
  }, [mail, params.ref]);
  useEffect(() => load(), [load]);

  const title = t("HM-MAIL-04.title");
  if (!mail || (!draft && !ended)) {
    return (
      <Page title={title}>
        <Loading text={t("common.loading")} />
      </Page>
    );
  }
  if (ended) {
    const body = ended === "sent" ? "HM-MAIL-04.sent" : ended === "discarded" ? "HM-MAIL-04.discarded" : "HM-MAIL-04.gone";
    return (
      <Page title={title}>
        <Empty pose={ended === "sent" ? "done" : "idle"} body={t(body)} live />
      </Page>
    );
  }
  if (!draft?.ref || draft.view.state === "empty") {
    return (
      <Page title={title}>
        <Empty pose="idle" title={t("HM-MAIL-04.emptyTitle")} body={t("HM-MAIL-04.empty")} />
      </Page>
    );
  }
  const ref = draft.ref;
  const changed = draft.edited || JSON.stringify(fields) !== JSON.stringify(fieldsOf(draft));
  const edit = (key: keyof Fields) => (value: string) => {
    setFields((f) => ({ ...f, [key]: value }));
    setSaid(undefined);
    if (key === bad) setBad(undefined);
  };

  const send = async () => {
    if (!hermit?.mailSend) return;
    const checked = mail.editDraft(ref, fields);
    if (!checked.ok) {
      if (checked.field === "draft") return setEnded("gone");
      return setBad(checked.field);
    }
    const call = mail.draftCall(ref);
    if (!call) return setEnded("gone");
    setSending(true);
    setSaid(undefined);
    const out = await hermit.mailSend(call).catch((): MailSendOutcome => "failed");
    setSending(false);
    if (out === "sent") {
      mail.sentDraft(ref);
      return setEnded("sent");
    }
    setDraft(mail.draft(ref) ?? draft);
    setSaid(OUTCOME_KEY[out]);
  };

  const discard = () =>
    Alert.alert(t("HM-MAIL-04.discardTitle"), t("HM-MAIL-04.discardBody"), [
      { text: t("HM-MAIL-01.cancel"), style: "cancel" },
      {
        text: t("HM-MAIL-04.discard"),
        style: "destructive",
        onPress: () => {
          mail.discardDraft(ref);
          setEnded("discarded");
        },
      },
    ]);

  return (
    <Page
      title={title}
      footer={
        <Footer>
          <Btn label={t("HM-MAIL-04.send")} icon="send" hint={t("HM-MAIL-04.sendHint")} busy={sending} disabled={!hermit?.mailSend || !fields.to.trim()} style={{ flexGrow: 1 }} onPress={() => void send()} />
          <Btn label={t("HM-MAIL-04.discard")} kind="text" disabled={sending} onPress={discard} />
        </Footer>
      }
    >
      <View style={{ gap: s.sm, paddingHorizontal: s.lg, marginBottom: s.lg }}>
        <Note icon={changed ? "pen-line" : "circle-check"} text={t(changed ? "HM-MAIL-04.edited" : draft.view.savedKey ?? "HM-MAIL-04.saved")} />
        {draft.tainted ? <Note icon="shield-alert" tone="amber" text={t("HM-MAIL-04.tainted")} textColor="text" /> : null}
      </View>
      <View style={{ gap: s.lg }}>
        <View style={{ paddingHorizontal: s.lg }}><Field label={t("HM-MAIL-04.from")} value={draft.view.from ?? ""} /></View>
        <Input label={t("HM-MAIL-04.to")} hint={t("HM-MAIL-04.toHint")} value={fields.to} onChange={edit("to")} invalid={bad === "to"} field={{ keyboardType: "email-address", editable: !sending }} />
        <Input label={t("HM-MAIL-04.cc")} value={fields.cc} onChange={edit("cc")} invalid={bad === "cc"} field={{ keyboardType: "email-address", editable: !sending }} />
        {bad ? <View accessibilityRole="alert" style={{ paddingHorizontal: s.lg }}><Note icon="circle-alert" tone="coral" text={t("HM-MAIL-04.badAddress")} textColor="text" /></View> : null}
        <Input label={t("HM-MAIL-04.subject")} value={fields.subject} onChange={edit("subject")} field={{ maxLength: 200, editable: !sending, autoCapitalize: "sentences", autoCorrect: true }} />
        <Input label={t("HM-MAIL-04.body")} value={fields.body} onChange={edit("body")} field={{ multiline: true, maxLength: 4000, editable: !sending, autoCapitalize: "sentences", autoCorrect: true }} />
      </View>
      <View style={{ paddingHorizontal: s.lg, marginTop: s.md }}>
        {sending ? <Loading text={t("HM-MAIL-04.sending")} /> : null}
        {said ? <Notice tone="bad" text={t(said)} /> : null}
      </View>
    </Page>
  );
}
