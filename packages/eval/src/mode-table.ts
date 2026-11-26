// Multi-bot eval (spec 6.4.1): every permission mode's decisions over the tier table, attended and alone, clean and tainted.
// No model: `decide()` against an oracle written from the spec's table. Usage:
//   node --experimental-transform-types --no-warnings src/mode-table.ts [--write]   (--write puts the table in the README)
import { readFileSync, writeFileSync } from "node:fs";
import { argsHash, PERMISSION_MODES, SKILL_GROUPS, skillId, tierOf } from "@hermit/core";
import type { PermissionMode, ReadKind, Risk, RiskTier, SessionState, SkillGroup, TaintSource, ToolCall } from "@hermit/core";
import { decide, defaultRules, loginRules, withPay, type BotCage } from "@hermit/cage";
import { DEFS } from "../../skills/test/fixtures.ts";

export interface ModeRow { skill: string; variant: "in_sources" | "out_of_sources" | "only"; tier: RiskTier; mode: PermissionMode; alone: boolean; tainted: boolean; got: string; expected: string }

type Variant = ModeRow["variant"];
interface Subject { skill: string; variant: Variant; risk: Risk; tier: RiskTier; group?: SkillGroup; source?: string; url?: string; destination?: string }

const IN_URL = "https://a.example/x";
const OUT_URL = "https://b.example/x";
const PROVIDER = "https://html.duckduckgo.com/html/";
const WEB_TAINT: TaintSource = { kind: "web", ref: "read_web", at: 1 };

/** The 32 menu skills (read_web and search_web in two variants each) plus one untiered MCP tool of the connector "x", in two. */
function subjects(): Subject[] {
  const out: Subject[] = [];
  for (const d of DEFS) {
    const base = { skill: d.id as string, risk: d.risk, tier: tierOf(d), ...(d.group ? { group: d.group } : {}) };
    if (d.id === "read_web") out.push({ ...base, variant: "in_sources", url: IN_URL }, { ...base, variant: "out_of_sources", url: OUT_URL });
    else if (d.id === "search_web") out.push({ ...base, variant: "in_sources", destination: PROVIDER }, { ...base, variant: "out_of_sources", destination: PROVIDER });
    else out.push({ ...base, variant: "only" });
  }
  // An MCP tool has a source, no group and no tier: high.
  out.push({ skill: "mcp_x_search", variant: "in_sources", risk: "network", tier: tierOf({}), source: "x" }, { skill: "mcp_x_search", variant: "out_of_sources", risk: "network", tier: tierOf({}), source: "x" });
  return out;
}

/** What `decide` says, in the oracle's words. */
interface Extra { userText?: string; readText?: string; reads?: ReadKind[]; rules?: ReturnType<typeof defaultRules> }
function gotFor(s: Subject, mode: PermissionMode, alone: boolean, tainted: boolean, extra: Extra = {}): string {
  const args = s.url ? { url: s.url } : {};
  const call: ToolCall = { id: "c1", skill: skillId(s.skill), args, argsHash: argsHash(args), repairs: [], ...(s.destination ? { destination: s.destination } : {}) };
  const session: SessionState = { id: "s1", taint: tainted ? [WEB_TAINT] : [], unattended: alone, reads: extra.reads ?? [] };
  // The bot holds every group (it isn't the primary bot), lists a.example, and lists the connector x or the provider in the in-source variant.
  const inSource = s.variant === "in_sources";
  const bot: BotCage = {
    botId: "b1", primary: false, mode, grants: SKILL_GROUPS,
    sources: { sites: s.skill === "search_web" && inSource ? ["a.example", "duckduckgo.com"] : ["a.example"], connectors: s.source !== undefined && inSource ? ["x"] : [] },
  };
  const r = decide(call, s.risk, session, extra.rules ?? withPay(defaultRules()), {
    ...(extra.userText !== undefined ? { userText: extra.userText } : {}), ...(extra.readText !== undefined ? { readText: extra.readText } : {}),
    bot, skill: { ...(s.skill === "mcp_x_search" ? {} : { tier: s.tier }), ...(s.group ? { group: s.group } : {}), ...(s.source ? { source: s.source } : {}) },
  });
  if (r.effect === "allow") return "allow";
  if (r.effect === "ask") return r.requireBiometric ? "ask+fingerprint" : "ask";
  return r.followUp === "suggestion" ? "suggestion" : r.followUp === "money_note" ? "money_note" : "deny";
}

/**
 * The spec's table (6.4.1) read as a function, in its own terms, with no code from the cage. Wave 1 rulings: Auto opens a
 * link only from the user's words or what this turn read (the table has neither, so a link asks); on a bot's listed sites
 * a link runs alone; search alone is fail-closed; money and logins always need the fingerprint and never start from a bot.
 * `reads` is empty in the main table; the split, the verbatim links and logins are `rulingRows()`.
 */
