import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import {
  LOGIN_MAX_OFFERED, loginsFor, matchAutofillOrigin, normalizeOrigin, requestOrigin, TRUSTED_BROWSERS, type AutofillRequest, type BrowserAllowlist, type LoginIndexEntry,
} from "../src/autofill-origin.ts";

interface Vector {
  name: string;
  request: AutofillRequest;
  stored: string[];
  expect: { match: boolean; origin?: string; reason?: string };
}

interface LoginVector {
  name: string;
  request: AutofillRequest;
  index: LoginIndexEntry[];
  expect: { origin?: string; reason?: string; refs: string[] };
}

const vectors = JSON.parse(readFileSync(new URL("./autofill-origin-vectors.json", import.meta.url), "utf8")) as {
  productionBrowsers: BrowserAllowlist;
  browsers: BrowserAllowlist;
  cases: Vector[];
  logins: LoginVector[];
};

describe("loginsFor (SL-36, FR-VAULT-04): which vault logins a request is offered, the shared vectors", () => {
  test("the vectors cover the login cases", () => expect(vectors.logins.length).toBeGreaterThanOrEqual(15));
  for (const v of vectors.logins) {
    test(v.name, () => {
      expect(loginsFor(v.request, v.index, vectors.browsers)).toEqual(v.expect);
    });
  }
  test(`the cap is ${LOGIN_MAX_OFFERED}, the same number the Kotlin service offers`, () => expect(LOGIN_MAX_OFFERED).toBe(5));
});

const DIGEST = "bankTestCertDigest_000000000000000000000000";

describe("matchAutofillOrigin (SL-20, FR-VAULT-04): the shared vectors", () => {
  for (const v of vectors.cases) {
    test(v.name, () => {
      expect(matchAutofillOrigin(v.request, v.stored, vectors.browsers)).toEqual(v.expect);
    });
  }
});

describe("TRUSTED_BROWSERS", () => {
  test("is exactly the shipped allowlist the Kotlin service also checks (Google's privileged apps list, release builds)", () => {
    expect(TRUSTED_BROWSERS).toEqual(vectors.productionBrowsers);
  });
});

describe("normalizeOrigin", () => {
  test("web origins: lowercased, default port dropped, one trailing slash allowed", () => {
    expect(normalizeOrigin("HTTPS://Example.COM:443/")).toBe("https://example.com");
    expect(normalizeOrigin("http://example.com:80")).toBe("http://example.com");
    expect(normalizeOrigin("https://example.com:8443")).toBe("https://example.com:8443");
    expect(normalizeOrigin("https://10.0.0.1")).toBe("https://10.0.0.1");
  });

  test("app origins are the signing certificate digest and the package, both kept exactly", () => {
    expect(normalizeOrigin(`android://${DIGEST}@com.Example.App`)).toBe(`android://${DIGEST}@com.Example.App`);
    expect(normalizeOrigin("android://com.example.app")).toBeUndefined();
    expect(normalizeOrigin(`android://${DIGEST}@com`)).toBeUndefined();
    expect(normalizeOrigin(`android://${DIGEST}=@com.example.app`)).toBeUndefined();
  });

  test("anything that is not exactly an origin is undefined", () => {
    for (const bad of ["", "example.com", "https://", "https://example.com/path", "https://example.com?q", "https://a@example.com", "https://example.com:65536", "https://example.com:08443", "https://-bad.com", "ftp://example.com", "https://exa mple.com"]) {
      expect(normalizeOrigin(bad), bad).toBeUndefined();
    }
  });
});

describe("requestOrigin", () => {
  test("is what the debug screen shows and what a trusted origin is stored as", () => {
    const chrome = [...vectors.browsers["com.android.chrome"]!];
    expect(requestOrigin({ packageName: "com.android.chrome", certDigests: chrome, web: [{ domain: "Example.com", scheme: "https" }] }, vectors.browsers)).toEqual({ ok: true, origin: "https://example.com" });
    expect(requestOrigin({ packageName: "com.example.app", certDigests: [DIGEST], web: [] }, vectors.browsers)).toEqual({ ok: true, origin: `android://${DIGEST}@com.example.app` });
  });
});
