// SL-53 security review: the page script run against a small fake DOM. A submit button's own formaction, formmethod
// and formtarget (and the form's or the page's base target) are what the runner sees; the login fill checks the
// page's origin in the same call; the recorder posts only through the web message channel, with its native token.
import assert from "node:assert/strict";
import { test } from "node:test";
import { pageCall, RECORDER_SCRIPT, RECORDER_TOKEN_PLACEHOLDER } from "./browser-script.ts";
import { asSignInFacts, checkSignIn } from "@hermit/core/web-login";
import { asLive } from "./browser-port.ts";

type Attrs = Record<string, string>;

class FakeEvent {
  type: string;
  constructor(type: string) {
    this.type = type;
  }
}

class FakeEl {
  form: FakeForm | null = null;
  value = "";
  checked = false;
  disabled = false;
  innerText: string;
  textContent: string;
  index = 0;
  formAction = "";
  formMethod = "";
  formTarget = "";
  ownerDocument: unknown;
  tagName: string;
  attrs: Attrs;
  constructor(tagName: string, attrs: Attrs = {}, text = "") {
    this.tagName = tagName;
    this.attrs = attrs;
    this.innerText = text;
    this.textContent = text;
  }
  getAttribute(n: string) {
    return n in this.attrs ? this.attrs[n]! : null;
  }
  hasAttribute(n: string) {
    return n in this.attrs;
  }
  /** The DOM's normalised type: a button with a missing or unknown type submits, as browsers do. */
  get type() {
    const t = (this.attrs.type ?? "").toLowerCase();
    if (this.tagName === "BUTTON") return t === "button" || t === "reset" ? t : "submit";
    return t || "text";
  }
  getBoundingClientRect() {
    return { width: 10, height: 10 };
  }
  closest(sel: string) {
    return sel === "form" ? this.form : null;
  }
  compareDocumentPosition(other: FakeEl) {
    return other.index > this.index ? 4 : 2;
  }
  dispatchEvent() {
    return true;
  }
  scrollIntoView() {}
  focus() {}
  click() {}
}

class FakeForm {
  elements: FakeEl[] = [];
  id = "";
  attrs: Attrs = {};
  action: string;
  method: string;
  constructor(action: string, method = "get", target?: string) {
    this.action = action;
    this.method = method;
    if (target !== undefined) this.attrs.target = target;
  }
  getAttribute(n: string) {
    return n in this.attrs ? this.attrs[n]! : null;
  }
  hasAttribute(n: string) {
    return n in this.attrs;
  }
  querySelectorAll(sel: string) {
    return sel === "input" ? this.elements.filter((e) => e.tagName === "INPUT") : [];
  }
}

/** A page on `origin` with these elements (in page order), its forms and an optional `<base target>`. */
function page(origin: string, els: FakeEl[], forms: FakeForm[], base?: string) {
  const doc = {
    forms,
    title: "Shop",
    body: { innerText: "" },
    querySelectorAll(sel: string) {
      if (sel === "input[type=password]") return els.filter((e) => e.tagName === "INPUT" && e.getAttribute("type") === "password");
      if (sel === "base[target]") return base === undefined ? [] : [{ getAttribute: () => base }];
      if (sel === "input") return els.filter((e) => e.tagName === "INPUT");
      if (sel === "iframe") return els.filter((e) => e.tagName === "IFRAME");
      // The captcha widgets' selector: a known class or a data-sitekey.
      if (sel.startsWith(".g-recaptcha")) return els.filter((e) => /\b(g-recaptcha|h-captcha|cf-turnstile)\b/.test(e.attrs.class ?? "") || "data-sitekey" in e.attrs);
      return els;
    },
    querySelector(sel: string) {
      return this.querySelectorAll(sel)[0] ?? null;
    },
    getElementById() {
      return null;
    },
    getElementsByTagName() {
      return els;
    },
  };
  els.forEach((e, i) => {
    e.index = i;
    e.ownerDocument = doc;
  });
  const win: Record<string, unknown> = { getComputedStyle: () => ({ visibility: "visible", display: "block" }) };
  win.top = win;
  win.self = win;
  const location = { origin, href: `${origin}/cart`, pathname: "/cart" };
  class HTMLInputElement {}
  class HTMLTextAreaElement {}
  const run = (script: string): unknown => {
    const out = new Function("window", "document", "location", "HTMLInputElement", "HTMLTextAreaElement", "Event", `return ${script};`)(win, doc, location, HTMLInputElement, HTMLTextAreaElement, FakeEvent) as string;
    return JSON.parse(out);
  };
  return { run, win, doc };
}

