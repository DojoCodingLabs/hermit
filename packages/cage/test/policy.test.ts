import { describe, expect, test } from "vitest";
import { argsHash, skillId, type SessionState, type ToolCall } from "@hermit/core";
import { decide, defaultRules, type PolicyRule } from "../src/policy.ts";

const call = (skill: string, args: Record<string, unknown> = {}): ToolCall => ({
  id: "c1", skill: skillId(skill), args, argsHash: argsHash(args), repairs: [],
});
const session = (over: Partial<SessionState> = {}): SessionState => ({ id: "s1", taint: [], unattended: false, ...over });
const tainted = session({ taint: [{ kind: "inbound_message", ref: "whatsapp:ana", at: 1 }] });

describe("decide", () => {
  test("default rules allow read", () => {
    expect(decide(call("recall"), "read", session(), defaultRules()).effect).toBe("allow");
  });

  test("default rules ask with biometric for send", () => {
    const d = decide(call("reply_message"), "send", session(), defaultRules());
    expect(d.effect).toBe("ask");
    expect(d.requireBiometric).toBe(true);
  });

  test("deny wins over allow", () => {
    const rules: PolicyRule[] = [
      { id: "allow-all", skill: "*", effect: "allow" },
      { id: "no-forget", skill: skillId("forget"), effect: "deny" },
    ];
    const d = decide(call("forget"), "local_write", session(), rules);
    expect(d.effect).toBe("deny");
    expect(d.ruleId).toBe("no-forget");
  });

  test("no matching rule denies", () => {
    expect(decide(call("remind"), "local_write", session(), []).effect).toBe("deny");
  });

  test("taint escalates send to ask", () => {
    const rules: PolicyRule[] = [{ id: "allow-send", skill: skillId("reply_message"), effect: "allow" }];
    const d = decide(call("reply_message"), "send", tainted, rules);
    expect(d.effect).toBe("ask");
    expect(d.taintInfluenced).toBe(true);
  });

  test("unattended turns ask into deny", () => {
    const d = decide(call("reply_message"), "send", session({ unattended: true }), defaultRules());
    expect(d.effect).toBe("deny");
  });

  test("spend is denied in the first win", () => {
    expect(decide(call("pay"), "spend", session(), defaultRules()).effect).toBe("deny");
  });
});

