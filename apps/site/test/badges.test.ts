// The store badges are Apple's and Google's own files, unmodified: each one in public/badges matches the SHA-256
// recorded when it was downloaded (lib/badges.mjs), and each language shows its own pair, App Store first.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { BADGES } from "../lib/badges.mjs";

const dir = new URL("../public/badges/", import.meta.url);
const sha256 = (file: string) => createHash("sha256").update(readFileSync(new URL(file, dir))).digest("hex");

describe("store badges", () => {
  test("every served badge is the downloaded file, byte for byte", () => {
    const listed = [...BADGES.en, ...BADGES.es];
    for (const badge of listed) expect(sha256(badge.file), badge.file).toBe(badge.sha256);
    expect(readdirSync(dir).sort()).toEqual(listed.map((b) => b.file).sort());
  });

  test("each language has its own pair, the App Store badge first", () => {
    for (const lang of ["en", "es"] as const) {
      expect(BADGES[lang].map((b) => b.store), lang).toEqual(["Apple", "Google"]);
    }
    expect(BADGES.en.map((b) => b.file)).toEqual(["app-store-en-us.svg", "google-play-en.png"]);
    expect(BADGES.es.map((b) => b.file)).toEqual(["app-store-es-mx.svg", "google-play-es-419.png"]);
  });

  test("Apple's SVGs carry no script and load nothing", () => {
    for (const file of ["app-store-en-us.svg", "app-store-es-mx.svg"]) {
      const svg = readFileSync(new URL(file, dir), "utf8");
      expect(svg, file).not.toMatch(/<script|<foreignObject|\son\w+\s*=|href\s*=\s*["']\s*(https?:|\/\/|data:)/i);
    }
  });
});
