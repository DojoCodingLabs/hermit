import { describe, expect, test } from "vitest";
import { PERMISSION_MODES, type PermissionMode, type ReadKind, type Risk, type SkillGroup, type SkillId, type TaintSource } from "@hermit/core";
import { holds, inSources, type SkillFacts } from "../src/modes.ts";
import { decide, defaultRules, loginRules, webTaskRules, withPay, type PolicyRule } from "../src/policy.ts";
import { cage, call, CLEAN, PAY_CALL, REMEMBER_CALL, session, TODAY_CASES, WEB, WEB_PAY_CALL } from "./policy-cases.ts";

interface Turn {
  mode: PermissionMode;
  alone?: boolean;
  taint?: boolean;
  reads?: ReadKind[];
  grants?: SkillGroup[];
  sites?: string[];
  connectors?: string[];
  url?: string;
  destination?: string;
  /** The user's own words this turn. */
  said?: string;
  /** What this turn's skills read from others. */
  read?: string;
}

/** One call by bot b1 under the default rules: `[effect, ruleId, byMode, followUp]`. */
const d = (skill: string, risk: Risk, facts: SkillFacts, o: Turn) => {
  const r = decide(
    { ...call(skill, o.url ? { url: o.url } : {}), destination: o.destination },
    risk,
    session({ unattended: o.alone ?? false, taint: o.taint ? [WEB] : [], reads: o.reads }),
    defaultRules(),
    { userText: o.said, readText: o.read, bot: cage(o.mode, o.grants, { sites: o.sites ?? [], connectors: o.connectors ?? [] }), skill: facts },
  );
  return [r.effect, r.ruleId, r.byMode, r.followUp];
};

const READ_WEB = { tier: "low", group: "web_read" } as const, REPLY = { tier: "medium", group: "messages_reply" } as const;
const WALLET = { tier: "high", group: "wallet_pay" } as const;
const DDG = "https://html.duckduckgo.com/html/";

