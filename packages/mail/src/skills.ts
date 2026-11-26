import { zoneOffsetMinutes, type SessionState, type SkillDef, type TaintSource } from "@hermit/core";
import { skillById } from "@hermit/skills";
import { resolveAccounts, type MailAccount, type MailAccountStore } from "./accounts.ts";
import type { MailCache, ShownItem } from "./cache.ts";
import type { MailHeader, MailMessage, MailProblem, MailProvider, MailResult } from "./provider.ts";
import type { MailAddressBook } from "./book.ts";
import type { MailDrafts } from "./drafts.ts";
import { clip, oneLine } from "./text.ts";
import { createMailWriteSkills } from "./write-skills.ts";

/** Shaped like the agent's SkillResult. */
export interface MailSkillResult {
  ok: boolean;
  modelText: string;
  untrusted?: boolean;
  taintKind?: TaintSource["kind"];
}

/** Shaped like the agent's SkillRuntime, so the loop puts it through the cage like any other skill. */
export interface MailSkill {
  def: SkillDef;
  execute(args: Record<string, unknown>, ctx: { session: SessionState; approvedArgsHash?: string; approvedBinding?: string }): Promise<MailSkillResult>;
}

export interface MailSkillDeps {
  accounts: MailAccountStore;
  providerFor(account: MailAccount): MailProvider;
  cache: MailCache;
  timeZone(): string;
  /** Addresses the user sent mail to or typed, for the send sheet's new-recipient flag (SL-49). Without it every recipient is flagged. */
  book?: MailAddressBook;
  /** Drafts Hermit saved, for HM-MAIL-04 (SL-49). */
  drafts?: MailDrafts;
  now?(): number;
}

/** FR-MAIL-02 and US-MAIL-02: at most 50 per call. */
export const MAIL_LIST_MAX = 50;
const LIST_DEFAULT = 20;
const SEARCH_MAX = 10;
const PREVIEW_CHARS = 160;
const LIST_CHARS = 8000;
const BODY_CHARS = 3500;

export const PROBLEM_TEXT: Record<MailProblem, string> = {
  sign_in_again: "the user needs to sign in to it again in Email accounts.",
  not_connected: "it is not connected anymore. Tell the user to connect it again in Email accounts.",
  unreachable: "couldn't reach the mail server. Tell the user plainly.",
  provider_error: "the mail server answered with an error. Tell the user plainly.",
  not_found: "the mailbox wasn't found.",
  reserved_label: "that name is a system folder (Inbox, Trash, Spam and the like), not a label. Hermit only adds the user's own labels; tell the user to pick another name.",
};

const trusted = (ok: boolean, modelText: string): MailSkillResult => ({ ok, modelText, untrusted: false });
const fromMail = (modelText: string): MailSkillResult => ({ ok: true, modelText, untrusted: true, taintKind: "email" });

export function localTime(at: number, timeZone: string): string {
  return new Date(at + zoneOffsetMinutes(at, timeZone) * 60_000).toISOString().slice(0, 16).replace("T", " ");
}

const def = (id: string): SkillDef => {
  const d = skillById(id);
  if (!d) throw new Error(`mail skill ${id} is not in the catalog`);
  return d as SkillDef;
};

const where = (accounts: MailAccount[]) => (accounts.length === 1 ? accounts[0]!.address : `${accounts.length} accounts (${accounts.map((a) => a.address).join(", ")})`);

/** Every account's answer, merged newest first; the failures are said, not hidden. */
async function gather(accounts: MailAccount[], run: (a: MailAccount) => Promise<MailResult<MailHeader[]>>, max: number) {
  const results = await Promise.all(accounts.map(async (a) => ({ a, r: await run(a).catch((): MailResult<MailHeader[]> => ({ ok: false, problem: "unreachable" })) })));
  const failed = results.filter((x) => !x.r.ok).map(({ a, r }) => `Couldn't read ${a.address}: ${PROBLEM_TEXT[(r as { problem: MailProblem }).problem]}`);
  const headers = results.flatMap(({ r }) => (r.ok ? r.value : [])).sort((x, y) => y.at - x.at).slice(0, max);
  return { headers, failed, allFailed: failed.length === accounts.length };
}

