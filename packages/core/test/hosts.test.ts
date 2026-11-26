import { beforeEach, describe, expect, test } from "vitest";
import { nodeSql } from "@hermit/sql-node";
import type { SqlPort } from "../src/ports.ts";
import { migrate } from "../src/schema.ts";
import { createHostCounter, hostOf } from "../src/hosts.ts";

let sql: SqlPort;
beforeEach(async () => {
  sql = nodeSql();
  await migrate(sql);
});

describe("hostOf (FR-PRIV-02)", () => {
  test("keeps only the host, lowercased, without user info, port, path or query", () => {
    expect(hostOf("https://HuggingFace.co/qvac/model.gguf?download=1")).toBe("huggingface.co");
    expect(hostOf("https://user:pw@relay.example.org:8443/hermit")).toBe("relay.example.org");
    expect(hostOf("http://example.com.")).toBe("example.com");
  });
  test("refuses URLs that parsers read differently, so the counted host is the contacted host", () => {
    expect(hostOf("https://evil.example\\@good.example/")).toBeUndefined();
    expect(hostOf("https://a@b@c.example/")).toBeUndefined();
    expect(hostOf(" https://good.example/")).toBeUndefined();
    expect(hostOf("https://good.example\t.evil/")).toBeUndefined();
    expect(hostOf("https://good.example%2f@evil.example/")).toBe("evil.example");
    expect(hostOf("https://[2001:db8::1]:443/x")).toBe("[2001:db8::1]");
  });

  test("anything that is not an http or https URL has no host to count", () => {
    expect(hostOf("file:///data/model.gguf")).toBeUndefined();
    expect(hostOf("not a url")).toBeUndefined();
    expect(hostOf("https://")).toBeUndefined();
  });
});

describe("host counter (ENT-HostCounter)", () => {
  test("counts each host and remembers when it was last contacted", async () => {
    let now = 100;
    const hosts = createHostCounter(sql, () => now);
    await hosts.record("https://huggingface.co/a");
    now = 200;
    await hosts.record("https://huggingface.co/b");
    await hosts.record("https://example.org/");
    expect(await hosts.list()).toEqual([
      { host: "huggingface.co", count: 2, lastAt: 200 },
      { host: "example.org", count: 1, lastAt: 200 },
    ]);
  });

  test("a URL with no host records nothing and does not throw", async () => {
    const hosts = createHostCounter(sql, () => 1);
    expect(await hosts.record("file:///x")).toBeUndefined();
    expect(await hosts.list()).toEqual([]);
  });

  test("stores the host only, never the path or query", async () => {
    await createHostCounter(sql, () => 1).record("https://example.org/search?q=secret");
    const raw = JSON.stringify(await sql.query("SELECT * FROM host_counters"));
    expect(raw).not.toContain("secret");
    expect(raw).not.toContain("search");
  });
});
