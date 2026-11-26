// The site's public settings live in lib/site-config.mjs, once: the repository URL, the site's address and the
// partners switch. These tests fail when a page or component hard-codes them instead.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { BRAND_FILES, PARTNER_FILES } from "../lib/brand.mjs";
import { REPO_URL, SHOW_PARTNERS, SITE_URL, repoFile, repoTree } from "../lib/site-config.mjs";

const site = fileURLToPath(new URL("..", import.meta.url));
const sources = (dir: string): string[] =>
  readdirSync(join(site, dir)).flatMap((name) => {
    const path = join(dir, name);
    return statSync(join(site, path)).isDirectory() ? sources(path) : /\.(tsx?|mjs)$/.test(name) ? [path] : [];
  });
const code = ["app", "components", "lib"].flatMap(sources).filter((f) => f !== join("lib", "site-config.mjs"));
/** A source file without its comments: comments may name the address, code must take it from the config. */
const read = (file: string) => readFileSync(join(site, file), "utf8").replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, "");

describe("lib/site-config.mjs", () => {
  test("the repository URL is defined once", () => {
    expect(REPO_URL).toMatch(/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/);
    for (const file of code) expect(read(file), file).not.toMatch(/github\.com\//);
  });

  test("the site's address is defined once, with no trailing slash", () => {
    expect(SITE_URL).toBe("https://joinhermit.com");
    for (const file of code) expect(read(file), file).not.toMatch(/joinhermit\.com|hermit\.dojocoding\.io/);
  });

  test("file links follow the repository's default branch", () => {
    expect(repoFile("LICENSE")).toBe(`${REPO_URL}/blob/HEAD/LICENSE`);
    expect(repoTree("packages/eval")).toBe(`${REPO_URL}/tree/HEAD/packages/eval`);
    // The device lab links to the devices guide through the same helper (components/device-lab.tsx).
    expect(readFileSync(join(site, "components", "device-lab.tsx"), "utf8")).toMatch(/DEVICES_GUIDE = repoFile\("docs\/devices\.md"\)/);
  });

  test("the partner logos are served exactly when the partners line is on", () => {
    expect(typeof SHOW_PARTNERS).toBe("boolean");
    for (const file of PARTNER_FILES) expect(BRAND_FILES.includes(file), file).toBe(SHOW_PARTNERS);
  });
});
