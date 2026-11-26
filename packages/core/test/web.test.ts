import { describe, expect, test } from "vitest";
import { findUrls, isReadableType, parseWebUrl, resolveLocation, sameDomain } from "../src/web.ts";

describe("parseWebUrl (FR-WEB-01)", () => {
  test("an https URL gives its host and its domain (the host without www)", () => {
    expect(parseWebUrl("https://www.Example.com/refunds?x=1#top")).toEqual({
      url: "https://www.example.com/refunds?x=1#top",
      scheme: "https",
      host: "www.example.com",
      domain: "example.com",
    });
  });

  test("a bare address or an http one is read as https only when asked to upgrade", () => {
    expect(parseWebUrl("example.com/a", { upgrade: true })?.url).toBe("https://example.com/a");
    expect(parseWebUrl("http://example.com/a", { upgrade: true })?.url).toBe("https://example.com/a");
    expect(parseWebUrl("http://example.com/a")?.scheme).toBe("http");
    expect(parseWebUrl("example.com/a")).toBeUndefined();
  });

  test("an address with no path gets a slash", () => {
    expect(parseWebUrl("https://example.com")?.url).toBe("https://example.com/");
  });

  test("credentials, other schemes, local hosts and bare IPs are refused", () => {
    for (const bad of [
      "https://user:pw@example.com/",
      "ftp://example.com/",
      "javascript:alert(1)",
      "file:///etc/passwd",
      "https://localhost/",
      "https://192.168.1.1/",
      "https://[::1]/",
      "https://printer.local/",
      "https://nodot/",
      "https://exa mple.com/",
      "",
    ]) {
      expect(parseWebUrl(bad), bad).toBeUndefined();
    }
  });

  test("a port is kept in the URL but not in the domain", () => {
    expect(parseWebUrl("https://example.com:8443/x")).toMatchObject({ host: "example.com", domain: "example.com", url: "https://example.com:8443/x" });
  });
});

describe("resolveLocation (redirects)", () => {
  const base = "https://example.com/a/b?q=1";
  test("absolute, protocol-relative, root-relative and relative locations", () => {
    expect(resolveLocation(base, "https://other.org/x")).toBe("https://other.org/x");
    expect(resolveLocation(base, "//cdn.example.com/x")).toBe("https://cdn.example.com/x");
    expect(resolveLocation(base, "/c")).toBe("https://example.com/c");
    expect(resolveLocation(base, "c?z=2")).toBe("https://example.com/a/c?z=2");
    expect(resolveLocation(base, "http://example.com/x")).toBe("http://example.com/x");
  });
});

describe("sameDomain", () => {
  test("www and the bare domain are the same site; a subdomain is not", () => {
    expect(sameDomain("https://www.example.com/x", "https://example.com/y")).toBe(true);
    expect(sameDomain("https://shop.example.com/x", "https://example.com/y")).toBe(false);
    expect(sameDomain("https://example.com.evil.io/", "https://example.com/")).toBe(false);
  });
});

describe("isReadableType", () => {
  test("HTML, XHTML and plain text are pages; PDFs, images and JSON are not", () => {
    for (const t of ["text/html", "text/html; charset=ISO-8859-1", "application/xhtml+xml", "text/plain", ""]) expect(isReadableType(t), t).toBe(true);
    for (const t of ["application/pdf", "image/png", "application/json", "application/octet-stream", "video/mp4"]) expect(isReadableType(t), t).toBe(false);
  });
});

describe("findUrls", () => {
  test("finds the links in the user's own words, trailing punctuation removed", () => {
    expect(findUrls("¿qué dice https://example.com/refunds sobre reembolsos?")).toEqual(["https://example.com/refunds"]);
    expect(findUrls("read www.example.com/a, and http://b.org/x).")).toEqual(["www.example.com/a", "http://b.org/x"]);
    expect(findUrls("no links here")).toEqual([]);
  });

  test("strips every trailing mark, and only the ones at the end", () => {
    expect(findUrls("mira https://a.example/x?¡¿!:;,.)]} y")).toEqual(["https://a.example/x"]);
    expect(findUrls("(https://a.example/a.b,c;d:e!f?g¿h¡i)j]k}l).")).toEqual(["https://a.example/a.b,c;d:e!f?g¿h¡i)j]k}l"]);
    expect(findUrls("www.a.example/x... y http://b.example/?q=1&r=2!")).toEqual(["www.a.example/x", "http://b.example/?q=1&r=2"]);
    expect(findUrls(`https://a.example/x${".".repeat(65_536)}`)).toEqual(["https://a.example/x"]);
  });

  test("takes linear time on text others wrote: a 64 KB run of marks before the end finishes in milliseconds", () => {
    // The cage reads pages and messages with this (Auto's links). A backtracking strip took seconds on these inputs.
    for (const marks of [".", ".,;:!?¿¡)]}"]) {
      const text = `https://a.example/${marks.repeat(Math.ceil(65_536 / marks.length))}x`;
      const start = performance.now();
      const found = findUrls(text);
      const ms = performance.now() - start;
      expect(found).toEqual([text]);
      expect(ms, `${JSON.stringify(marks)}: ${ms.toFixed(1)} ms`).toBeLessThan(100);
    }
  });
});