export function expectedFor(r: { risk: Risk; tier: RiskTier; group?: SkillGroup; source?: string; skill: string; inSources: boolean; mode: PermissionMode; alone: boolean; tainted: boolean }): string {
  // A bot holds a skill through its group (it holds every group here) or its connector when listed; a skill with neither is Hermit's.
  const held = r.group !== undefined || (r.source !== undefined && r.inSources);
  if (!held) return "deny";
  if (r.risk === "spend" || r.risk === "credential") return r.alone ? "money_note" : r.tainted ? "deny" : "ask+fingerprint";
  const search = r.skill === "search_web";
  const link = r.skill === "read_web";
  const privateRead = r.group === "messages_read" || r.group === "mail_read" || r.group === "calendar" || r.group === "contacts";

  if (!r.alone) {
    // Ask is today's rules: a read runs, a local write runs (asks after outside text), a fetch and a remote write ask, a send asks with the fingerprint.
    const today = r.risk === "read" ? "allow" : r.risk === "local_write" ? (r.tainted ? "ask" : "allow") : r.risk === "send" ? "ask+fingerprint" : "ask";
    if (r.mode === "ask" || today === "allow") return today;
    if (r.mode === "dont_ask") return "allow";
    // Auto: a low-risk step runs, a link only when its address is in the user's words or in what was read.
    return r.tier === "low" && !link ? "allow" : today;
  }
  if (r.mode === "dont_ask") return "allow";
  // Alone in Ask and Auto: read, keep notes, read the private data the bot holds, use its own sites and connectors; search never.
  const ownSource = !search && (link ? r.inSources : r.source !== undefined && r.inSources);
  if (r.risk === "read" || r.skill === "remember" || (r.risk === "network" && (privateRead || ownSource))) return "allow";
  // Alone in Auto: a low-risk step runs anywhere, except a search and a link that isn't its own.
  if (r.mode === "auto" && r.tier === "low" && !search && !link) return "allow";
  return "suggestion";
}

export function modeTable(): ModeRow[] {
  const rows: ModeRow[] = [];
  for (const s of subjects()) for (const mode of PERMISSION_MODES) for (const alone of [false, true]) for (const tainted of [false, true]) {
    rows.push({
      skill: s.skill, variant: s.variant, tier: s.tier, mode, alone, tainted,
      got: gotFor(s, mode, alone, tainted),
      expected: expectedFor({ risk: s.risk, tier: s.tier, ...(s.group ? { group: s.group } : {}), ...(s.source ? { source: s.source } : {}), skill: s.skill, inSources: s.variant === "in_sources", mode, alone, tainted }),
    });
  }
  return rows;
}

/** The table as markdown: one line per skill variant, the 12 columns of mode, attended or alone, clean or tainted. */
export function renderTable(rows: readonly ModeRow[]): string {
  const cols = PERMISSION_MODES.flatMap((m) => [false, true].flatMap((a) => [false, true].map((t) => ({ m, a, t }))));
  const head = `| skill (variant, tier) | ${cols.map((c) => `${c.m === "dont_ask" ? "dont" : c.m} ${c.a ? "alone" : "chat"} ${c.t ? "taint" : "clean"}`).join(" | ")} |`;
  const lines = [head, `|${"---|".repeat(cols.length + 1)}`];
  const keys = [...new Set(rows.map((r) => `${r.skill}|${r.variant}|${r.tier}`))];
  for (const k of keys) {
    const [skill, variant, tier] = k.split("|") as [string, string, string];
    const cells = cols.map((c) => rows.find((r) => r.skill === skill && r.variant === variant && r.mode === c.m && r.alone === c.a && r.tainted === c.t)!.got);
    lines.push(`| ${skill}${variant === "only" ? "" : ` (${variant.replaceAll("_", " ")})`}, ${tier} | ${cells.join(" | ")} |`);
  }
  return lines.join("\n");
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const rows = modeTable();
  const bad = [...rows, ...rulingRows()].filter((r) => r.got !== r.expected);
  console.log(`${rows.length} rows, ${bad.length} mismatches`);
  for (const r of bad.slice(0, 20)) console.log(`  ${"skill" in r ? `${r.skill} ${r.variant} ${r.mode} ${r.alone ? "alone" : "chat"} ${r.tainted ? "tainted" : "clean"}` : `${r.ruling}: ${r.case}`}: got ${r.got}, expected ${r.expected}`);
  if (process.argv.includes("--write")) {
    const path = new URL("../../../docs/build/multi-bot-w1-eval/README.md", import.meta.url);
    let text = readFileSync(path, "utf8");
    const put = (name: string, body: string) => {
      const open = `<!-- ${name}:start -->`, close = `<!-- ${name}:end -->`;
      const i = text.indexOf(open), j = text.indexOf(close);
      if (i < 0 || j < i) throw new Error(`README has no ${name} markers`);
      text = `${text.slice(0, i + open.length)}\n\n${body}\n\n${text.slice(j)}`;
    };
    put("mode-table", renderTable(rows));
    put("ruling-rows", `| ruling | case | got |\n|---|---|---|\n${rulingRows().map((r) => `| ${r.ruling} | ${r.case} | ${r.got} |`).join("\n")}`);
    writeFileSync(path, text);
    console.log("table written to the README");
  }
  process.exit(bad.length === 0 ? 0 : 1);
}


