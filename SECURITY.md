# Security policy

Hermit acts for people with their messages, mail, calendar, logins and (on testnet) money. We take security reports seriously, and we handle them in private.

## Report a vulnerability privately

Use GitHub's private vulnerability reporting: [open a private report](https://github.com/DojoCodingLabs/hermit/security/advisories/new). Don't open a public issue, discussion or pull request for a vulnerability, and don't publish it anywhere until a fix is out.

If you can't use GitHub, email privacy@dojocoding.io and we'll move your report into a private advisory.

Please include:

- what an attacker can do, and what they need first (a message they send, a page the user opens, an app on the phone);
- the steps to reproduce it, and the commit or version you tested;
- a proof of concept that uses made-up data and test accounts;
- a fix or a mitigation, if you have one in mind.

What happens next: we confirm we got your report, work on the fix in private, and keep you posted. When the fix ships, we publish an advisory and credit you, unless you'd rather stay anonymous.

## Supported versions

Hermit is pre-alpha. Only the latest commit on the default branch gets security fixes.

## The threat model in brief

Hermit assumes the model can be wrong and can be tricked. What protects people is the code around the model, not the model's judgment.

- **Prompt injection.** Anyone who can put text in front of Hermit (a message, a web page, an email, a calendar invitation, a connector or MCP result, another bot) may try to give it orders. The defenses: the model only picks from typed skills and never gets a shell or a browser; untrusted text is wrapped, marked and taints the session; and the cage decides every call, with deny winning and stricter rules once a session is tainted.
- **Approval bypass.** An attacker, or the model itself, may try to send, pay or log in without the user's real consent, or get consent for one thing and do another. The defenses: hard limits in code; approval sheets that code writes from the exact arguments; approvals bound to the hash of those arguments and to one request; the fingerprint and a Keystore signature for every payment and login, in every mode, and no payments or logins at all when a session is tainted or nobody is there; and sends that ask by default (Ask mode), unless the user picked another mode on purpose, behind explicit warnings.
- **Data exfiltration.** An attacker may try to get data off the phone: through a send, a link the model builds, a connector call, a search query, a log or a dependency. The defenses: no server and no telemetry; no network code in the core packages; every outbound host counted for the privacy screen; links and searches the user didn't type need approval in a tainted session; and CI checks that deny tracking SDKs.
- **A rewritten record.** The audit log is hash-chained and signed with a key on the phone, so edits, reordering and deletions show up as a broken chain.

We assume the phone's operating system and hardware keystore work as designed, and that the fingerprint belongs to the phone's owner.

## In scope

- Prompt injection that leads to a payment or a login, in any mode, or to any other action the user's permission mode should have stopped: a send, a remote write, a trusted memory, or a fetch the user didn't ask for.
- Any way to pay or log in without the approval sheet and the fingerprint, in any mode, or to send without asking in Ask mode. A switch to a mode that asks less without the user choosing it behind the warnings. An approval for different arguments than the sheet showed. Reusing, replaying or forging an approval.
- Approval sheets or cards that show model-written text as the app's own words, or that misstate the recipient, the amount or the destination.
- Untrusted text treated as the user's words, or taint that gets lost or cleared.
- User data leaving the phone without the user asking: through a skill, a connector, the relay, a log or a dependency.
- Breaking the audit log so tampering goes unnoticed.
- Reading Hermit's encrypted storage or its keys without the phone's protection, or secrets showing up in prompts, logs or crash output.
- Wallet logic on testnet: signing something other than what the sheet shows, getting around spending caps, or reaching mainnet.
- The sign-in relay (`apps/relay`) keeping or leaking tokens.
- The website (`apps/site`) loading a script, a tracker or anything from another host.
- This repository's CI: a pull request that gets secrets, write access, or code running somewhere it shouldn't.

## Out of scope

- A rooted or jailbroken phone, a malicious operating system, or someone holding the unlocked phone.
- Model mistakes with no security impact, like a wrong answer or a weak draft. Report those as bugs. A jailbreak that only makes the model say something, with no action taken and no data leaving, belongs in a bug report or an eval case.
- Bugs in third-party services and libraries (WhatsApp, mail providers, QVAC, Android). Report them upstream, and tell us if the way Hermit uses them makes things worse.
- Denial of service against your own phone, social engineering, and spam.
- The value of testnet funds, which is none. Logic bugs in the wallet are in scope.
- What a permission mode the user chose on purpose allows, like a send without asking in a mode that skips approvals. A mode that does more than its warnings say is in scope.
- Missing hardening with no impact you can show.

## Research in good faith

Use your own phones, accounts and data. Don't access other people's data. Use testnet funds only. Give us a reasonable time to ship a fix before you publish. If you follow these rules, we'll treat your report as the contribution it is and work on it with you.
