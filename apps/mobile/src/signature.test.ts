/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { SIGNATURE, partners } from "./signature.ts";

test("signature text is verbatim", () => {
  assert.equal(
    SIGNATURE.line,
    "Hermit, built by Dojo Coding (dojocoding.io). Powered by QVAC (qvac.tether.io) from Tether (tether.io).",
  );
  assert.equal(SIGNATURE.disclaimer, "Hermit is an independent project, not affiliated with or endorsed by Tether.");
});

test("signature links the three partners in order", () => {
  assert.deepEqual(
    partners.map((p) => [p.name, p.url]),
    [["Dojo Coding", "https://dojocoding.io"], ["QVAC", "https://qvac.tether.io/"], ["Tether", "https://tether.io/"]],
  );
});