const SHOP = "https://shop.example.com";

/** A cart form posting to the shop, with a quantity field and the given button. */
function cart(button: FakeEl, form = new FakeForm(`${SHOP}/order`, "post")) {
  const qty = new FakeEl("INPUT", { type: "text", "aria-label": "Quantity" });
  qty.value = "2";
  qty.form = form;
  button.form = form;
  form.elements = [qty, button];
  return page(SHOP, [qty, button], [form]);
}

const submit = (attrs: Attrs = {}, props: Partial<FakeEl> = {}) => Object.assign(new FakeEl("BUTTON", { type: "submit", ...attrs }, "Submit order"), props);

test("a submit button's off-site formaction is what the runner sees, not the form's on-site action", () => {
  const p = cart(submit({ formaction: "https://evil.example/steal" }, { formAction: "https://evil.example/steal" }));
  const live = asLive(p.run(pageCall("find", { role: "button", name: "Submit order" })));
  assert.equal(live?.form?.action, "https://evil.example/steal");
  assert.equal(live?.submits, true);
});

test("an on-site button with no overrides reports the form's action, method and this page as its target", () => {
  const p = cart(submit());
  const live = asLive(p.run(pageCall("find", { role: "button", name: "Submit order" })));
  assert.deepEqual(live?.form, { id: "form0", action: `${SHOP}/order`, method: "post", target: "", fields: [{ label: "Quantity", value: "2", secret: false }] });
});

test("an on-site formaction and formmethod on the button win over the form's and still stay on the site", () => {
  const p = cart(submit({ formaction: `${SHOP}/order/express`, formmethod: "GET" }, { formAction: `${SHOP}/order/express`, formMethod: "get" }));
  const live = asLive(p.run(pageCall("find", { role: "button", name: "Submit order" })));
  assert.equal(live?.form?.action, `${SHOP}/order/express`);
  assert.equal(live?.form?.method, "get");
  assert.equal(live?.form?.target, "");
});

test("an input of type submit or image honours its formaction too", () => {
  for (const type of ["submit", "image"]) {
    const btn = Object.assign(new FakeEl("INPUT", { type, formaction: "https://evil.example/x", "aria-label": "Go" }), { formAction: "https://evil.example/x" });
    const p = cart(btn);
    const live = asLive(p.run(pageCall("find", { role: "button", name: "Go" })));
    assert.equal(live?.form?.action, "https://evil.example/x", type);
  }
});

test("a button with a missing or invalid type is a submit button, so its off-site formaction is seen (security review)", () => {
  for (const type of [undefined, "bogus", "SUBMIT "]) {
    const attrs: Attrs = { formaction: "https://evil.example/x" };
    if (type !== undefined) attrs.type = type;
    const btn = Object.assign(new FakeEl("BUTTON", attrs, "Submit order"), { formAction: "https://evil.example/x" });
    const live = asLive(cart(btn).run(pageCall("find", { role: "button", name: "Submit order" })));
    assert.equal(live?.form?.action, "https://evil.example/x", String(type));
  }
});

test("a button that doesn't submit keeps the form's action: its formaction does nothing", () => {
  const btn = Object.assign(new FakeEl("BUTTON", { type: "button", formaction: "https://evil.example/x" }, "Submit order"), { formAction: "https://evil.example/x" });
  const p = cart(btn);
  const live = asLive(p.run(pageCall("find", { role: "button", name: "Submit order" })));
  assert.equal(live?.form?.action, `${SHOP}/order`);
});

