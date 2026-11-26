import type { MailAccount } from "./accounts.ts";
import { createGmailProvider } from "./gmail.ts";
import { createGraphProvider } from "./graph.ts";
import { createImapProvider, type ImapPort, type SmtpPort } from "./imap.ts";
import type { MailNetDeps, MailProvider } from "./provider.ts";

/** The mailbox for one account, by its provider. */
export function mailProviderFor(deps: MailNetDeps & { imap?: ImapPort; smtp?: SmtpPort }, account: MailAccount): MailProvider {
  switch (account.provider) {
    case "gmail":
      return createGmailProvider(deps, account);
    case "outlook":
      return createGraphProvider(deps, account);
    case "imap":
      return createImapProvider(deps, account);
  }
}
