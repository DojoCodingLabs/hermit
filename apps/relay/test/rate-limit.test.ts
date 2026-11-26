import { describe, expect, it } from "vitest";
import { clientPrefix, RateLimiter } from "../src/rate-limit.ts";

describe("rate limit keys", () => {
  it("IPv4 as is; IPv6 by its /64; IPv4-mapped IPv6 as IPv4", () => {
    expect(clientPrefix("203.0.113.7")).toEqual({ key: "203.0.113.7", wide: "v4:203.0.113" });
    expect(clientPrefix("2001:db8:1:2:aaaa::1")).toEqual({ key: "v6:2001:db8:1:2", wide: "v6:2001:db8:1" });
    expect(clientPrefix("2001:db8:1:2:bbbb:cccc:dddd:eeee").key).toBe("v6:2001:db8:1:2");
    expect(clientPrefix("2001:db8::1").key).toBe("v6:2001:db8:0:0");
    expect(clientPrefix("::ffff:198.51.100.4")).toEqual({ key: "198.51.100.4", wide: "v4:198.51.100" });
    expect(clientPrefix("::1").key).toBe("v6:0:0:0:0");
    expect(clientPrefix("not an address")).toEqual({ key: "other:not an address", wide: "other" });
  });
});

describe("the rate limiter", () => {
  it("one IPv6 client can't dodge the limit by rotating addresses inside its /64", () => {
    const r = new RateLimiter(3, () => 0);
    for (let i = 0; i < 3; i++) expect(r.allow(`2001:db8:1:2::${i + 1}`)).toBe(true);
    expect(r.allow("2001:db8:1:2::99")).toBe(false);
    expect(r.allow("2001:db8:1:3::1")).toBe(true);
  });

  it("a wider prefix (/48 for IPv6, /24 for IPv4) has its own, larger limit", () => {
    const r = new RateLimiter(2, () => 0, { prefixFactor: 4 });
    let allowed = 0;
    for (let i = 0; i < 20; i++) if (r.allow(`198.51.100.${i}`)) allowed++;
    expect(allowed).toBe(8);
    expect(r.allow("198.51.101.1")).toBe(true);
  });

  it("filling the table with many addresses does not lock out a new client: the oldest entries go first", () => {
    const r = new RateLimiter(5, () => 0, { maxClients: 100 });
    for (let i = 0; i < 1000; i++) r.allow(`2001:db8:${(i % 60000).toString(16)}:${i.toString(16)}::1`);
    expect(r.allow("203.0.113.50")).toBe(true);
    expect(r.size()).toBeLessThanOrEqual(100);
  });

  it("an active client stays tracked while idle ones are evicted", () => {
    const r = new RateLimiter(3, () => 0, { maxClients: 10 });
    expect(r.allow("203.0.113.1")).toBe(true);
    for (let i = 0; i < 50; i++) {
      r.allow(`2001:db8:${i.toString(16)}::1`);
      r.allow("203.0.113.1");
    }
    expect(r.allow("203.0.113.1")).toBe(false);
  });

  it("the window turns every minute", () => {
    let now = 0;
    const r = new RateLimiter(1, () => now);
    expect(r.allow("203.0.113.1")).toBe(true);
    expect(r.allow("203.0.113.1")).toBe(false);
    now = 60_000;
    expect(r.allow("203.0.113.1")).toBe(true);
  });
});
