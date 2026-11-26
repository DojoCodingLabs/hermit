/**
 * SL-57: HM-CONN-05's relay choices (US-CONN-09, US-CONN-10, PDR-022) and what HM-SET-02 lists for them.
 */
import { describe, expect, test } from "vitest";
import type { ConnectorRequest, ConnectorTransport } from "@hermit/connectors";
import { nodeSql } from "@hermit/sql-node";
import { ed25519Signer } from "@hermit/cage";
import { profileById } from "@hermit/model";
import { createHermit } from "../src/hermit.ts";
import { createRelaySettings, type RelaySettingKey } from "../src/relay.ts";
import { privacyHosts } from "../src/settings-view.ts";

function store(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    get: async (key: RelaySettingKey) => values.get(key),
    set: async (key: RelaySettingKey, value: string) => void values.set(key, value),
    remove: async (key: RelaySettingKey) => void values.delete(key),
  };
}

function relayServer(answer: { status: number; body: string } | Error = { status: 200, body: JSON.stringify({ protocol: "hermit-relay-1", callback: "https://relay.example.org/v1/callback", providers: [{ id: "slack", clientId: "1.2" }, { id: "notion", clientId: "n" }] }) }) {
  const sent: ConnectorRequest[] = [];
  const transport: ConnectorTransport = {
    async send(req) {
      sent.push(req);
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
  return { sent, transport };
}

describe("the user's own relay (US-CONN-09)", () => {
  test("nothing is set at first; Dojo's relay is off and, until Q43, not available", async () => {
    const r = createRelaySettings({ settings: store(), transport: relayServer().transport });
    expect(await r.view()).toEqual({ dojo: { available: false, on: false } });
  });

  test("saves a public https address, normalized", async () => {
    const s = store();
    const r = createRelaySettings({ settings: s, transport: relayServer().transport });
    expect(await r.saveOwn("  https://Relay.Example.org/hermit/ ")).toEqual({ ok: true });
    expect(s.values.get("relay.own")).toBe("https://relay.example.org/hermit");
    expect(await r.view()).toEqual({ own: { url: "https://relay.example.org/hermit", host: "relay.example.org" }, dojo: { available: false, on: false } });
  });

  test("refuses a private, LAN or loopback host, plain http and another port, and keeps what was saved", async () => {
    const s = store({ "relay.own": "https://relay.example.org" });
    const r = createRelaySettings({ settings: s, transport: relayServer().transport });
    for (const bad of ["https://192.168.1.10", "https://10.0.0.2", "https://localhost", "https://nas.local", "https://relay.home.arpa", "http://relay.example.org", "https://relay.example.org:8443", "https://[fd00::1]"]) {
      expect(await r.saveOwn(bad), bad).toEqual({ ok: false, problem: "bad_address" });
    }
    expect(s.values.get("relay.own")).toBe("https://relay.example.org");
  });

  test("a stored value that no longer passes the check is treated as unset (fail closed)", async () => {
    const r = createRelaySettings({ settings: store({ "relay.own": "https://192.168.1.10" }), transport: relayServer().transport });
    expect((await r.view()).own).toBeUndefined();
  });

  test("removing the relay forgets it", async () => {
    const s = store({ "relay.own": "https://relay.example.org" });
    const r = createRelaySettings({ settings: s, transport: relayServer().transport });
    await r.removeOwn();
    expect(s.values.has("relay.own")).toBe(false);
  });

  test("checking a relay lists the services it signs in for, by name", async () => {
    const server = relayServer();
    const r = createRelaySettings({ settings: store(), transport: server.transport });
    expect(await r.check("https://relay.example.org")).toEqual({ kind: "ok", providers: ["Slack", "Notion"] });
    expect(server.sent.map((q) => `${q.method} ${q.url}`)).toEqual(["GET https://relay.example.org/v1/providers"]);
  });

  test("checking a private address sends nothing", async () => {
    const server = relayServer();
    const r = createRelaySettings({ settings: store(), transport: server.transport });
    expect(await r.check("https://192.168.0.5")).toEqual({ kind: "refused", problem: "bad_address" });
    expect(server.sent).toEqual([]);
  });

  test("an unreachable relay, or something that isn't one, says so", async () => {
    expect(await createRelaySettings({ settings: store(), transport: relayServer(new Error("offline")).transport }).check("https://relay.example.org")).toEqual({ kind: "refused", problem: "unreachable" });
    expect(await createRelaySettings({ settings: store(), transport: relayServer({ status: 200, body: "<html>" }).transport }).check("https://relay.example.org")).toEqual({ kind: "refused", problem: "not_a_relay" });
  });
});

describe("Dojo's relay (US-CONN-10, PDR-022)", () => {
  test("can't be turned on while Dojo has no relay (Q43)", async () => {
    const s = store();
    const r = createRelaySettings({ settings: s, transport: relayServer().transport });
    expect(await r.setDojo(true)).toEqual({ ok: false, problem: "not_available" });
    expect(s.values.has("relay.dojo")).toBe(false);
  });

  test("once configured it is off by default, and turning it on or off is stored", async () => {
    const s = store();
    const r = createRelaySettings({ settings: s, transport: relayServer().transport, dojoRelayUrl: "https://relay.dojocoding.io" });
    expect((await r.view()).dojo).toEqual({ available: true, on: false, host: "relay.dojocoding.io" });
    expect(await r.setDojo(true)).toEqual({ ok: true });
    expect(s.values.get("relay.dojo")).toBe("1");
    expect((await r.view()).dojo.on).toBe(true);
    expect(await r.setDojo(false)).toEqual({ ok: true });
    expect(s.values.has("relay.dojo")).toBe(false);
  });

  test("a stale opt-in with no Dojo relay configured is off", async () => {
    const r = createRelaySettings({ settings: store({ "relay.dojo": "1" }), transport: relayServer().transport });
    expect((await r.view()).dojo).toEqual({ available: false, on: false });
  });

  test("a Dojo relay URL that fails the address check is not available", async () => {
    const r = createRelaySettings({ settings: store(), transport: relayServer().transport, dojoRelayUrl: "http://relay.dojocoding.io" });
    expect((await r.view()).dojo.available).toBe(false);
  });

  test("the sign-in options read the same choices (signInOptions)", async () => {
    const r = createRelaySettings({ settings: store({ "relay.own": "https://relay.example.org", "relay.dojo": "1" }), transport: relayServer().transport, dojoRelayUrl: "https://relay.dojocoding.io" });
    expect(await r.signIn()).toEqual({ settings: { ownClientIds: {}, ownRelayUrl: "https://relay.example.org", dojoRelayOptIn: true }, config: { dojoClientIds: {}, dojoRelayUrl: "https://relay.dojocoding.io" } });
  });
});

describe("the user's own OAuth client IDs (US-CONN-08, PDR-021) and Dojo's from the build config (Q43)", () => {
  const GOOGLE = "123456789012-abcdefghijklmnop.apps.googleusercontent.com";
  const MICROSOFT = "00000000-1111-2222-3333-444444444444";

  test("none at first: no own client and, until Dojo's are configured, none of Dojo's", async () => {
    const r = createRelaySettings({ settings: store() });
    expect(await r.clients()).toEqual({ own: {}, dojo: { google: false, microsoft: false } });
    expect((await r.signIn()).settings.ownClientIds).toEqual({});
    expect((await r.signIn()).config.dojoClientIds).toEqual({});
  });

  test("saves a Google or Microsoft client ID that has the provider's shape, trimmed, and the sign-in reads it", async () => {
    const s = store();
    const r = createRelaySettings({ settings: s });
    expect(await r.saveClientId("google", `  ${GOOGLE} `)).toEqual({ ok: true });
    expect(await r.saveClientId("microsoft", MICROSOFT)).toEqual({ ok: true });
    expect(JSON.parse(s.values.get("signin.clients")!)).toEqual({ google: GOOGLE, microsoft: MICROSOFT });
    expect(await r.clients()).toEqual({ own: { google: GOOGLE, microsoft: MICROSOFT }, dojo: { google: false, microsoft: false } });
    expect((await r.signIn()).settings.ownClientIds).toEqual({ google: GOOGLE, microsoft: MICROSOFT });
  });

  test("refuses anything without the provider's shape, or another provider, and keeps what was saved", async () => {
    const s = store();
    const r = createRelaySettings({ settings: s });
    await r.saveClientId("google", GOOGLE);
    for (const bad of ["", "abc", `${GOOGLE} extra`, "123.apps.googleusercontent.com.evil.com", MICROSOFT]) {
      expect(await r.saveClientId("google", bad), bad).toEqual({ ok: false, problem: "bad_client_id" });
    }
    expect(await r.saveClientId("microsoft", GOOGLE)).toEqual({ ok: false, problem: "bad_client_id" });
    expect(await r.saveClientId("spotify" as never, "0123456789abcdef0123456789abcdef")).toEqual({ ok: false, problem: "bad_client_id" });
    expect(JSON.parse(s.values.get("signin.clients")!)).toEqual({ google: GOOGLE });
  });

  test("a stored value that no longer passes the check, or isn't JSON, is treated as unset (fail closed)", async () => {
    expect((await createRelaySettings({ settings: store({ "signin.clients": JSON.stringify({ google: "nope", microsoft: MICROSOFT, slack: "x" }) }) }).clients()).own).toEqual({ microsoft: MICROSOFT });
    expect((await createRelaySettings({ settings: store({ "signin.clients": "{not json" }) }).clients()).own).toEqual({});
    expect((await createRelaySettings({ settings: store({ "signin.clients": "[1,2]" }) }).signIn()).settings.ownClientIds).toEqual({});
  });

  test("removing a client ID forgets only that one", async () => {
    const s = store({ "signin.clients": JSON.stringify({ google: GOOGLE, microsoft: MICROSOFT }) });
    const r = createRelaySettings({ settings: s });
    await r.removeClientId("google");
    expect((await r.clients()).own).toEqual({ microsoft: MICROSOFT });
    await r.removeClientId("microsoft");
    expect(s.values.has("signin.clients")).toBe(false);
  });

  test("Dojo's client IDs come from the build config only when they have the provider's shape", async () => {
    const r = createRelaySettings({ settings: store(), dojoClientIds: { google: GOOGLE, microsoft: "not-a-guid" } });
    expect((await r.clients()).dojo).toEqual({ google: true, microsoft: false });
    expect((await r.signIn()).config.dojoClientIds).toEqual({ google: GOOGLE });
  });
});

describe("through the composition root", () => {
  test("the choices live in the settings table and come back out of it", async () => {
    const hermit = createHermit(
      {
        sql: nodeSql(),
        signer: ed25519Signer(new Uint8Array(32).fill(4)),
        notifier: { schedule: async () => "n", cancel: async () => {} },
        calendar: { list: async () => [], add: async () => {}, calendars: async () => [] },
        replySender: { send: async () => "sent" },
        engine: { complete: async () => ({ text: "", toolCalls: [] }) },
        approvals: { request: async () => ({ approved: false }) as never },
        now: () => 0,
        timeZone: () => "UTC",
        language: () => "en",
        newId: () => "id",
        relay: { transport: relayServer().transport, dojoRelayUrl: "https://relay.dojocoding.io" },
      },
      profileById("botpsy-q4-two-stage-nothink")!,
    );
    await hermit.init();
    expect(await hermit.relay.saveOwn("https://relay.example.org")).toEqual({ ok: true });
    expect(await hermit.relay.setDojo(true)).toEqual({ ok: true });
    expect(await hermit.settings.get("relay.own")).toBe("https://relay.example.org");
    expect(await hermit.relay.view()).toEqual({ own: { url: "https://relay.example.org", host: "relay.example.org" }, dojo: { available: true, on: true, host: "relay.dojocoding.io" } });
    await hermit.relay.setDojo(false);
    await hermit.relay.removeOwn();
    expect(await hermit.relay.view()).toEqual({ dojo: { available: true, on: false, host: "relay.dojocoding.io" } });
    // US-CONN-08: the user's own client IDs sit in the same settings table, erased with it.
    expect(await hermit.relay.saveClientId("google", "1-x.apps.googleusercontent.com")).toEqual({ ok: true });
    expect(JSON.parse((await hermit.settings.get("signin.clients"))!)).toEqual({ google: "1-x.apps.googleusercontent.com" });
  });
});

describe("HM-SET-02 lists the relays in use", () => {
  test("the user's own relay and Dojo's (when on) are listed even before first use", async () => {
    const r = createRelaySettings({ settings: store({ "relay.own": "https://relay.example.org", "relay.dojo": "1" }), transport: relayServer().transport, dojoRelayUrl: "https://relay.dojocoding.io" });
    const rows = privacyHosts([{ host: "relay.example.org", count: 2, lastAt: 9 }], await r.privacyHosts());
    expect(rows).toContainEqual({ host: "relay.example.org", purpose: "own_relay", count: 2, lastAt: 9 });
    expect(rows).toContainEqual({ host: "relay.dojocoding.io", purpose: "relay", count: 0 });
  });

  test("Dojo's relay is not listed while it is off", async () => {
    const r = createRelaySettings({ settings: store(), transport: relayServer().transport, dojoRelayUrl: "https://relay.dojocoding.io" });
    expect(privacyHosts([], await r.privacyHosts()).map((x) => x.purpose)).not.toContain("relay");
  });
});