describe("hard limits no rule set can loosen", () => {
  const allowAll: PolicyRule[] = [{ id: "allow-all", skill: "*", effect: "allow" }];

  // SL-37 (FR-CAGE-02, FR-CAGE-06): money and passwords never run without the user; when the rules open them they
  // ask with a strong biometric and a Keystore signature, and are denied outright when tainted or unattended.
  for (const [skill, risk] of [["pay", "spend"], ["fill_password", "credential"]] as const) {
    test(`hostile rules cannot allow ${risk}: it asks, with a biometric and a Keystore signature`, () => {
      const d = decide(call(skill), risk, session(), allowAll);
      expect(d).toMatchObject({ effect: "ask", requireBiometric: true, signedApproval: true });
    });

    test(`${risk} is denied in a tainted session, whatever the rules`, () => {
      const d = decide(call(skill), risk, tainted, allowAll);
      expect(d).toMatchObject({ effect: "deny", ruleId: "hard-tainted-money", taintInfluenced: true });
      expect(d.signedApproval).toBeUndefined();
    });

    test(`${risk} is denied in an unattended session (the night shift never gets these approvals)`, () => {
      const d = decide(call(skill), risk, session({ unattended: true }), allowAll);
      expect(d).toMatchObject({ effect: "deny", ruleId: "hard-unattended-money" });
      expect(d.signedApproval).toBeUndefined();
    });

    test(`${risk} stays closed under the default rules until its wave opens it`, () => {
      expect(decide(call(skill), risk, session(), defaultRules())).toMatchObject({ effect: "deny", reason: "Payments and passwords aren't available yet." });
    });

    test(`a rule that asks for ${risk} without a biometric still gets the biometric and the signature`, () => {
      const d = decide(call(skill), risk, session(), [{ id: "asks", skill: "*", risk, effect: "ask" }]);
      expect(d).toMatchObject({ effect: "ask", ruleId: "asks", requireBiometric: true, signedApproval: true });
    });
  }

  test("no other risk ever asks for a Keystore signature", () => {
    for (const risk of ["read", "local_write", "network", "remote_write", "send"] as const) {
      expect(decide(call("x"), risk, session(), allowAll).signedApproval).toBeUndefined();
    }
  });

  test("send never resolves to allow", () => {
    const d = decide(call("reply_message"), "send", session(), allowAll);
    expect(d.effect).toBe("ask");
    expect(d.requireBiometric).toBe(true);
  });

  test("tainted unattended send is denied", () => {
    expect(decide(call("reply_message"), "send", session({ unattended: true, taint: tainted.taint }), allowAll).effect).toBe("deny");
  });

  test("taint makes local writes ask", () => {
    const d = decide(call("forget"), "local_write", tainted, defaultRules());
    expect(d.effect).toBe("ask");
    expect(d.taintInfluenced).toBe(true);
  });

  test("untainted local writes are still allowed", () => {
    expect(decide(call("remember"), "local_write", session(), defaultRules()).effect).toBe("allow");
  });

  test("remote writes never resolve to allow (FR-CAGE-02)", () => {
    const d = decide(call("mail_modify"), "remote_write", session(), allowAll);
    expect(d.effect).toBe("ask");
  });

  test("tainted remote writes ask with the taint flag", () => {
    const d = decide(call("mail_modify"), "remote_write", tainted, allowAll);
    expect(d.effect).toBe("ask");
    expect(d.taintInfluenced).toBe(true);
  });

  test("unattended remote writes are denied", () => {
    expect(decide(call("mail_modify"), "remote_write", session({ unattended: true }), allowAll).effect).toBe("deny");
  });
});

describe("network and remote writes by default", () => {
  test("network reads ask by default", () => {
    expect(decide(call("read_web"), "network", session(), defaultRules()).effect).toBe("ask");
  });

  test("remote writes ask by default", () => {
    expect(decide(call("mail_modify"), "remote_write", session(), defaultRules()).effect).toBe("ask");
  });
});

describe("network fetches ask once per domain per session (FR-WEB-02)", () => {
  const web = (url: string) => call("read_web", { url });

  test("the first fetch from a domain asks", () => {
    expect(decide(web("https://example.com/a"), "network", session(), defaultRules()).effect).toBe("ask");
  });

  test("a domain approved in this session is allowed, www or not", () => {
    const s = session({ approvedDomains: ["example.com"] });
    for (const u of ["https://example.com/b", "https://www.example.com/c?x=1"]) {
      const d = decide(web(u), "network", s, defaultRules());
      expect(d.effect, u).toBe("allow");
      expect(d.ruleId).toBe("network-approved-domain");
    }
  });

  test("another domain, a subdomain or a look-alike still asks", () => {
    const s = session({ approvedDomains: ["example.com"] });
    for (const u of ["https://other.org/", "https://shop.example.com/", "https://example.com.evil.io/"]) {
      expect(decide(web(u), "network", s, defaultRules()).effect, u).toBe("ask");
    }
  });

  test("a call without a readable https address never counts as approved", () => {
    const s = session({ approvedDomains: ["example.com"] });
    expect(decide(web("http://example.com/"), "network", s, defaultRules()).effect).toBe("ask");
    expect(decide(call("read_web", {}), "network", s, defaultRules()).effect).toBe("ask");
  });

  test("tainted: an approved domain still asks unless the user wrote that exact address this turn", () => {
    const s = session({ approvedDomains: ["example.com"], taint: [{ kind: "inbound_message", ref: "read_web", at: 1 }] });
    // Injected content steering a fetch to leak data in the address.
    const leak = decide(web("https://example.com/?q=passport-ends-march"), "network", s, defaultRules(), { userText: "and the shipping page?" });
    expect(leak).toMatchObject({ effect: "ask", taintInfluenced: true });
    expect(decide(web("https://example.com/shipping"), "network", s, defaultRules()).effect).toBe("ask");
    // The user's own link stays allowed, written with https or http.
    for (const said of ["and https://example.com/shipping?", "and http://example.com/shipping"]) {
      expect(decide(web("https://example.com/shipping"), "network", s, defaultRules(), { userText: said }).effect, said).toBe("allow");
    }
    // A prefix of the user's link is not the user's link.
    expect(decide(web("https://example.com/shipping?x=1"), "network", s, defaultRules(), { userText: "https://example.com/shipping" }).effect).toBe("ask");
  });

  test("unattended, a new domain is denied; an approval never loosens a deny rule", () => {
    expect(decide(web("https://example.com/"), "network", session({ unattended: true }), defaultRules()).effect).toBe("deny");
    const rules: PolicyRule[] = [...defaultRules(), { id: "no-web", skill: skillId("read_web"), effect: "deny" }];
    expect(decide(web("https://example.com/"), "network", session({ approvedDomains: ["example.com"] }), rules).effect).toBe("deny");
  });
});

