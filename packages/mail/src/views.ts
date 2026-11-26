import { formatLocalTime } from "@hermit/core";
import type { UnavailableReason } from "@hermit/connectors";
import type { MailAccount, MailProviderKind } from "./accounts.ts";
import type { ShownItem } from "./cache.ts";
import type { MailConnectProblem } from "./connect.ts";
import type { MailDraft } from "./drafts.ts";

/*
 * What the mail screens render, as copy keys and rows (docs/prd/hermit-ui-states-and-edge-cases.md). The
 * screens stay thin: every state and its copy is decided here and tested.
 */

export interface MailAccountsView {
  state: "empty" | "list";
  titleKey: "HM-MAIL-01.title";
  /** Always shown (US-MAIL-01): mail goes straight between the phone and the provider. */
  privacyKey: "HM-MAIL-01.privacy";
  emptyKey?: "HM-MAIL-01.empty";
  rows: Array<{ id: string; address: string; label?: string; serviceKey: `HM-MAIL-01.service.${MailProviderKind}` }>;
  /** The three ways to connect, in order. */
  connectKeys: readonly ["HM-MAIL-01.connectGmail", "HM-MAIL-01.connectOutlook", "HM-MAIL-01.connectOther"];
}

/** HM-MAIL-01: every account listed separately (US-MAIL-08). */
export function mailAccountsView(accounts: readonly MailAccount[]): MailAccountsView {
  const rows = [...accounts]
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((a) => ({ id: a.id, address: a.address, ...(a.label ? { label: a.label } : {}), serviceKey: `HM-MAIL-01.service.${a.provider}` as const }));
  return {
    state: rows.length ? "list" : "empty",
    titleKey: "HM-MAIL-01.title",
    privacyKey: "HM-MAIL-01.privacy",
    ...(rows.length ? {} : { emptyKey: "HM-MAIL-01.empty" as const }),
    rows,
    connectKeys: ["HM-MAIL-01.connectGmail", "HM-MAIL-01.connectOutlook", "HM-MAIL-01.connectOther"],
  };
}

/** The copy for a failed connection; needs_client_id points to HM-CONN-05. */
export function mailConnectErrorKey(problem: MailConnectProblem | UnavailableReason): string {
  return `HM-MAIL-01.error.${problem === "needs_client_id" ? "needs_client_id" : problem}`;
}

/**
 * After disconnecting: deleted from the phone, and whether the provider revoked the token. Microsoft has no way for an
 * app to revoke only its own tokens (Graph's revokeSignInSessions signs the user out of every app, and isn't available
 * for personal accounts), so an Outlook account says where the user removes Hermit's access themselves.
 */
export function mailDisconnectedKey(revoked: "yes" | "unsupported" | "failed", provider?: MailProviderKind): "HM-MAIL-01.disconnected" | "HM-MAIL-01.disconnectedNotRevoked" | "HM-MAIL-01.disconnectedMicrosoft" {
  if (revoked === "failed") return "HM-MAIL-01.disconnectedNotRevoked";
  if (revoked === "unsupported" && provider === "outlook") return "HM-MAIL-01.disconnectedMicrosoft";
  return "HM-MAIL-01.disconnected";
}

export interface MailShownView {
  screen: "HM-MAIL-02" | "HM-MAIL-03";
  state: "empty" | "list";
  titleKey: string;
  emptyKey?: string;
  /** Message text is other people's: the screen renders it as quotes, with this note (ST-TAINTED). */
  untrustedKey: "HM-MAIL-02.untrusted";
  /** `at` (epoch ms) lets the screen say the time relative to now; `when` is the full local time. */
  rows: Array<{ ref: string; from: string; subject: string; when: string; at: number; unread: boolean; accountId: string }>;
}

/**
 * HM-MAIL-02 (the messages a summary used, from mail_list) and HM-MAIL-03 (search results), from what
 * MailCache recorded; never from the model's answer.
 */
export function mailShownView(shown: { skill: "mail_list" | "mail_search"; items: ShownItem[] } | undefined, screen: "HM-MAIL-02" | "HM-MAIL-03", locale: string, timeZone: string): MailShownView {
  const want = screen === "HM-MAIL-02" ? "mail_list" : "mail_search";
  const items = shown?.skill === want ? shown.items : [];
  return {
    screen,
    state: items.length ? "list" : "empty",
    titleKey: `${screen}.title`,
    ...(items.length ? {} : { emptyKey: `${screen}.empty` }),
    untrustedKey: "HM-MAIL-02.untrusted",
    rows: items.map((i) => ({ ref: i.ref, from: i.from, subject: i.subject, when: formatLocalTime(i.at, locale, timeZone), at: i.at, unread: i.unread, accountId: i.accountId })),
  };
}

export interface MailDraftView {
  screen: "HM-MAIL-04";
  state: "draft" | "empty";
  titleKey: "HM-MAIL-04.title";
  emptyKey?: "HM-MAIL-04.empty";
  /** Always said: the draft is saved in the account's Drafts and nothing was sent (FR-MAIL-03). */
  savedKey?: "HM-MAIL-04.saved";
  /** The sending account (US-MAIL-08). */
  from?: string;
  /** To, Cc, Subject and body, all editable (US-MAIL-04). */
  fields: Array<{ key: "to" | "cc" | "subject" | "body"; labelKey: string; value: string; editable: true }>;
  /** Send puts draftSendCall(draft) through the cage, so it asks like any send. */
  actions: Array<"HM-MAIL-04.send" | "HM-MAIL-04.discard">;
}

/** HM-MAIL-04: a draft Hermit saved, from MailDrafts; never from the model's answer. */
export function mailDraftView(draft: MailDraft | undefined): MailDraftView {
  if (!draft) return { screen: "HM-MAIL-04", state: "empty", titleKey: "HM-MAIL-04.title", emptyKey: "HM-MAIL-04.empty", fields: [], actions: [] };
  const field = (key: "to" | "cc" | "subject" | "body", value: string) => ({ key, labelKey: `HM-MAIL-04.${key}`, value, editable: true as const });
  return {
    screen: "HM-MAIL-04",
    state: "draft",
    titleKey: "HM-MAIL-04.title",
    savedKey: "HM-MAIL-04.saved",
    from: draft.from,
    fields: [field("to", draft.to.join(", ")), field("cc", draft.cc.join(", ")), field("subject", draft.subject), field("body", draft.body)],
    actions: ["HM-MAIL-04.send", "HM-MAIL-04.discard"],
  };
}
