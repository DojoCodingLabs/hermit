import assert from "node:assert/strict";
import { test } from "node:test";
import { createSecureCounter } from "./secure-count.ts";

test("FLAG_SECURE stays on while any vault screen holds it, whatever order focus and blur arrive in", () => {
  const calls: boolean[] = [];
  const c = createSecureCounter((on) => calls.push(on));
  const list = c.acquire();
  // list -> item: the item focuses first, then the list blurs.
  const item = c.acquire();
  list();
  assert.equal(c.held(), 1);
  assert.deepEqual(calls, [true]);
  item();
  assert.equal(c.held(), 0);
  assert.deepEqual(calls, [true, false]);
});

test("a release called twice counts once", () => {
  const calls: boolean[] = [];
  const c = createSecureCounter((on) => calls.push(on));
  const a = c.acquire();
  const b = c.acquire();
  a();
  a();
  assert.equal(c.held(), 1);
  b();
  assert.deepEqual(calls, [true, false]);
});
