import assert from "node:assert/strict";
import { test } from "node:test";
import { PAGE_LIB, pageCall, parseResult, RECORDER_SCRIPT } from "./browser-script.ts";
import { asLive, createBrowserPort, type BrowserHandle } from "./browser-port.ts";

test("every page call and the recorder are valid JavaScript", () => {
  for (const script of [
    pageCall("find", { role: "button", name: "Pay" }),
    pageCall("act", "fill", { role: "textbox", name: "Email" }, "a@b.c"),
    pageCall("snapshot"),
    pageCall("candidates", "link"),
    pageCall("fillLogin", "u", "p", "https://shop.example.com"),
    pageCall("sig"),
    pageCall("signInFacts"),
    RECORDER_SCRIPT,
  ]) {
    assert.doesNotThrow(() => new Function(`return ${script};`), script.slice(-80));
  }
});

test("a site's name goes in as data: it can't close the literal or run code", () => {
  const evil = { role: "button", name: '"}); window.pwned = 1; ({"' + " " + "</script>" };
  const script = pageCall("find", evil);
  assert.ok(!script.includes(" "));
  // Parsing the call yields exactly the object we passed, so nothing in the name is code.
  const m = /var e = find\((.*)\); return e/.exec(script);
  assert.ok(m);
  assert.deepEqual(JSON.parse(m[1]!), evil);
});

test("the snapshot is cut to its budget keeping the first 80% and the last 20%", () => {
  const cut = new Function(`${PAGE_LIB}; return cut;`)() as (lines: string[], budget: number) => string;
  const lines = Array.from({ length: 200 }, (_, i) => `[${i}] button "Item ${i}"`);
  const out = cut(lines, 3000);
  assert.ok(out.length <= 3000, String(out.length));
  assert.ok(out.startsWith('[0] button "Item 0"'));
  assert.ok(out.endsWith('[199] button "Item 199"'));
  assert.match(out, /\[\.\.\. \d+ lines cut \.\.\.\]/);
  assert.equal(cut(["a", "b"], 3000), "a\nb");
});

test("evaluate results are read twice as JSON; a broken script or a page's garbage is nothing", () => {
  assert.deepEqual(parseResult(JSON.stringify(JSON.stringify({ ok: true }))), { ok: true });
  assert.equal(parseResult("null"), undefined);
  assert.equal(parseResult(JSON.stringify(JSON.stringify({ __error: "x" }))), undefined);
  assert.equal(parseResult("{not json"), undefined);
  assert.equal(parseResult(42), undefined);
});

test("asLive keeps only an element's known fields and never a secret field's value", () => {
  assert.equal(asLive({ role: "button" }), undefined);
  assert.deepEqual(
    asLive({ role: "button", name: "Book", nth: 0, pageHasForm: true, onclick: "x", form: { id: "f", action: "https://a.example/x", fields: [{ label: "Card", value: "4111", secret: true }, { label: "People", value: "2", secret: false }] } }),
    { role: "button", name: "Book", nth: 0, pageHasForm: true, form: { id: "f", action: "https://a.example/x", fields: [{ label: "Card", value: "", secret: true }, { label: "People", value: "2", secret: false }] } },
  );
});

/** A fake WebView: answers each script by what it calls, with a clock that moves on every sleep. */
function fake(answer: (script: string) => unknown) {
  let clock = 0;
  const loaded: string[] = [];
  let port!: ReturnType<typeof createBrowserPort>;
  const handle: BrowserHandle = {
    async load(url) {
      loaded.push(url);
      if (!url.startsWith("https://shop.example.com/")) return false;
      setTimeout(() => port.onEvent({ type: "load", url }), 0);
      return true;
    },
    async evaluate(script) {
      return JSON.stringify(JSON.stringify(answer(script)));
    },
    async currentUrl() {
      return "https://shop.example.com/cart";
    },
  };
  port = createBrowserPort(handle, { sleep: async (ms) => { clock += ms; await new Promise((r) => setTimeout(r, 0)); }, now: () => clock });
  return { port, loaded };
}

test("open waits for the load; a load the native side refuses is blocked", async () => {
  const { port } = fake(() => null);
  assert.deepEqual(await port.open("https://shop.example.com/orders"), { ok: true, changed: true });
  assert.deepEqual(await port.open("https://evil.example/"), { ok: false, reason: "blocked" });
});

