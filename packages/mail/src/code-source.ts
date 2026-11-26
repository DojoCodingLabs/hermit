import { codeMailDomain, codeSenderMatches, extractOneTimeCode, senderAddress, type CodeWatch, type FoundCode, type OneTimeCodePort, type StopSignal } from "@hermit/core";
import type { MailAccount } from "./accounts.ts";
import { AUTHSERV_IDS, mailAuthVerdict } from "./mail-auth.ts";
import type { MailProvider } from "./provider.ts";

/**
 * SL-56b (Q138, Q141, Q142): a web task's one-time code from the site's email, in a connected account. Armed at the
 * sign-in click, it reads only while the task is paused at its code step (`take`), and only:
 * - messages that arrived after the click (`since`) and before the window ends (`until`), by the provider's time;
 * - from a sender on the site's registrable domain (`codeSenderMatches`), never a free mail service;
 * - fresh from the provider, never from the mail skills' cache or anything Hermit read for another reason.
 * Each such message is read once, its code taken by code (`extractOneTimeCode`) and its text dropped right there; it
 * never reaches the model, the database or a log. The provider's own verdict on the sender (Authentication-Results,
 * `mailAuthVerdict`) rides along as `verified`; the runner refuses a code without one. Two messages with a code in the
 * window is `ambiguous`: none is taken. It polls every POLL_MS until a code, the window's end, the signal or `cancel`.
 */

export const MAIL_CODE_POLL_MS = 5_000;
const SEARCH_MAX = 10;

export interface MailCodeSourceDeps {
  accounts(): Promise<MailAccount[]>;
  provider(account: MailAccount): MailProvider;
  now(): number;
  sleep(ms: number, signal: StopSignal): Promise<void>;
  pollMs?: number;
}

type Seen = { code: string; at: number; sender: string; verified?: "dmarc" | "dkim" } | null;

export function createMailCodeSource(deps: MailCodeSourceDeps): OneTimeCodePort {
  return {
    arm({ origin, since }): CodeWatch | undefined {
      const site = codeMailDomain(origin);
      if (!site) return undefined;
      const domain: string = site;
      let cancelled = false;
      const seen = new Map<string, Seen>();
      const drop = () => {
        for (const v of seen.values()) if (v) v.code = "";
        seen.clear();
      };

      async function look(until: number): Promise<"none_left" | void> {
        const accounts = await deps.accounts().catch(() => [] as MailAccount[]);
        if (!accounts.length) return "none_left";
        for (const account of accounts) {
          if (cancelled) return;
          const p = deps.provider(account);
          const found = await p.search({ from: domain }, SEARCH_MAX).catch(() => undefined);
          if (!found?.ok) continue;
          for (const h of found.value) {
            const key = `${account.id}|${h.id}`;
            if (cancelled || seen.has(key)) continue;
            // Only a message after the click and inside the window, from the site, is ever read.
            if (!(h.at >= since && h.at <= until) || !codeSenderMatches(h.from, origin)) continue;
            const m = await p.read(h.id).catch(() => undefined);
            const code = m?.ok ? extractOneTimeCode(`${m.value.subject}\n${m.value.text}`) : undefined;
            if (!code) {
              seen.set(key, null);
              continue;
            }
            const sender = senderAddress(h.from)!;
            const auth = p.authResults ? await p.authResults(h.id).catch(() => undefined) : undefined;
            const verified = auth?.ok
              ? mailAuthVerdict(auth.value, { authservId: AUTHSERV_IDS[account.provider], domain, fromDomain: sender.slice(sender.lastIndexOf("@") + 1) })
              : undefined;
            seen.set(key, { code, at: h.at, sender, ...(verified ? { verified } : {}) });
          }
        }
      }

      return {
        async take({ until, signal }) {
          try {
            for (;;) {
              if (cancelled || signal.aborted) return undefined;
              const r = await look(until);
              if (cancelled || signal.aborted) return undefined;
              if (r === "none_left") return undefined;
              const codes = [...seen.values()].filter((v): v is NonNullable<Seen> => v !== null);
              if (codes.length > 1) return "ambiguous";
              if (codes.length === 1) {
                const c = codes[0]!;
                const out: FoundCode = { via: "email", code: c.code, at: c.at, sender: c.sender, ...(c.verified ? { verified: c.verified } : {}) };
                return out;
              }
              if (deps.now() >= until) return undefined;
              await deps.sleep(Math.min(deps.pollMs ?? MAIL_CODE_POLL_MS, Math.max(0, until - deps.now())), signal);
            }
          } finally {
            drop();
          }
        },
        cancel() {
          cancelled = true;
          drop();
        },
      };
    },
  };
}
