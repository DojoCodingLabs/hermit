#!/usr/bin/env node
// Copies the brand files the site uses from docs/brand into public/brand, unchanged (logo lock). public/brand is
// emptied first, so a file the site stops using (say, the partner logos with SHOW_PARTNERS off) stops being served.
import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BRAND_FILES } from "../lib/brand.mjs";

const site = fileURLToPath(new URL("..", import.meta.url));
const source = join(site, "..", "..", "docs", "brand");
const target = join(site, "public", "brand");

rmSync(target, { recursive: true, force: true });
for (const file of BRAND_FILES) {
  const to = join(target, file);
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(join(source, file), to);
}
console.log(`brand: copied ${BRAND_FILES.length} files from docs/brand`);
