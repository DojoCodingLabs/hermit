import assert from "node:assert/strict";
import { test } from "node:test";
import type { Recipe } from "@hermit/core";
import { endKey, liveLine, loginPicker, recordAddress, recordedEvent, recordedSteps, SIGN_IN_MYSELF, startFrom } from "./browser-view.ts";

test("the save screen lists every recorded step with its kind, the element's role and name, and masks secrets", () => {
  const steps = recordedSteps([
    { kind: "click", target: { role: "link", name: "Sign in" }, risk: null },
    { kind: "fill", target: { role: "textbox", name: "Email" }, value: "ana@example.com", secret: false, label: "Email", form: "f0" },
    { kind: "fill", target: { role: "textbox", name: "Password" }, value: "", secret: true, label: "Password", form: "f0" },
    { kind: "click", target: { role: "button", name: "Log in" }, risk: "credential" },
    { kind: "fill", target: { role: "searchbox", name: "Search" }, value: "coffee", secret: false, label: "Search" },
    { kind: "select", target: { role: "combobox", name: "Size" }, value: "Large", label: "Size" },
    { kind: "check", target: { role: "checkbox", name: "Gift wrap" }, on: true },
    { kind: "check", target: { role: "checkbox", name: "Newsletter" }, on: false },
    { kind: "click", target: { role: "button", name: "Place order" }, risk: "spend" },
    { kind: "click", target: { role: "button", name: "Send" }, risk: "remote_write" },
    { kind: "click", target: { role: "treeitem", name: "Odd" }, risk: null },
  ]);
  assert.deepEqual(steps, [
    { key: "HM-WEB-02.save.step.click", roleKey: "HM-WEB-02.role.link", vars: { name: "Sign in" } },
    // The username of a form with a password goes with it: both become the saved login, shown masked.
    { key: "HM-WEB-02.save.step.secret", roleKey: "HM-WEB-02.role.textbox", vars: { name: "Email" } },
    { key: "HM-WEB-02.save.step.secret", roleKey: "HM-WEB-02.role.textbox", vars: { name: "Password" } },
    { key: "HM-WEB-02.save.step.signin", roleKey: "HM-WEB-02.role.button", vars: { name: "Log in" } },
    { key: "HM-WEB-02.save.step.fill", roleKey: "HM-WEB-02.role.searchbox", vars: { name: "Search", value: "coffee" } },
    { key: "HM-WEB-02.save.step.select", roleKey: "HM-WEB-02.role.combobox", vars: { name: "Size", value: "Large" } },
    { key: "HM-WEB-02.save.step.check", roleKey: "HM-WEB-02.role.checkbox", vars: { name: "Gift wrap" } },
    { key: "HM-WEB-02.save.step.uncheck", roleKey: "HM-WEB-02.role.checkbox", vars: { name: "Newsletter" } },
    { key: "HM-WEB-02.save.step.pay", roleKey: "HM-WEB-02.role.button", vars: { name: "Place order" } },
    { key: "HM-WEB-02.save.step.submit", roleKey: "HM-WEB-02.role.button", vars: { name: "Send" } },
    { key: "HM-WEB-02.save.step.click", roleKey: "HM-WEB-02.role.other", vars: { name: "Odd" } },
  ]);
  assert.ok(!JSON.stringify(steps).includes("ana@example.com"));
});

test("HM-WEB-02 opens from the chat's offer, a saved recipe, recording, or the list", () => {
  assert.deepEqual(startFrom({ offer: "o1" }), { kind: "offer", offerId: "o1" });
  assert.deepEqual(startFrom({ recipe: "abc123" }), { kind: "recipe", id: "abc123" });
  assert.deepEqual(startFrom({ recipe: "../x" }), { kind: "list" });
  assert.deepEqual(startFrom({ record: "1" }), { kind: "record" });
  assert.deepEqual(startFrom({}), { kind: "list" });
});

const classify = (e: { name: string }) => (/book|pay/i.test(e.name) ? ("remote_write" as const) : null);

