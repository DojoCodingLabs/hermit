#!/usr/bin/env node
// After `next build`: the pages are server-rendered HTML, so Next's client runtime (hydration scripts and the
// router's payload files) is dead weight and would need 'unsafe-inline' in the content security policy. This removes
// every script tag, script preload and JavaScript file from out/, except the two inline theme scripts the policy
// allows by their exact hash (lib/theme.mjs, lib/csp.mjs).
import { readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripScripts } from "../lib/site-check.mjs";

const out = fileURLToPath(new URL("../out", import.meta.url));

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
}

let pages = 0;
let removed = 0;
for (const file of walk(out)) {
  if (file.endsWith(".html")) {
    writeFileSync(file, stripScripts(readFileSync(file, "utf8")));
    pages++;
  } else if (file.endsWith(".js") || /(^|\/)(index|__next\..*)\.txt$/.test(file)) {
    rmSync(file);
    removed++;
  }
}
console.log(`finalize: stripped Next's scripts from ${pages} pages (the hashed theme scripts stay), removed ${removed} script and payload files`);
