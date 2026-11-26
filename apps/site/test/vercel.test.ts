// The hosting config serves the static export only, with the same strict policy the pages carry, and sends the root
// address to a language.
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { CSP_HEADER } from "../lib/csp.mjs";

const vercel = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
const header = (key: string) => vercel.headers[0].headers.find((h: { key: string }) => h.key === key)?.value;

describe("vercel.json", () => {
  test("static output only: no functions, no rewrites to a server", () => {
    expect(vercel.outputDirectory).toBe("out");
    expect(vercel.functions).toBeUndefined();
    expect(vercel.rewrites).toBeUndefined();
    expect(vercel.crons).toBeUndefined();
  });

  test("every path gets the strict content security policy, the same one the pages carry", () => {
    expect(vercel.headers[0].source).toBe("/(.*)");
    expect(header("Content-Security-Policy")).toBe(CSP_HEADER);
    expect(CSP_HEADER).toMatch(/default-src 'none'/);
    expect(CSP_HEADER).not.toMatch(/unsafe-|https?:|\*/);
    // Scripts run only by exact hash: the two inline theme scripts (lib/theme.mjs), never a file or 'unsafe-inline'.
    const scriptSrc = /script-src ([^;]+)/.exec(CSP_HEADER)?.[1]?.split(" ") ?? [];
    expect(scriptSrc).toHaveLength(2);
    for (const source of scriptSrc) expect(source).toMatch(/^'sha256-[A-Za-z0-9+/]{43}='$/);
    expect(header("Referrer-Policy")).toBe("no-referrer");
  });

  test("the root address goes to Spanish for Spanish browsers, English otherwise", () => {
    const [es, rest] = vercel.redirects;
    const value = new RegExp(`^${es.has[0].value}$`);
    for (const lang of ["es", "es-CR,es;q=0.9", "es-419", "es-ES,en;q=0.5"]) expect(value.test(lang), lang).toBe(true);
    for (const lang of ["en-US,es;q=0.8", "pt-BR", "fr"]) expect(value.test(lang), lang).toBe(false);
    expect(es.destination).toBe("/es/");
    expect(rest).toEqual({ source: "/", destination: "/en/", permanent: false });
  });
});
