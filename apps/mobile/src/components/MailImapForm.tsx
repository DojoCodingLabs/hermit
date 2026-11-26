// HM-MAIL-01's "Other email (IMAP)" form (FR-MAIL-01, Q46): the address, the app password (never in the chat, kept
// only in the Keystore once the server accepted it), and the servers, filled in for providers whose settings are known
// (suggestMailSetup). IMAP is always 993 over TLS; SMTP is 465 over TLS unless the user adds :587 (STARTTLS). The
// server checks the sign-in before anything is stored; each problem says what to fix next to its field (EC-MAIL-02).
import { useState } from "react";
import { View } from "react-native";
import { mailConnectErrorKey, suggestMailSetup, type ImapConnectInput, type MailConnectProblem } from "@hermit/mail";
import { t } from "../i18n";
import { s } from "../theme";
import { Btn, Footer, Input, Note, Notice, Page, T } from "./kit";

type Problem = MailConnectProblem;
const FIELD_OF: Partial<Record<Problem, "address" | "password" | "servers">> = {
  invalid_address: "address",
  missing_password: "password",
  auth_failed: "password",
  invalid_host: "servers",
  invalid_port: "servers",
  unreachable: "servers",
};

/** "smtp.example.com" or "smtp.example.com:587": the host and the port the user asked for. */
export function smtpTyped(text: string): { host: string; port?: number } {
  const m = /^(.*?):(\d{1,5})$/.exec(text.trim());
  return m ? { host: m[1]!, port: Number(m[2]) } : { host: text.trim() };
}

export function MailImapForm({ connect, cancel }: { connect(input: ImapConnectInput): Promise<Problem | undefined>; cancel(): void }) {
  const [address, setAddress] = useState("");
  const [password, setPassword] = useState("");
  const [imap, setImap] = useState("");
  const [smtp, setSmtp] = useState("");
  const [filled, setFilled] = useState<{ imap: string; smtp: string }>();
  const [problem, setProblem] = useState<Problem>();
  const [busy, setBusy] = useState(false);
  const bad = problem ? FIELD_OF[problem] : undefined;

  // Known providers fill both servers; a value the user typed is never replaced.
  const fill = (typed: string) => {
    const s0 = suggestMailSetup(typed);
    if (s0.provider !== "imap" || !s0.imap || !s0.smtp) return;
    const next = { imap: s0.imap.host, smtp: s0.smtp.port === 587 ? `${s0.smtp.host}:587` : s0.smtp.host };
    if (!imap || imap === filled?.imap) setImap(next.imap);
    if (!smtp || smtp === filled?.smtp) setSmtp(next.smtp);
    setFilled(next);
  };

  const submit = async () => {
    setBusy(true);
    setProblem(undefined);
    try {
      setProblem(await connect({ address, password, imap: { host: imap }, smtp: smtpTyped(smtp) }));
    } catch {
      setProblem("unreachable");
    } finally {
      setBusy(false);
    }
  };
  const edit = (set: (v: string) => void) => (v: string) => {
    set(v);
    setProblem(undefined);
  };

  return (
    <Page
      title={t("HM-MAIL-01.connectOther")}
      subtitle={<T v="body" color="soft">{t("HM-MAIL-01.privacy")}</T>}
      footer={
        <Footer>
          <Btn label={t("HM-MAIL-01.connect")} icon="log-in" style={{ flexGrow: 1 }} busy={busy} disabled={busy || !address.trim() || !password || !imap.trim() || !smtp.trim()} onPress={() => void submit()} />
          <Btn label={t("HM-MAIL-01.cancel")} kind="text" disabled={busy} onPress={cancel} />
        </Footer>
      }
    >
    <View style={{ gap: s.lg }}>
      <Input
        label={t("HM-MAIL-01.address")}
        value={address}
        invalid={bad === "address"}
        onChange={edit(setAddress)}
        field={{ keyboardType: "email-address", autoCapitalize: "none", autoCorrect: false, autoComplete: "email", editable: !busy, onBlur: () => fill(address) }}
      />
      <Input
        label={t("HM-MAIL-01.password")}
        value={password}
        hint={t("HM-MAIL-01.passwordHelp")}
        invalid={bad === "password"}
        onChange={edit(setPassword)}
        field={{ secureTextEntry: true, autoCapitalize: "none", autoCorrect: false, autoComplete: "off", importantForAutofill: "no", editable: !busy }}
      />
      <Input
        label={t("HM-MAIL-01.imapServer")}
        value={imap}
        mono
        hint={t("HM-MAIL-01.imapServerHint")}
        invalid={bad === "servers"}
        onChange={edit(setImap)}
        field={{ autoCapitalize: "none", autoCorrect: false, keyboardType: "url", editable: !busy, placeholder: "imap.example.com" }}
      />
      <Input
        label={t("HM-MAIL-01.smtpServer")}
        value={smtp}
        mono
        hint={t("HM-MAIL-01.smtpServerHint")}
        invalid={bad === "servers"}
        onChange={edit(setSmtp)}
        field={{ autoCapitalize: "none", autoCorrect: false, keyboardType: "url", editable: !busy, placeholder: "smtp.example.com" }}
      />
      {busy ? <View style={{ paddingHorizontal: s.lg }}><Note icon="loader-circle" text={t("HM-MAIL-01.connecting")} /></View> : null}
      {problem ? (
        <View style={{ paddingHorizontal: s.lg }}>
          <Notice tone="bad" text={t(mailConnectErrorKey(problem))} />
        </View>
      ) : null}
    </View>
    </Page>
  );
}
