/// <reference types="node" />
// Review 2026-11-25: a double tap on Seguir started two continuations into one bubble, and Stop reached only the second.
// The chat's send and Seguir take one slot before anything else, so the second tap finds it held.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { endTurn, startTurn, type TurnSlot } from "./one-turn.ts";

test("a second start while a turn runs is refused, and Stop reaches the turn that runs", () => {
  const slot: TurnSlot = { current: undefined };
  const first = startTurn(slot);
  assert.ok(first);
  assert.equal(startTurn(slot), undefined);
  // Stopping doesn't free the slot: the turn still has to finish.
  first.abort();
  assert.equal(slot.current, first);
  assert.equal(startTurn(slot), undefined);
  endTurn(slot, first);
  const next = startTurn(slot);
  assert.ok(next && next !== first);
  // A turn that ends late never frees a newer one's slot.
  endTurn(slot, first);
  assert.equal(slot.current, next);
});

test("the chat's send and Seguir both take the slot before they change the screen, and free it when done", () => {
  const screen = readFileSync(new URL("./app/index.tsx", import.meta.url), "utf8");
  for (const name of ["send", "goOn"]) {
    const at = screen.indexOf(`const ${name} = useCallback(async`);
    assert.ok(at > 0, `${name} is on the chat screen`);
    const body = screen.slice(at, screen.indexOf("}, [", at));
    const taken = body.indexOf("startTurn(turn)");
    assert.ok(taken > 0, `${name} takes the slot`);
    assert.ok(taken < body.indexOf("dispatch("), `${name} takes it before it changes the screen`);
    assert.ok(body.indexOf("endTurn(turn, controller)") > taken, `${name} frees it`);
  }
});