export function createMailSkills(deps: MailSkillDeps): MailSkill[] {
  const { cache } = deps;

  /** One line per message, its short id first; every field other people wrote is flattened (oneLine). */
  const listing = (skill: "mail_list" | "mail_search", head: string, failed: string[], headers: MailHeader[], several: boolean, accounts: MailAccount[]): string => {
    const tz = deps.timeZone();
    const shown: ShownItem[] = [];
    const lines = [head, ...failed];
    let size = lines.join("\n").length;
    for (const h of headers) {
      const ref = cache.put(h);
      const account = accounts.find((a) => a.id === h.accountId)?.address ?? "";
      const line = [
        `messageId: ${ref}`,
        localTime(h.at, tz),
        ...(several ? [account] : []),
        `From: ${oneLine(h.from)}`,
        `Subject: ${oneLine(h.subject)}`,
        ...(h.preview ? [clip(oneLine(h.preview), PREVIEW_CHARS)] : []),
      ].join(" | ");
      if (size + line.length + 1 > LIST_CHARS) {
        lines.push(`(${headers.length - shown.length} more not shown)`);
        break;
      }
      size += line.length + 1;
      lines.push(line);
      shown.push({ ...h, ref });
    }
    cache.remember(skill, shown);
    return lines.join("\n");
  };

  const pick = async (wanted: unknown) => resolveAccounts(await deps.accounts.list(), wanted);

  return [
    ...readSkills(),
    ...createMailWriteSkills(deps),
  ];

  function readSkills(): MailSkill[] {
    return [
      {
        def: def("mail_list"),
        async execute(args) {
          const chosen = await pick(args.account);
          if (!chosen.ok) return trusted(false, chosen.modelText);
          const unreadOnly = args.unreadOnly !== false;
          const max = Math.min(Math.max(Number.isInteger(args.max) ? (args.max as number) : LIST_DEFAULT, 1), MAIL_LIST_MAX);
          const { headers, failed, allFailed } = await gather(chosen.accounts, (a) => deps.providerFor(a).list({ unreadOnly, max }), max);
          if (allFailed) return trusted(false, failed.join(" "));
          const kind = unreadOnly ? "unread" : "recent";
          if (!headers.length) return trusted(true, [`No ${kind} email in ${where(chosen.accounts)}.`, ...failed].join(" "));
          const head = `${unreadOnly ? "Unread" : "Latest"} email in ${where(chosen.accounts)}, newest first:`;
          return fromMail(listing("mail_list", head, failed, headers, chosen.accounts.length > 1, chosen.accounts));
        },
      },
      {
        def: def("mail_search"),
        async execute(args) {
          const words = typeof args.query === "string" ? args.query.trim() : "";
          const from = typeof args.from === "string" ? args.from.trim() : "";
          if (!words && !from) return trusted(false, "Say what to look for: words from the email, or who sent it.");
          const chosen = await pick(args.account);
          if (!chosen.ok) return trusted(false, chosen.modelText);
          const q = { ...(words ? { words } : {}), ...(from ? { from } : {}) };
          const { headers, failed, allFailed } = await gather(chosen.accounts, (a) => deps.providerFor(a).search(q, SEARCH_MAX), SEARCH_MAX);
          if (allFailed) return trusted(false, failed.join(" "));
          const sender = from ? ` from ${from}` : "";
          if (!headers.length) return trusted(true, [`No email ${words ? `matches "${words}"` : ""}${sender} in ${where(chosen.accounts)}.`.replace("email  from", "email from"), ...failed].join(" "));
          const head = `Email${words ? ` matching "${words}"` : ""}${sender} in ${where(chosen.accounts)}:`;
          return fromMail(listing("mail_search", head, failed, headers, chosen.accounts.length > 1, chosen.accounts));
        },
      },
      {
        def: def("mail_read"),
        async execute(args) {
          const ref = String(args.messageId ?? "");
          const h = cache.get(ref);
          if (!h) return trusted(false, `There is no email ${ref} from mail_list or mail_search in this chat. Call mail_list or mail_search first.`);
          const account = await deps.accounts.get(h.accountId);
          if (!account) return trusted(false, "That email's account is not connected anymore.");
          let r: MailResult<MailMessage>;
          try {
            r = await deps.providerFor(account).read(h.id);
          } catch {
            r = { ok: false, problem: "unreachable" };
          }
          if (!r.ok) return trusted(false, `Couldn't open ${ref}: ${PROBLEM_TEXT[r.problem]}`);
          // The headers of a message someone else sent never teach the address book (SL-49 review).
          const m = r.value;
          const body = clip(m.text, BODY_CHARS).split("\n").map((l) => `> ${l}`);
          return fromMail([
            `messageId: ${ref} | ${localTime(m.at, deps.timeZone())} | ${account.address}`,
            `From: ${oneLine(m.from)}`,
            ...(m.to.length ? [`To: ${oneLine(m.to.join(", "))}`] : []),
            ...(m.cc.length ? [`Cc: ${oneLine(m.cc.join(", "))}`] : []),
            `Subject: ${oneLine(m.subject)}`,
            ...body,
          ].join("\n"));
        },
      },
    ];
  }
}