test("a new window target is reported from the button's formtarget, the form's target or the page's base target", () => {
  const viaButton = cart(submit({ formtarget: "_blank" }, { formTarget: "_blank" }));
  assert.equal(asLive(viaButton.run(pageCall("find", { role: "button", name: "Submit order" })))?.form?.target, "_blank");
  const viaForm = cart(submit(), new FakeForm(`${SHOP}/order`, "post", "popup"));
  assert.equal(asLive(viaForm.run(pageCall("find", { role: "button", name: "Submit order" })))?.form?.target, "popup");
  // A button's formtarget overrides the form's target, either way.
  const selfWins = cart(submit({ formtarget: "_self" }, { formTarget: "_self" }), new FakeForm(`${SHOP}/order`, "post", "_blank"));
  assert.equal(asLive(selfWins.run(pageCall("find", { role: "button", name: "Submit order" })))?.form?.target, "_self");
  const form = new FakeForm(`${SHOP}/order`, "post");
  const btn = submit();
  btn.form = form;
  form.elements = [btn];
  const viaBase = page(SHOP, [btn], [form], "_blank");
  assert.equal(asLive(viaBase.run(pageCall("find", { role: "button", name: "Submit order" })))?.form?.target, "_blank");
});

/** A login page on `origin`: an email field and a password field in one form. */
function loginPage(origin: string) {
  const form = new FakeForm(`${origin}/session`, "post");
  const user = new FakeEl("INPUT", { type: "email", "aria-label": "Email" });
  const pw = new FakeEl("INPUT", { type: "password", "aria-label": "Password" });
  user.form = form;
  pw.form = form;
  form.elements = [user, pw];
  return { ...page(origin, [user, pw], [form]), user, pw };
}

test("the login fills only when the page is on the login's exact origin, checked in the same call", () => {
  const ok = loginPage(SHOP);
  assert.deepEqual(ok.run(pageCall("fillLogin", "ana@example.com", "hunter2", SHOP)), { ok: true, changed: true });
  assert.equal(ok.user.value, "ana@example.com");
  assert.equal(ok.pw.value, "hunter2");

  const moved = loginPage("https://evil.example");
  assert.deepEqual(moved.run(pageCall("fillLogin", "ana@example.com", "hunter2", SHOP)), { ok: false, reason: "off_origin" });
  assert.equal(moved.user.value, "");
  assert.equal(moved.pw.value, "");
});

test("the login fills nothing outside the main frame, or into fields of another document", () => {
  const framed = loginPage(SHOP);
  framed.win.top = {};
  assert.deepEqual(framed.run(pageCall("fillLogin", "ana@example.com", "hunter2", SHOP)), { ok: false, reason: "off_origin" });
  assert.equal(framed.pw.value, "");

  const foreign = loginPage(SHOP);
  foreign.pw.ownerDocument = {};
  assert.deepEqual(foreign.run(pageCall("fillLogin", "ana@example.com", "hunter2", SHOP)), { ok: false, reason: "off_origin" });
  assert.equal(foreign.pw.value, "");
  assert.equal(foreign.user.value, "");
});