test("find polls until the element shows up, then gives up at its timeout", async () => {
  let tries = 0;
  const { port } = fake((s) => (s.includes("var e = find(") ? (++tries >= 3 ? { role: "link", name: "Buy again", nth: 0, pageHasForm: false } : null) : null));
  assert.deepEqual(await port.find({ role: "link", name: "Buy again" }, 5000), { role: "link", name: "Buy again", nth: 0, pageHasForm: false });
  const none = fake(() => null);
  assert.equal(await none.port.find({ role: "link", name: "Gone" }, 1000), undefined);
});

test("a click that changes nothing says so; one that changes the page says changed", async () => {
  let sig = "a";
  const still = fake((s) => (s.includes("return sig();") ? sig : s.includes("return act(") ? { ok: true, changed: true } : null));
  assert.deepEqual(await still.port.click({ role: "link", name: "Nothing" }), { ok: true, changed: false });
  const moving = fake((s) => {
    if (s.includes("return act(")) {
      sig = "b";
      return { ok: true, changed: true };
    }
    return s.includes("return sig();") ? sig : null;
  });
  sig = "a";
  assert.deepEqual(await moving.port.click({ role: "button", name: "Next" }), { ok: true, changed: true });
});

test("asLive keeps the form's effective target, so the runner can refuse a new window", () => {
  const live = asLive({ role: "button", name: "Book", nth: 0, pageHasForm: true, form: { id: "f", action: "https://a.example/x", method: "post", target: "_blank", fields: [] } });
  assert.equal(live?.form?.target, "_blank");
});

test("a form whose submission can't be read is no element at all: its checks can never be skipped", () => {
  const base = { role: "button", name: "Book", nth: 0, pageHasForm: true };
  for (const form of [
    { id: "f", action: `https://evil.example/${"x".repeat(2100)}`, fields: [] },
    { id: "f", action: 42, fields: [] },
    { id: "f", action: "https://a.example/x", target: "x".repeat(101), fields: [] },
    { id: "f", action: "https://a.example/x", method: { evil: true }, fields: [] },
    { id: "x".repeat(201), action: "https://a.example/x", fields: [] },
    { id: "f", action: "https://a.example/x", fields: "nope" },
  ]) {
    assert.equal(asLive({ ...base, form }), undefined, JSON.stringify(form).slice(0, 80));
  }
});

test("the login fill carries the login's origin into the page call, and a page on another origin is off_origin", async () => {
  const scripts: string[] = [];
  const { port } = fake((s) => {
    scripts.push(s);
    return s.includes("return fillLogin(") ? { ok: false, reason: "off_origin" } : null;
  });
  assert.deepEqual(await port.fillLogin({ username: "u", password: "p", origin: "https://shop.example.com" }), { ok: false, reason: "off_origin" });
  assert.ok(scripts.some((s) => s.includes('return fillLogin("u", "p", "https://shop.example.com");')));
});

test("the sign-in facts come back shape-checked; a page that breaks the script or sends garbage is no report", async () => {
  const good = { password: true, fields: [{ autocomplete: "", name: "email", label: "Email", inputmode: "" }], frames: [], widget: false };
  assert.deepEqual(await fake((s) => (s.includes("return signInFacts();") ? good : null)).port.signInFacts(), good);
  for (const bad of [null, "signed in", { password: "no", fields: [], frames: [], widget: false }, { __error: "boom" }]) {
    assert.equal(await fake(() => bad).port.signInFacts(), undefined, JSON.stringify(bad));
  }
});

test("SL-56b: the code fill carries the origin, the field's index and what the report said about it into one page call", async () => {
  const scripts: string[] = [];
  const { port } = fake((s) => {
    scripts.push(s);
    return s.includes("return fillCode(") ? { ok: true, changed: true } : "same";
  });
  const expect = { autocomplete: "one-time-code", name: "otp", label: "Code" };
  assert.deepEqual(await port.fillCode({ code: "482913", origin: "https://shop.example.com", field: 1, expect }), { ok: true, changed: false });
  assert.ok(scripts.some((s) => s.includes('return fillCode("482913", "https://shop.example.com", 1, {"autocomplete":"one-time-code","name":"otp","label":"Code"});')));
  const off = fake((s) => (s.includes("return fillCode(") ? { ok: false, reason: "off_origin" } : null));
  assert.deepEqual(await off.port.fillCode({ code: "482913", origin: "https://shop.example.com", field: 1, expect }), { ok: false, reason: "off_origin" });
});

test("SL-56b: the code fill page call is valid JavaScript", () => {
  assert.doesNotThrow(() => new Function(`return ${pageCall("fillCode", "482913", "https://shop.example.com", 0, { autocomplete: "", name: "", label: "" })};`));
});