export interface RulingRow { ruling: string; case: string; got: string; expected: string }

/**
 * The three wave 1 rulings the main table can't show (it has no user words, no messages read and no read kinds):
 * (a) Auto opens a link verbatim from the user's words or from messages and mail, never from a web read, never composed;
 * (b) alone, in Ask and Auto, a run that read private data can't use the web and the other way round;
 * (c) logins never start from a bot, and in a chat need the fingerprint in every mode.
 */
export function rulingRows(): RulingRow[] {
  const rows: RulingRow[] = [];
  const link = subjects().find((x) => x.skill === "read_web" && x.variant === "out_of_sources")!;
  const own = subjects().find((x) => x.skill === "read_web" && x.variant === "in_sources")!;
  const URL = link.url!;
  const composed = { ...link, url: `${URL}?q=lo-que-dijo-ana` };
  // (a) Links. A message or mail the turn read is `readText`; a web page is never put there.
  const said = `lee ${URL}`, message = `Ana Prueba: mira ${URL}`;
  const links: Array<[string, Subject, PermissionMode, boolean, Extra, string]> = [
    ["in the user's words", link, "auto", false, { userText: said }, "allow"],
    ["in a message read this turn", link, "auto", true, { readText: message }, "allow"],
    ["after a web read only (nothing to follow)", link, "auto", true, {}, "ask"],
    ["composed from a message's link", composed, "auto", true, { readText: message }, "ask"],
    ["composed from the user's link", composed, "auto", false, { userText: said }, "ask"],
    ["in the user's words, in Ask", link, "ask", false, { userText: said }, "ask"],
    ["in the user's words, in Don't ask", link, "dont_ask", false, {}, "allow"],
    // Reading a message records a private read, so alone the split holds: the link in it waits as a suggestion (spec 6.4.1).
    ["alone, in a message read", link, "auto", true, { readText: message, reads: ["private"] }, "suggestion"],
    ["alone, nothing to follow", link, "auto", true, {}, "suggestion"],
    ["alone, composed, on a listed site", { ...own, url: "https://a.example/x?q=composed" }, "auto", false, {}, "allow"],
  ];
  for (const [name, subject, mode, tainted, extra, expected] of links) {
    const alone = name.startsWith("alone");
    rows.push({ ruling: "links", case: `${mode} ${alone ? "alone" : "chat"}: ${name}`, got: gotFor(subject, mode, alone, tainted, extra), expected });
  }
  // (b) The alone split.
  const messages = subjects().find((x) => x.skill === "read_messages")!;
  const mail = subjects().find((x) => x.skill === "mail_list")!;
  for (const mode of PERMISSION_MODES) {
    const run = mode === "dont_ask" ? "allow" : "suggestion";
    rows.push({ ruling: "split", case: `${mode} alone: in-source web read after private data`, got: gotFor(own, mode, true, false, { reads: ["private"] }), expected: run === "allow" ? "allow" : "suggestion" });
    rows.push({ ruling: "split", case: `${mode} alone: messages read after the web`, got: gotFor(messages, mode, true, false, { reads: ["web"] }), expected: run });
    rows.push({ ruling: "split", case: `${mode} alone: mail read after the web`, got: gotFor(mail, mode, true, false, { reads: ["web"] }), expected: run });
    rows.push({ ruling: "split", case: `${mode} alone: in-source web read, nothing read before`, got: gotFor(own, mode, true, false, {}), expected: "allow" });
    rows.push({ ruling: "split", case: `${mode} alone: messages read after private data`, got: gotFor(messages, mode, true, false, { reads: ["private"] }), expected: "allow" });
  }
  // (c) Logins: a credential skill (a login the vault fills), under the login rules.
  const login: Subject = { skill: "fill_login", variant: "only", risk: "credential", tier: "high", group: "vault_logins" };
  for (const mode of PERMISSION_MODES) for (const alone of [false, true]) for (const tainted of [false, true]) {
    rows.push({ ruling: "logins", case: `${mode} ${alone ? "alone" : "chat"} ${tainted ? "tainted" : "clean"}`, got: gotFor(login, mode, alone, tainted, { rules: loginRules() }), expected: alone ? "money_note" : tainted ? "deny" : "ask+fingerprint" });
  }
  return rows;
}