describe("web search asks once per provider per session (US-WEB-03, FR-WEB-02)", () => {
  const DDG = "https://html.duckduckgo.com/html/";
  const search = (query: string, destination: string | undefined = DDG): ToolCall => ({ ...call("search_web", { query }), ...(destination ? { destination } : {}) });

  const web = (url: string) => call("read_web", { url });

  test("the provider comes from the code-set destination, not from the args", () => {
    expect(decide(search("clima en Lima"), "network", session(), defaultRules()).effect).toBe("ask");
    const s = session({ approvedSearchProviders: [DDG] });
    expect(decide(search("clima en Lima"), "network", s, defaultRules())).toMatchObject({ effect: "allow", ruleId: "network-approved-domain" });
    // Another provider, or none (search off), is not covered by that approval.
    expect(decide(search("clima", "https://search.example.org/"), "network", s, defaultRules()).effect).toBe("ask");
    expect(decide(search("clima", ""), "network", s, defaultRules()).effect).toBe("ask");
    // A url arg can't stand in for the destination.
    const sneaky: ToolCall = { ...call("search_web", { query: "x", url: "https://html.duckduckgo.com/" }), destination: "https://evil.example/" };
    expect(decide(sneaky, "network", s, defaultRules()).effect).toBe("ask");
  });

  test("tainted: the query is the payload, so it must be the user's own words this turn", () => {
    const s = session({ approvedSearchProviders: [DDG], taint: [{ kind: "web", ref: "read_web", at: 1 }] });
    // A page or a result steering a search to leak data in the query.
    expect(decide(search("passport ends march 2027"), "network", s, defaultRules(), { userText: "y ahora busca vuelos baratos" })).toMatchObject({ effect: "ask", taintInfluenced: true });
    expect(decide(search("vuelos baratos"), "network", s, defaultRules(), { userText: "y ahora busca en internet: ¡Vuelos   BARATOS!" }).effect).toBe("allow");
    expect(decide(search("vuelos baratos"), "network", s, defaultRules()).effect).toBe("ask");
    // Part of a word is not the user's words.
    expect(decide(search("ruta"), "network", s, defaultRules(), { userText: "busca rutas" }).effect).toBe("ask");
  });

  test("search approvals and page approvals are separate lists: neither pre-approves the other", () => {
    // Approving a DuckDuckGo search doesn't let read_web open duckduckgo.com pages.
    const searched = session({ approvedSearchProviders: [DDG] });
    expect(decide(web("https://html.duckduckgo.com/html/?q=x"), "network", searched, defaultRules()).effect).toBe("ask");
    // Approving a page on a provider's site doesn't approve searching it.
    const read = session({ approvedDomains: ["html.duckduckgo.com"] });
    expect(decide(search("clima"), "network", read, defaultRules()).effect).toBe("ask");
    // A search approval is for that exact provider address, not every address on its site, and never plain http.
    const other = session({ approvedSearchProviders: ["https://search.example.org/"] });
    expect(decide(search("clima", "https://search.example.org/other/"), "network", other, defaultRules()).effect).toBe("ask");
    const http = session({ approvedSearchProviders: ["http://search.example.org/"] });
    expect(decide(search("clima", "http://search.example.org/"), "network", http, defaultRules()).effect).toBe("ask");
  });

  test("tainted: what is sent is exactly what was matched, so nothing rides along in the query", () => {
    const s = session({ approvedSearchProviders: [DDG], taint: [{ kind: "web", ref: "read_web", at: 1 }] });
    const userText = "busca vuelos lima email me x com 65";
    // Each of these normalizes to words the user wrote, but would send more than them.
    for (const q of ["vuelos lima?email=me@x.com", "vuelos lima email me@x com", "vuelos+lima", "vuelos lima/email", "vuelos lima %65", "vuelos lima #me", "vuelos_lima", "vuelos lima <email>", "vuelos​lima"]) {
      expect(decide(search(q), "network", s, defaultRules(), { userText }), q).toMatchObject({ effect: "ask", taintInfluenced: true });
    }
    // The user's words run without a sheet, and the query that runs is the matched one: lowercase words only.
    const ok = decide(search("¡Vuelos   BARATOS!"), "network", s, defaultRules(), { userText: "y ahora busca vuelos baratos" });
    expect(ok).toMatchObject({ effect: "allow", args: { query: "vuelos baratos" } });
    const comma = decide(search("Vuelos a Lima, mañana?"), "network", s, defaultRules(), { userText: "busca vuelos a Lima mañana" });
    expect(comma).toMatchObject({ effect: "allow", args: { query: "vuelos a lima mañana" } });
    // Untainted, nothing is rewritten.
    expect(decide(search("Vuelos a Lima"), "network", session({ approvedSearchProviders: [DDG] }), defaultRules()).args).toBeUndefined();
    // The user's own link (read_web) is never rewritten either.
    const link = decide(web("https://example.com/shipping"), "network", session({ approvedDomains: ["example.com"], taint: s.taint }), defaultRules(), { userText: "https://example.com/shipping" });
    expect(link.effect).toBe("allow");
    expect(link.args).toBeUndefined();
  });
});