test("a recorded click is classified on the live element the script read", () => {
  const ev = recordedEvent(JSON.stringify({ kind: "click", target: { role: "button", name: "Book", nth: 0 }, live: { role: "button", name: "Book", nth: 0, pageHasForm: true } }), classify);
  assert.deepEqual(ev, { kind: "click", target: { role: "button", name: "Book" }, risk: "remote_write" });
  const nav = recordedEvent(JSON.stringify({ kind: "click", target: { role: "link", name: "Menu", nth: 2 }, live: { role: "link", name: "Menu", nth: 2, pageHasForm: false } }), classify);
  assert.deepEqual(nav, { kind: "click", target: { role: "link", name: "Menu", nth: 2 }, risk: null });
});

test("a secret field's value is dropped even if a page sent one", () => {
  const ev = recordedEvent(JSON.stringify({ kind: "fill", target: { role: "textbox", name: "Password", nth: 0 }, value: "hunter2", secret: true, label: "Password", form: "f0" }), classify);
  assert.deepEqual(ev, { kind: "fill", target: { role: "textbox", name: "Password" }, value: "", secret: true, label: "Password", form: "f0" });
});

test("garbage, unknown kinds and oversized fields are not events", () => {
  for (const bad of ["nope", "null", JSON.stringify({ kind: "eval", target: { role: "button", name: "x", nth: 0 } }), JSON.stringify({ kind: "fill", target: { role: "textbox", name: "x", nth: 0 }, value: "x".repeat(500), secret: false, label: "x" }), JSON.stringify({ kind: "click", target: { role: "button", name: "", nth: 0 } })]) {
    assert.equal(recordedEvent(bad, classify), undefined, bad);
  }
});

test("the live line numbers the step from one, and an end has its copy key", () => {
  assert.deepEqual(liveLine({ kind: "running", step: 0, total: 5, doing: { key: "k", vars: {} } }), { key: "HM-WEB-02.live.step", vars: { n: "1", total: "5" } });
  assert.equal(liveLine({ kind: "ready" }), undefined);
  assert.equal(endKey({ kind: "failed", reason: "left_site", step: 2 }), "HM-WEB-02.end.failed.left_site");
  assert.equal(endKey({ kind: "refused", reason: "blocked" }), "HM-WEB-02.end.refused.blocked");
  assert.equal(endKey({ kind: "done", repaired: 0 }), "HM-WEB-02.end.done");
});

test("a recording starts only at an https address; a bare host gets https", () => {
  assert.equal(recordAddress("shop.example.com"), "https://shop.example.com/");
  assert.equal(recordAddress("https://Shop.example.com/orders"), "https://shop.example.com/orders");
  assert.equal(recordAddress("http://shop.example.com"), undefined);
  assert.equal(recordAddress("javascript:alert(1)"), undefined);
  assert.equal(recordAddress("localhost"), undefined);
  assert.equal(recordAddress(""), undefined);
});

test("the plan's sign-in picker (SL-56): the user's pick among several, else the user signs in; never a guess", () => {
  const login = { steps: [{ op: "login" }] } as unknown as Pick<Recipe, "steps">;
  const ana = { hash: "a".repeat(64), name: "Ana" };
  const leo = { hash: "b".repeat(64), name: "Leo" };
  assert.deepEqual(loginPicker({ steps: [] }, { logins: [ana, leo] }, "Myself"), { kind: "none" });
  assert.deepEqual(loginPicker(login, { logins: [] }, "Myself"), { kind: "yourself" });
  assert.deepEqual(loginPicker(login, undefined, "Myself"), { kind: "yourself" });
  assert.deepEqual(loginPicker(login, { logins: [ana] }, "Myself"), { kind: "one", name: "Ana" });
  const choices = [{ value: ana.hash, label: "Ana" }, { value: leo.hash, label: "Leo" }, { value: SIGN_IN_MYSELF, label: "Myself" }];
  assert.deepEqual(loginPicker(login, { logins: [ana, leo] }, "Myself"), { kind: "pick", choices, selected: SIGN_IN_MYSELF });
  assert.deepEqual(loginPicker(login, { logins: [ana, leo], chosen: leo.hash }, "Myself"), { kind: "pick", choices, selected: leo.hash });
  assert.equal(endKey({ kind: "failed", reason: "signin_failed", step: 3 }), "HM-WEB-02.end.failed.signin_failed");
});
