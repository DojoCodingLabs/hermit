import type { ApprovalSummary, MailRenderAccount, MailRenderContext, SkillDef } from "@hermit/core";
import { skillById } from "@hermit/skills";
import { accountName, resolveAccounts, type MailAccount } from "./accounts.ts";
import { forwardText } from "./mime.ts";
import type { MailChange, MailProblem, MailResult, OutgoingMail } from "./provider.ts";
import { localTime, PROBLEM_TEXT, type MailSkill, type MailSkillDeps, type MailSkillResult } from "./skills.ts";
import { oneLine } from "./text.ts";

/**
 * Trusted mail data for the approval sheets (RenderContext.mail): the connected accounts, the messages code
 * handed out short ids for, and the address book. Header text is flattened to one line, so a sender's name
 * can't fake another line on the sheet. The app builds it fresh for every sheet from the same deps it gave
 * createMailSkills, and the skills rebuild it before acting to check the binding.
 */
export async function mailRenderContext(deps: Pick<MailSkillDeps, "accounts" | "cache" | "book">): Promise<MailRenderContext> {
  const accounts = [...(await deps.accounts.list())].sort((a, b) => a.createdAt - b.createdAt);
  const view = (a: MailAccount): MailRenderAccount => ({ id: a.id, address: a.address.toLowerCase(), name: accountName(a) });
  return {
    sender(wanted) {
      const r = resolveAccounts(accounts, wanted);
      return r.ok ? { ok: true, account: view(r.accounts[0]!) } : { ok: false, reason: r.modelText };
    },
    account(id) {
      const a = accounts.find((x) => x.id === id);
      return a && view(a);
    },
    message(ref) {
      const h = deps.cache.get(ref);
      return h && { ref, accountId: h.accountId, from: oneLine(h.from), subject: oneLine(h.subject) };
    },
    shown: () => deps.cache.shown()?.items.map((i) => i.ref) ?? [],
    known: (address) => accounts.some((a) => a.address.toLowerCase() === address) || (deps.book?.has(address) ?? false),
  };
}

const trusted = (ok: boolean, modelText: string): MailSkillResult => ({ ok, modelText, untrusted: false });

const def = (id: string): SkillDef => {
  const d = skillById(id);
  if (!d) throw new Error(`mail skill ${id} is not in the catalog`);
  return d as SkillDef;
};

const DONE: Record<MailChange["kind"], (n: number) => string> = {
  archive: (n) => `Archived ${n} email${n === 1 ? "" : "s"}.`,
  mark_read: (n) => `Marked ${n} email${n === 1 ? "" : "s"} as read.`,
  label: (n) => `Labeled ${n} email${n === 1 ? "" : "s"}.`,
};

/**
 * mail_send, mail_reply, mail_forward, mail_draft and mail_modify (SL-49). The loop has already put each call
 * through the cage and the approval sheet. Before anything leaves the phone the skill renders the sheet
 * again from fresh trusted data and refuses unless its binding is the one the user approved, then acts on
 * exactly those values: the recipients, the sending account, the thread and the messages.
 */