describe("permission modes in the cage (spec 6.4, 6.4.1)", () => {
  test("no bot: decide gives today's answers", () => {
    for (const c of TODAY_CASES) {
      const r = decide(c.call, c.risk, c.session, defaultRules(), c.said ? { userText: c.said } : {});
      expect([r.effect, r.ruleId, r.requireBiometric, r.taintInfluenced], c.name).toEqual(c.expected);
    }
  });

  test("Hermit in Ask, in a chat, decides exactly as with no bot", () => {
    const hermit = { ...cage("ask"), primary: true };
    for (const c of TODAY_CASES.filter((x) => !x.session.unattended)) {
      const said = c.said ? { userText: c.said } : {};
      const r = decide(c.call, c.risk, c.session, defaultRules(), { ...said, bot: hermit, skill: {} });
      expect([r.effect, r.ruleId, r.requireBiometric, r.taintInfluenced], c.name).toEqual(c.expected);
      expect(r, c.name).toEqual(decide(c.call, c.risk, c.session, defaultRules(), said));
    }
  });

  test("Ask in a chat is today's rules", () => {
    expect(d("read_web", "network", READ_WEB, { mode: "ask", url: "https://a.example" })[0]).toBe("ask");
    expect(d("remember", "local_write", { tier: "low", group: "notes" }, { mode: "ask", taint: true })[0]).toBe("ask");
  });

  test("a skill outside the bot's grants is denied in every mode", () => {
    for (const mode of PERMISSION_MODES) for (const alone of [false, true])
      expect(d("calendar_read", "read", { tier: "low", group: "calendar" }, { mode, alone, grants: ["notes"] })).toEqual(["deny", "bot-not-granted", undefined, undefined]);
  });

  test("a connector needs its source, and primary-only skills need the primary bot", () => {
    expect(d("conn_meta_ads_list", "network", { source: "meta_ads" }, { mode: "auto", connectors: [] })[1]).toBe("bot-not-granted");
    expect(d("create_bot", "read", { tier: "low" }, { mode: "dont_ask" })[1]).toBe("bot-not-granted");
  });

  test("a skill with no group and no source is the primary bot's only: connect_service", () => {
    for (const mode of PERMISSION_MODES) for (const alone of [false, true])
      expect(d("connect_service", "read", { tier: "low" }, { mode, alone })).toEqual(["deny", "bot-not-granted", undefined, undefined]);
    const hermit = { ...cage("ask"), primary: true };
    expect(decide(call("connect_service", { service: "Todoist" }), "read", CLEAN, defaultRules(), { bot: hermit, skill: { tier: "low" } }).effect).toBe("allow");
  });

  test("money and logins: the fingerprint in a chat, never alone, in every mode", () => {
    const chat = decide(PAY_CALL, "spend", CLEAN, withPay(defaultRules()), { bot: cage("dont_ask"), skill: { tier: "high", group: "wallet_pay" } });
    expect([chat.effect, chat.requireBiometric, chat.signedApproval]).toEqual(["ask", true, true]);
    expect(d("pay", "spend", { tier: "high", group: "wallet_pay" }, { mode: "dont_ask", alone: true })).toEqual(["deny", "bot-alone-money", undefined, "money_note"]);
  });

  test("money and logins come before the tiers: no mode runs them, even under a wrong low tier", () => {
    // A bot in Don't ask paying: denied in a chat (the default rules' spend floor) and alone.
    for (const alone of [false, true]) expect(d("pay", "spend", WALLET, { mode: "dont_ask", alone })[0], `alone ${alone}`).toBe("deny");
    // With pay open and the tier wrongly low, a chat still gets the fingerprint sheet and alone still gets the note.
    for (const mode of PERMISSION_MODES) for (const alone of [false, true]) {
      const s = { ...CLEAN, unattended: alone };
      const pay = decide(PAY_CALL, "spend", s, withPay(defaultRules()), { bot: cage(mode), skill: { tier: "low", group: "wallet_pay" } });
      const login = decide(call("fill_login"), "credential", s, loginRules(), { bot: cage(mode), skill: { tier: "low", group: "vault_logins" } });
      for (const r of [pay, login]) {
        const what = `${r.ruleId} ${mode} alone ${alone}`;
        expect([r.effect, r.byMode, r.followUp], what).toEqual(alone ? ["deny", undefined, "money_note"] : ["ask", undefined, undefined]);
        if (!alone) expect([r.requireBiometric, r.signedApproval], what).toEqual([true, true]);
      }
    }
  });

  test("Auto in a chat: low runs even after outside text; medium and high ask as in Ask", () => {
    expect(d("read_web", "network", READ_WEB, { mode: "auto", taint: true, url: "https://a.example", read: "Más en https://a.example" })).toEqual(["allow", "mode-auto-low", "auto", undefined]);
    expect(d("remember", "local_write", { tier: "low", group: "notes" }, { mode: "auto", taint: true })[2]).toBe("auto");
    expect(d("reply_message", "send", REPLY, { mode: "auto" })[0]).toBe("ask");
    expect(d("mcp_x_search", "network", { source: "x" }, { mode: "auto", connectors: ["x"] })[0]).toBe("ask");
  });

  test("Auto opens a link without asking only when its exact address is in the user's words or in what this turn read", () => {
    const page = "Receta completa: https://a.example/receta.";
    const link = "https://a.example/receta", composed = "https://a.example/receta?q=pasaporte-vence-marzo";
    // In a chat.
    expect(d("read_web", "network", READ_WEB, { mode: "auto", taint: true, read: page, url: link })).toEqual(["allow", "mode-auto-low", "auto", undefined]);
    expect(d("read_web", "network", READ_WEB, { mode: "auto", said: `lee ${link}`, url: link })).toEqual(["allow", "mode-auto-low", "auto", undefined]);
    expect(d("read_web", "network", READ_WEB, { mode: "auto", taint: true, read: page, url: composed })).toEqual(["ask", "network-asks", undefined, undefined]);
    expect(d("read_web", "network", READ_WEB, { mode: "auto", url: link })[0]).toBe("ask");
    // Alone.
    const alone = { mode: "auto" as const, alone: true, taint: true, reads: ["web" as const], read: page };
    expect(d("read_web", "network", READ_WEB, { ...alone, url: link })).toEqual(["allow", "mode-auto-low", "auto", undefined]);
    expect(d("read_web", "network", READ_WEB, { ...alone, url: composed })).toEqual(["deny", "bot-alone-suggest", undefined, "suggestion"]);
    // Auto's rule only: Ask still asks for a link it read, and Don't ask runs one it didn't.
    expect(d("read_web", "network", READ_WEB, { mode: "ask", taint: true, read: page, url: link })[0]).toBe("ask");
    expect(d("read_web", "network", READ_WEB, { mode: "dont_ask", taint: true, read: page, url: composed })[0]).toBe("allow");
  });

  test("the verbatim check takes the call's whole address as the fetch uses it: anything after a known link makes it unknown", () => {
    const known = "https://ex.com/known";
    expect(d("read_web", "network", READ_WEB, { mode: "auto", taint: true, read: `Mira ${known}`, url: known })).toEqual(["allow", "mode-auto-low", "auto", undefined]);
    for (const mark of ['"', "<", ">", " ", "`"]) {
      const url = `${known}${mark}SECRET`, what = JSON.stringify(mark);
      // In a chat it asks, whether the link was in what the turn read or in the user's words; alone it waits.
      expect(d("read_web", "network", READ_WEB, { mode: "auto", taint: true, read: `Mira ${known}`, url })[0], what).toBe("ask");
      expect(d("read_web", "network", READ_WEB, { mode: "auto", said: `lee ${known}`, url })[0], what).toBe("ask");
      expect(d("read_web", "network", READ_WEB, { mode: "auto", alone: true, taint: true, reads: ["web"], read: `Mira ${known}`, url }), what).toEqual(["deny", "bot-alone-suggest", undefined, "suggestion"]);
    }
  });

  test("a 64 KB read text written to stall the link match is decided in milliseconds, and its real link still counts", () => {
    const read = `https://a.example/${".".repeat(65_536)}x Receta completa: https://a.example/receta`;
    const start = performance.now();
    const r = d("read_web", "network", READ_WEB, { mode: "auto", taint: true, read, url: "https://a.example/receta" });
    const ms = performance.now() - start;
    expect(r).toEqual(["allow", "mode-auto-low", "auto", undefined]);
    expect(ms, `${ms.toFixed(1)} ms`).toBeLessThan(100);
  });

  test("Auto searches after outside text in a chat (the query goes to the user's own provider); alone it waits", () => {
    expect(d("search_web", "network", READ_WEB, { mode: "auto", taint: true, destination: DDG })).toEqual(["allow", "mode-auto-low", "auto", undefined]);
    expect(d("search_web", "network", READ_WEB, { mode: "ask", taint: true, destination: DDG })[0]).toBe("ask");
    expect(d("search_web", "network", READ_WEB, { mode: "auto", alone: true, taint: true, destination: DDG })).toEqual(["deny", "bot-alone-suggest", undefined, "suggestion"]);
  });

  test("Don't ask in a chat: every ask runs, except money and logins; floors still deny", () => {
    expect(d("reply_message", "send", REPLY, { mode: "dont_ask", taint: true })).toEqual(["allow", "mode-dont-ask", "dont_ask", undefined]);
    expect(decide(WEB_PAY_CALL, "spend", CLEAN, webTaskRules(), { bot: cage("dont_ask"), skill: { group: "web_tasks" } }).effect).toBe("deny");
  });

  test("Ask alone: its sources only, and the rest waits as a suggestion", () => {
    const o = { mode: "ask" as const, alone: true, sites: ["wikivoyage.org"] };
    expect(d("read_web", "network", READ_WEB, { ...o, url: "https://www.wikivoyage.org/ark:/1" })[0]).toBe("allow");
    expect(d("read_web", "network", READ_WEB, { ...o, url: "https://otro.example" })).toEqual(["deny", "bot-alone-suggest", undefined, "suggestion"]);
    expect(d("search_web", "network", READ_WEB, { ...o, destination: "https://html.duckduckgo.com/html/" })[3]).toBe("suggestion");
    expect(d("remember", "local_write", { tier: "low", group: "notes" }, { ...o, taint: true })[0]).toBe("allow");
    expect(d("remind", "local_write", { tier: "low", group: "reminders" }, o)[3]).toBe("suggestion");
    expect(d("mail_list", "network", { tier: "low", group: "mail_read" }, o)[0]).toBe("allow");
  });

  test("a look-alike host is not a source", () => {
    const o = { mode: "ask" as const, alone: true, sites: ["wikivoyage.org"] };
    for (const url of ["https://wikivoyage.org.evil.example/x", "http://wikivoyage.org/x", "https://evil.example/?u=wikivoyage.org"])
      expect(d("read_web", "network", READ_WEB, { ...o, url })[0], url).toBe("deny");
  });

  test("alone, private data and the web don't mix in one run, in Ask and Auto", () => {
    for (const mode of ["ask", "auto"] as const) {
      expect(d("read_web", "network", READ_WEB, { mode, alone: true, reads: ["private"], sites: ["wikivoyage.org"], url: "https://wikivoyage.org/x" })[1]).toBe("bot-alone-split");
      expect(d("read_messages", "read", { tier: "low", group: "messages_read" }, { mode, alone: true, reads: ["web"] })[1]).toBe("bot-alone-split");
    }
    expect(d("read_web", "network", READ_WEB, { mode: "dont_ask", alone: true, reads: ["private"], url: "https://a.example" })[0]).toBe("allow");
  });

  test("Auto alone: low runs anywhere; medium and high become suggestions", () => {
    const o = { mode: "auto" as const, alone: true };
    expect(d("read_web", "network", READ_WEB, { ...o, url: "https://a.example", read: "Más en https://a.example" })).toEqual(["allow", "mode-auto-low", "auto", undefined]);
    expect(d("calendar_add", "local_write", { tier: "low", group: "calendar" }, o)[0]).toBe("allow");
    expect(d("reply_message", "send", REPLY, o)[3]).toBe("suggestion");
    expect(d("forget", "local_write", { tier: "medium", group: "notes" }, o)[3]).toBe("suggestion");
    expect(d("conn_x_list", "network", { source: "x" }, { ...o, connectors: ["x"] })[0]).toBe("allow");   // Ask alone allows it
    expect(d("search_web", "network", READ_WEB, { ...o, destination: "https://html.duckduckgo.com/html/", sites: ["duckduckgo.com"] })[3]).toBe("suggestion");   // fail-closed in wave 1
  });

  test("Don't ask alone: everything runs except money and logins", () => {
    expect(d("reply_message", "send", REPLY, { mode: "dont_ask", alone: true })).toEqual(["allow", "mode-dont-ask", "dont_ask", undefined]);
  });

  test("deny wins in every mode", () => {
    const rules = [...defaultRules(), { id: "no-remember", skill: "remember" as SkillId, effect: "deny" as const }];
    for (const mode of PERMISSION_MODES) for (const alone of [false, true])
      expect(decide(REMEMBER_CALL, "local_write", { ...CLEAN, unattended: alone }, rules, { bot: cage(mode), skill: { tier: "low", group: "notes" } }).effect).toBe("deny");
  });

  test("a step the rules deny stays that deny alone, never a suggestion to approve later", () => {
    const rules = [...defaultRules(), { id: "no-remind", skill: "remind" as SkillId, effect: "deny" as const }];
    for (const mode of PERMISSION_MODES) {
      const r = decide(call("remind"), "local_write", { ...CLEAN, unattended: true }, rules, { bot: cage(mode), skill: { tier: "low", group: "reminders" } });
      expect([r.effect, r.ruleId, r.followUp], mode).toEqual(["deny", "no-remind", undefined]);
    }
  });

  test("holds and inSources, as a bot's menu and its alone turns read them", () => {
    const b = cage("ask", ["notes", "web_read"], { sites: ["wikivoyage.org"], connectors: ["x"] });
    expect([holds(b, { group: "notes" }), holds(b, { group: "calendar" }), holds(b, { source: "x" }), holds(b, { source: "y" }), holds(b, {})]).toEqual([true, false, true, false, false]);
    expect(holds({ ...b, primary: true }, {})).toBe(true);
    const page = (url: string) => inSources(call("read_web", { url }), READ_WEB, b.sources);
    expect(["https://www.wikivoyage.org/ark:/1", "https://wikivoyage.org.evil.example/x", "http://wikivoyage.org/x", "https://evil.example/?u=wikivoyage.org"].map(page)).toEqual([true, false, false, false]);
    // A search never counts in wave 1, even with a listed site in its args or as its provider.
    const onSite = "https://www.wikivoyage.org/search";
    expect(inSources({ ...call("search_web", { query: "Ana Prueba", url: onSite }), destination: onSite }, READ_WEB, b.sources)).toBe(false);
    expect([inSources(call("conn_x_list"), { source: "x" }, b.sources), inSources(call("conn_y_list"), { source: "y" }, b.sources)]).toEqual([true, false]);
  });

  test("bot taint: a link or search from another bot's text never counts as the user's own words", () => {
    const botTaint: TaintSource = { kind: "bot", ref: "viajes", at: 1 };
    const linkCall = call("read_web", { url: "https://otro.example/deal" });
    const searchCall = { ...call("search_web", { query: "vuelos a cusco" }), destination: DDG };

    for (const mode of ["ask", "auto"] as const) {
      const chatLink = decide(linkCall, "network", session({ taint: [botTaint] }), defaultRules(), {
        bot: cage(mode),
        skill: READ_WEB,
      });
      expect(chatLink.effect, `chat link ${mode}`).toBe("ask");

      const aloneLink = decide(linkCall, "network", session({ unattended: true, taint: [botTaint] }), defaultRules(), {
        bot: cage(mode),
        skill: READ_WEB,
      });
      expect([aloneLink.effect, aloneLink.ruleId, aloneLink.followUp], `alone link ${mode}`).toEqual(["deny", "bot-alone-suggest", "suggestion"]);

      const aloneSearch = decide(
        searchCall,
        "network",
        session({ unattended: true, taint: [botTaint], approvedSearchProviders: [DDG] }),
        defaultRules(),
        { bot: cage(mode), skill: READ_WEB },
      );
      expect([aloneSearch.effect, aloneSearch.followUp], `alone search ${mode}`).toEqual(["deny", "suggestion"]);
    }

    const chatAskSearch = decide(
      searchCall,
      "network",
      session({ taint: [botTaint], approvedSearchProviders: [DDG] }),
      defaultRules(),
      { bot: cage("ask"), skill: READ_WEB },
    );
    expect(chatAskSearch.effect).toBe("ask");
    expect(chatAskSearch.taintInfluenced).toBe(true);
  });

  test("bot taint denies spend and credential in every mode, even with configurable rules opened", () => {
    const botTaint: TaintSource = { kind: "bot", ref: "viajes", at: 1 };
    const allowAll: PolicyRule[] = [{ id: "allow-all", skill: "*", effect: "allow" }];

    for (const mode of PERMISSION_MODES) {
      for (const [c, risk, group] of [
        [PAY_CALL, "spend", "wallet_pay"],
        [call("fill_password"), "credential", "vault_logins"],
      ] as const) {
        const chat = decide(c, risk, session({ taint: [botTaint] }), allowAll, {
          bot: cage(mode),
          skill: { tier: "low", group },
        });
        expect([chat.effect, chat.ruleId, chat.taintInfluenced, chat.signedApproval], `chat ${mode} ${risk}`).toEqual([
          "deny",
          "hard-tainted-money",
          true,
          undefined,
        ]);

        const alone = decide(c, risk, session({ unattended: true, taint: [botTaint] }), allowAll, {
          bot: cage(mode),
          skill: { tier: "low", group },
        });
        expect([alone.effect, alone.ruleId, alone.followUp, alone.signedApproval], `alone ${mode} ${risk}`).toEqual([
          "deny",
          "bot-alone-money",
          "money_note",
          undefined,
        ]);
      }
    }
  });
});