describe("a person found by name always asks (PDR-028)", () => {
  test("an intent whose number code found by name asks even in a clean session, with the rules removed", () => {
    for (const rules of [defaultRules(), [{ id: "allow-all", skill: "*", effect: "allow" } as PolicyRule]]) {
      const d = decide(call("dial", { phone: "+50688881234", person: "Mamá" }), "local_write", session(), rules, { userText: "llama a mi mamá", foundByName: true });
      expect(d.effect).toBe("ask");
      expect(d.reason).toMatch(/by name/);
    }
  });

  test("the same intent with a number the user wrote runs without a sheet", () => {
    expect(decide(call("dial", { phone: "88881234" }), "local_write", session(), defaultRules(), { userText: "llama al 8888 1234" }).effect).toBe("allow");
  });

  test("a send found by name still needs the fingerprint, and an unattended session still can't ask", () => {
    const d = decide(call("mail_send", { to: "ana@x.com" }), "send", session(), defaultRules(), { foundByName: true });
    expect(d).toMatchObject({ effect: "ask", requireBiometric: true });
    expect(decide(call("dial", { phone: "+50688881234" }), "local_write", session({ unattended: true }), defaultRules(), { foundByName: true }).effect).toBe("deny");
  });

  test("a deny stays a deny", () => {
    const deny: PolicyRule[] = [{ id: "no-dial", skill: skillId("dial"), effect: "deny" }];
    expect(decide(call("dial", { phone: "+50688881234" }), "local_write", session(), deny, { foundByName: true }).effect).toBe("deny");
  });
});
