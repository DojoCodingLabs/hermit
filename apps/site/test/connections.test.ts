// The privacy policy lists every outbound connection the app can make. These tests read the app's own sources,
// so adding a host to the app without adding it to the policy (lib/connections.ts) fails here.
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { NAMED_HOSTS } from "../lib/connections";
import en from "../locales/en.json";
import es from "../locales/es-419.json";

const repo = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, repo), "utf8").replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, "");
const hostsIn = (text: string, re: RegExp) => [...text.matchAll(re)].map((m) => m[1]!);

describe("every host the app's sources can reach is named on the policy", () => {
  test("the pinned model files", () => {
    const hosts = hostsIn(read("packages/model/src/profile.ts"), /url:\s*[`"]https:\/\/([^/`"]+)/g);
    expect(hosts.length).toBeGreaterThan(0);
    for (const h of hosts) expect(NAMED_HOSTS, h).toContain(h);
  });

  test("the default search provider", () => {
    const hosts = hostsIn(read("packages/core/src/search.ts"), /base:\s*"https:\/\/([^/"]+)/g);
    expect(hosts.length).toBeGreaterThan(0);
    for (const h of hosts) expect(NAMED_HOSTS, h).toContain(h);
  });

  test("the shipped connectors' hosts", () => {
    const catalog = read("packages/connectors/src/catalog.ts");
    const hosts = [...catalog.matchAll(/hosts:\s*\[([^\]]*)\]/g)].flatMap((m) => hostsIn(m[1]!, /"([^"]+)"/g));
    expect(hosts.length).toBeGreaterThan(0);
    for (const h of hosts) expect(NAMED_HOSTS, h).toContain(h);
  });

  test("the sign-in endpoints", () => {
    const hosts = hostsIn(read("packages/connectors/src/oauth-providers.ts"), /(?:authorizationUrl|tokenUrl|revocationUrl):\s*"https:\/\/([^/"]+)/g);
    expect(hosts.length).toBeGreaterThan(0);
    for (const h of hosts) expect(NAMED_HOSTS, h).toContain(h);
  });

  test("the wallet's test network", () => {
    const hosts = hostsIn(read("packages/core/src/wallet.ts"), /rpcOrigin:\s*"https:\/\/([^/"]+)/g);
    expect(hosts.length).toBeGreaterThan(0);
    for (const h of hosts) expect(NAMED_HOSTS, h).toContain(h);
  });

  test("the mail APIs", () => {
    const sources = ["packages/mail/src/gmail.ts", "packages/mail/src/graph.ts", "packages/mail/src/connect.ts"].map(read).join("\n");
    const hosts = hostsIn(sources, /=\s*"https:\/\/([^/"]+)/g);
    expect(hosts.length).toBeGreaterThan(0);
    for (const h of hosts) expect(NAMED_HOSTS, h).toContain(h);
  });
});

describe("the permissions on the policy match the app's manifest", () => {
  const app = JSON.parse(readFileSync(new URL("apps/mobile/app.json", repo), "utf8"));
  const granted: string[] = app.expo.android.permissions;
  const blocked: string[] = app.expo.android.blockedPermissions;

  test("what the policy says Hermit never asks for is blocked in the build", () => {
    expect(en["HM-SITE-02.permNever"]).toBe("Hermit does not ask for SMS, location, storage or microphone access.");
    for (const p of ["READ_SMS", "ACCESS_FINE_LOCATION", "ACCESS_COARSE_LOCATION", "READ_EXTERNAL_STORAGE", "WRITE_EXTERNAL_STORAGE", "RECORD_AUDIO"]) {
      expect(blocked, p).toContain(`android.permission.${p}`);
      expect(granted, p).not.toContain(`android.permission.${p}`);
    }
  });

  test("every permission the build requests is explained on the policy", () => {
    const explained = [
      "READ_CALENDAR", "WRITE_CALENDAR", "READ_CONTACTS", "POST_NOTIFICATIONS", "SCHEDULE_EXACT_ALARM", "SET_ALARM",
      "RECEIVE_BOOT_COMPLETED", "FOREGROUND_SERVICE", "FOREGROUND_SERVICE_DATA_SYNC", "WAKE_LOCK", "USE_BIOMETRIC", "INTERNET",
    ];
    for (const p of granted) expect(explained, p).toContain(p.split(".").pop());
  });
});

describe("the wallet section matches the app's wallet", () => {
  test("it describes the testnet wallet, kept on the phone, and never says there is none", () => {
    const wallet = read("packages/core/src/wallet.ts");
    expect(wallet).toMatch(/testnet:\s*true/);
    expect(en["HM-SITE-02.walletBody"]).toMatch(/testnet wallet/);
    expect(en["HM-SITE-02.walletBody"]).toMatch(/no real value/);
    expect(en["HM-SITE-02.walletBody"]).toMatch(/Nothing about the wallet is sent to Dojo Coding/);
    expect(en["HM-SITE-02.walletBody"]).not.toMatch(/no wallet/i);
    expect(es["HM-SITE-02.walletBody"]).toMatch(/billetera de prueba/);
    expect(es["HM-SITE-02.walletBody"]).not.toMatch(/no tiene billetera/i);
  });
});