export function createMailWriteSkills(deps: MailSkillDeps): MailSkill[] {
  const { cache } = deps;
  const defs = { send: def("mail_send"), reply: def("mail_reply"), forward: def("mail_forward"), draft: def("mail_draft"), modify: def("mail_modify") };
  const now = () => deps.now?.() ?? Date.now();

  /** The approved binding, re-checked against a sheet rendered now; or the refusal to hand the model. */
  const approved = async (skill: SkillDef, args: Record<string, unknown>, binding: string | undefined): Promise<{ ok: true; values: unknown[] } | { ok: false; result: MailSkillResult }> => {
    const summary: ApprovalSummary = skill.describeAction(args, { conversation: () => undefined, mail: await mailRenderContext(deps) });
    if (summary.unresolved) return { ok: false, result: trusted(false, summary.unresolved) };
    if (!binding || binding !== summary.binding) {
      return { ok: false, result: trusted(false, "The email changed since the user approved it, so nothing was done. Ask the user to approve again.") };
    }
    return { ok: true, values: JSON.parse(binding) as unknown[] };
  };

  const accountOf = async (id: unknown) => (typeof id === "string" ? deps.accounts.get(id) : undefined);
  const attempt = async <T>(op: () => Promise<MailResult<T>>): Promise<MailResult<T>> => {
    try {
      return await op();
    } catch {
      return { ok: false, problem: "unreachable" };
    }
  };
  const failed = (what: string, problem: MailProblem, nothing = "Nothing was sent.") => trusted(false, `Couldn't ${what}: ${PROBLEM_TEXT[problem]} ${nothing}`);
  const send = async (account: MailAccount, mail: OutgoingMail, what: string, done: string): Promise<MailSkillResult> => {
    const r = await attempt(() => deps.providerFor(account).send(mail));
    if (!r.ok) return failed(what, r.problem);
    // Only an approved send the provider accepted teaches the book; reads and drafts never do.
    deps.book?.add([...mail.to, ...mail.cc], "sent");
    return trusted(true, done);
  };

  return [
    {
      def: defs.send,
      async execute(args, { approvedBinding }) {
        const ok = await approved(defs.send, args, approvedBinding);
        if (!ok.ok) return ok.result;
        const [, accountId, from, to, cc] = ok.values as [string, string, string, string[], string[]];
        const account = await accountOf(accountId);
        if (!account) return trusted(false, "That account is not connected anymore. Nothing was sent.");
        return send(account, { from, to, cc, subject: String(args.subject ?? ""), text: String(args.body ?? "") }, "send the email", `Sent from ${from} to ${[...to, ...cc].join(", ")}.`);
      },
    },
    {
      def: defs.reply,
      async execute(args, { approvedBinding }) {
        const ok = await approved(defs.reply, args, approvedBinding);
        if (!ok.ok) return ok.result;
        const [, ref, accountId, from, to, subject] = ok.values as [string, string, string, string, string, string];
        const h = cache.get(ref);
        const account = await accountOf(accountId);
        if (!h || !account) return trusted(false, "That email is gone from this chat. Nothing was sent.");
        return send(account, { from, to: [to], cc: [], subject, text: String(args.body ?? ""), inReplyTo: h.id }, "send the reply", `Reply sent from ${from} to ${to}.`);
      },
    },
    {
      def: defs.forward,
      async execute(args, { approvedBinding }) {
        const ok = await approved(defs.forward, args, approvedBinding);
        if (!ok.ok) return ok.result;
        const [, ref, accountId, from, to, subject] = ok.values as [string, string, string, string, string[], string];
        const h = cache.get(ref);
        const account = await accountOf(accountId);
        if (!h || !account) return trusted(false, "That email is gone from this chat. Nothing was sent.");
        // The original's text goes to the new recipients only; it never reaches the model here.
        const original = await attempt(() => deps.providerFor(account).read(h.id));
        if (!original.ok) return failed("forward the email", original.problem);
        const m = original.value;
        const text = forwardText(String(args.body ?? ""), { from: m.from, to: m.to, subject: m.subject, date: localTime(m.at, deps.timeZone()), text: m.text });
        return send(account, { from, to, cc: [], subject, text }, "forward the email", `Forwarded from ${from} to ${to.join(", ")}.`);
      },
    },
    {
      def: defs.draft,
      async execute(args, { approvedBinding, session }) {
        const ok = await approved(defs.draft, args, approvedBinding);
        if (!ok.ok) return ok.result;
        const reply = typeof args.messageId === "string" && args.messageId !== "";
        let account: MailAccount | undefined;
        let mail: OutgoingMail;
        let replyTo: { ref: string; to: string } | undefined;
        if (reply) {
          const [, ref, accountId, from, to, subject] = ok.values as [string, string, string, string, string, string];
          const h = cache.get(ref);
          account = await accountOf(accountId);
          if (!h || !account) return trusted(false, "That email is gone from this chat. No draft was saved.");
          mail = { from, to: [to], cc: [], subject, text: String(args.body ?? ""), inReplyTo: h.id };
          replyTo = { ref, to };
        } else {
          const [, accountId, from, to] = ok.values as [string, string, string, string[]];
          account = await accountOf(accountId);
          if (!account) return trusted(false, "That account is not connected anymore. No draft was saved.");
          mail = { from, to, cc: [], subject: String(args.subject ?? ""), text: String(args.body ?? "") };
        }
        const r = await attempt(() => deps.providerFor(account!).saveDraft(mail));
        if (!r.ok) return failed("save the draft", r.problem, "No draft was saved.");
        const taint = session.taint.at(-1)?.kind;
        const draft = deps.drafts?.add({
          accountId: account.id, from: mail.from, to: mail.to, cc: mail.cc, subject: mail.subject, body: mail.text, ...(replyTo ? { replyTo } : {}), savedAt: now(),
          ...(taint ? { taint } : {}),
        });
        return trusted(true, `Draft saved in the Drafts of ${mail.from}${draft ? ` (${draft.ref})` : ""}. It was not sent; the user can edit and send it from the draft screen.`);
      },
    },
    {
      def: defs.modify,
      async execute(args, { approvedBinding }) {
        const ok = await approved(defs.modify, args, approvedBinding);
        if (!ok.ok) return ok.result;
        const [, action, label, items] = ok.values as [string, MailChange["kind"], string, Array<[string, string]>];
        const change: MailChange = action === "label" ? { kind: "label", label } : { kind: action };
        const byAccount = new Map<string, string[]>();
        for (const [ref, accountId] of items) {
          const h = cache.get(ref);
          if (h) byAccount.set(accountId, [...(byAccount.get(accountId) ?? []), h.id]);
        }
        let changed = 0;
        const problems: string[] = [];
        for (const [accountId, ids] of byAccount) {
          const account = await accountOf(accountId);
          if (!account) {
            problems.push(`${ids.length} in an account that is not connected anymore`);
            continue;
          }
          const r = await attempt(() => deps.providerFor(account).modify(ids, change));
          if (r.ok) changed += r.value;
          else problems.push(`${account.address}: ${PROBLEM_TEXT[r.problem]}`);
        }
        if (!changed && problems.length) return trusted(false, `Couldn't change those emails. ${problems.join(" ")} Nothing changed.`);
        return trusted(true, [DONE[change.kind](changed), ...(problems.length ? [`Not changed: ${problems.join(" ")}`] : [])].join(" "));
      },
    },
  ];
}