test("the recorder posts only through the web message channel, each message carrying the native token", () => {
  assert.equal(RECORDER_SCRIPT.split(RECORDER_TOKEN_PLACEHOLDER).length, 2, "the placeholder appears exactly once");
  assert.ok(!/HermitRecorder\.post\(/.test(RECORDER_SCRIPT), "no addJavascriptInterface call is left");
  const token = "a1".repeat(16);
  const sent: string[] = [];
  const btn = new FakeEl("BUTTON", { type: "button" }, "Buy again");
  const p = page(SHOP, [btn], []);
  const handlers: Record<string, (ev: unknown) => void> = {};
  p.win.addEventListener = (type: string, fn: (ev: unknown) => void) => {
    handlers[type] = fn;
  };
  p.win.HermitRecorder = { postMessage: (s: string) => sent.push(s) };
  Object.assign(btn, { closest: (sel: string) => (sel === "form" ? null : btn) });
  const script = RECORDER_SCRIPT.replace(RECORDER_TOKEN_PLACEHOLDER, token);
  const out = new Function("window", "document", "location", "HTMLInputElement", "HTMLTextAreaElement", "Event", `return ${script};`)(p.win, p.doc, { origin: SHOP, href: `${SHOP}/`, pathname: "/" }, class {}, class {}, FakeEvent);
  assert.equal(out, "recording");
  // A page that swaps the channel after injection reaches nothing: the recorder kept the one it found.
  p.win.HermitRecorder = { postMessage: () => assert.fail("the page's replacement was used") };
  // Nor can it read the token by patching the primitives the recorder uses (security review): they were captured
  // at injection, which on the phone is document start, before any page script.
  const realCall = Function.prototype.call;
  const realStringify = JSON.stringify;
  const seen: string[] = [];
  Function.prototype.call = function (this: (...a: unknown[]) => unknown, ...args: unknown[]) {
    seen.push(String(args[1] ?? ""));
    return realCall.apply(this, args as [unknown, ...unknown[]]);
  } as typeof Function.prototype.call;
  JSON.stringify = ((v: unknown) => (seen.push("stringify"), realStringify(v))) as typeof JSON.stringify;
  try {
    handlers.click!({ target: btn });
  } finally {
    Function.prototype.call = realCall;
    JSON.stringify = realStringify;
  }
  assert.ok(!seen.some((x) => x.includes(token)), "a patched primitive saw the token");
  assert.equal(sent.length, 1);
  assert.ok(sent[0]!.startsWith(`${token}:`));
  assert.deepEqual(JSON.parse(sent[0]!.slice(token.length + 1)).target, { role: "button", name: "Buy again", nth: 0 });
});

test("a second injection replaces the first recorder instead of stacking or refusing", () => {
  const p = page(SHOP, [], []);
  const added: string[] = [];
  const removed: string[] = [];
  p.win.addEventListener = (type: string) => added.push(type);
  p.win.removeEventListener = (type: string) => removed.push(type);
  p.win.HermitRecorder = { postMessage: () => {} };
  const run = (tok: string) => new Function("window", "document", "location", "HTMLInputElement", "HTMLTextAreaElement", "Event", `return ${RECORDER_SCRIPT.replace(RECORDER_TOKEN_PLACEHOLDER, tok)};`)(p.win, p.doc, { origin: SHOP }, class {}, class {}, FakeEvent);
  assert.equal(run("t1"), "recording");
  assert.equal(run("t2"), "recording");
  assert.deepEqual(added, ["click", "change", "click", "change"]);
  assert.deepEqual(removed, ["click", "change"]);
});

// SL-56: the page after a sign-in click, read by the page script and judged by core's checkSignIn.
const signInPage = (els: FakeEl[]) => {
  const p = page(SHOP, els, []);
  return asSignInFacts(p.run(pageCall("signInFacts")));
};
const input = (attrs: Attrs) => new FakeEl("INPUT", attrs);
const frame = (src: string, shown = true) =>
  Object.assign(new FakeEl("IFRAME", { src }), { src, ...(shown ? {} : { getBoundingClientRect: () => ({ width: 0, height: 0 }) }) });

test("after the sign-in: a password field still there is a refusal; a page without one is signed in", () => {
  const refused = signInPage([input({ type: "email", name: "email" }), input({ type: "password", name: "pw" })]);
  assert.equal(refused && checkSignIn(refused), "rejected");
  const home = signInPage([input({ type: "search", "aria-label": "Search" })]);
  assert.equal(home && checkSignIn(home), "signed_in");
});

test("a one-time code field, by autocomplete or by its English or Spanish words, pauses for the user", () => {
  const codes: Attrs[] = [{ type: "text", autocomplete: "one-time-code" }, { type: "tel", name: "otp" }, { type: "text", "aria-label": "Código de verificación" }];
  for (const attrs of codes) {
    const f = signInPage([input(attrs)]);
    assert.equal(f && checkSignIn(f), "code", JSON.stringify(attrs));
  }
  // A discount or postal code is no one-time code.
  const promo = signInPage([input({ type: "text", name: "promo_code", "aria-label": "Discount code" })]);
  assert.equal(promo && checkSignIn(promo), "signed_in");
});

test("a visible captcha frame or widget is a captcha; an invisible reCAPTCHA badge or a button with the site key is not", () => {
  const challenge = signInPage([frame("https://www.google.com/recaptcha/api2/bframe?k=x")]);
  assert.equal(challenge && checkSignIn(challenge), "captcha");
  const widget = signInPage([new FakeEl("DIV", { class: "h-captcha", "data-sitekey": "k" })]);
  assert.equal(widget && checkSignIn(widget), "captcha");
  const quiet = signInPage([
    frame("https://www.google.com/recaptcha/api2/anchor?k=x&size=invisible"),
    frame("https://www.google.com/recaptcha/api2/bframe?k=x", false),
    new FakeEl("BUTTON", { class: "g-recaptcha", "data-sitekey": "k" }, "Sign in"),
  ]);
  assert.equal(quiet && checkSignIn(quiet), "signed_in");
});

test("a frame's own report is no report: the user checks the page", () => {
  const p = page(SHOP, [input({ type: "password" })], []);
  p.win.top = {};
  assert.equal(asSignInFacts(p.run(pageCall("signInFacts"))), undefined);
});

// SL-56b: the code goes only into the field the runner chose from the report, top frame, exact origin, same call.
const codePage = (origin: string) => {
  const form = new FakeForm(`${origin}/verify`, "post");
  const search = new FakeEl("INPUT", { type: "text", "aria-label": "Search" });
  const code = new FakeEl("INPUT", { type: "text", autocomplete: "one-time-code", name: "otp", "aria-label": "Verification code" });
  code.form = form;
  form.elements = [code];
  let submitted = 0;
  Object.assign(form, { requestSubmit: () => void submitted++ });
  const p = page(origin, [search, code], [form]);
  return { ...p, search, code, form, submitted: () => submitted };
};
const EXPECT = { autocomplete: "one-time-code", name: "otp", label: "Verification code" };

test("the code fills the one field the report named, on the exact origin, and submits its own form", () => {
  const p = codePage(SHOP);
  const facts = asSignInFacts(p.run(pageCall("signInFacts")));
  assert.deepEqual(facts?.fields[1], { ...EXPECT, inputmode: "" });
  assert.deepEqual(p.run(pageCall("fillCode", "482913", SHOP, 1, EXPECT)), { ok: true, changed: true });
  assert.equal(p.code.value, "482913");
  assert.equal(p.search.value, "");
  assert.equal(p.submitted(), 1);
});

test("the code fills nothing on another origin, in a frame, or into a field that isn't the one the report named", () => {
  const moved = codePage("https://evil.example");
  assert.deepEqual(moved.run(pageCall("fillCode", "482913", SHOP, 1, EXPECT)), { ok: false, reason: "off_origin" });
  assert.equal(moved.code.value, "");
  const framed = codePage(SHOP);
  framed.win.top = {};
  assert.deepEqual(framed.run(pageCall("fillCode", "482913", SHOP, 1, EXPECT)), { ok: false, reason: "off_origin" });
  const swapped = codePage(SHOP);
  assert.deepEqual(swapped.run(pageCall("fillCode", "482913", SHOP, 0, EXPECT)), { ok: false, reason: "not_found" });
  assert.equal(swapped.search.value, "");
  const foreign = codePage(SHOP);
  foreign.code.ownerDocument = {};
  assert.deepEqual(foreign.run(pageCall("fillCode", "482913", SHOP, 1, EXPECT)), { ok: false, reason: "off_origin" });
  assert.equal(foreign.code.value, "");
});

test("a code field whose form sends to another site gets nothing: the user types it", () => {
  const p = codePage(SHOP);
  p.form.action = "https://evil.example/collect";
  assert.deepEqual(p.run(pageCall("fillCode", "482913", SHOP, 1, EXPECT)), { ok: false, reason: "off_origin" });
  assert.equal(p.code.value, "");
  assert.equal(p.submitted(), 0);
});
