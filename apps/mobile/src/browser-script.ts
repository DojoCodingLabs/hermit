// SL-53 (FR-WEB-05, US-WEB-07, US-WEB-11): the script Hermit runs inside the task's page. It is plain JavaScript in a
// string (Hermes keeps no function source, so nothing here is built with Function.prototype.toString). Every call
// rebuilds its helpers from this text, so nothing a page leaves on `window` is trusted. Arguments go in as JSON
// literals, so a site's names can't become code. What comes back is the page's own words: data, never instructions.
//
// The accessibility tree is a small subset of Playwright's aria snapshot idea (Apache 2.0): one line per element in
// page order (`[7] button "Place order" disabled`, `[12] textbox "Email" = "..."`, `## Heading`), secret values
// masked, cut to about 3,000 characters keeping the first 80% and the last 20%.

const LIB = String.raw`
var BUDGET = 3000;
var SEL = 'a[href],button,input,select,textarea,summary,[role=button],[role=link],[role=checkbox],[role=radio],[role=tab],[role=menuitem],[role=option],[role=combobox],[role=textbox],[role=searchbox]';
function norm(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }
function visible(e) {
  if (!e.getBoundingClientRect) return false;
  var r = e.getBoundingClientRect();
  var st = window.getComputedStyle(e);
  return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none';
}
function roleOf(e) {
  var r = e.getAttribute && e.getAttribute('role');
  if (r) return r.split(' ')[0].toLowerCase();
  var t = e.tagName.toLowerCase();
  if (t === 'a') return e.hasAttribute('href') ? 'link' : null;
  if (t === 'button' || t === 'summary') return 'button';
  if (t === 'select') return 'combobox';
  if (t === 'textarea') return 'textbox';
  if (t === 'input') {
    var ty = (e.getAttribute('type') || 'text').toLowerCase();
    if (ty === 'hidden') return null;
    if (ty === 'submit' || ty === 'button' || ty === 'reset' || ty === 'image') return 'button';
    if (ty === 'checkbox') return 'checkbox';
    if (ty === 'radio') return 'radio';
    if (ty === 'search') return 'searchbox';
    return 'textbox';
  }
  if (/^h[1-6]$/.test(t)) return 'heading';
  return null;
}
function isField(r) { return r === 'textbox' || r === 'searchbox' || r === 'combobox' || r === 'checkbox' || r === 'radio'; }
function labelText(e) {
  var by = e.getAttribute('aria-labelledby');
  if (by) return norm(by.split(/\s+/).map(function (id) { var x = document.getElementById(id); return x ? x.innerText : ''; }).join(' '));
  if (e.id) { var l = document.querySelector('label[for="' + String(e.id).replace(/["\\]/g, '') + '"]'); if (l) return norm(l.innerText); }
  var c = e.closest && e.closest('label');
  if (c) return norm(c.innerText);
  return '';
}
function nameOf(e) {
  var r = roleOf(e);
  var n = norm(e.getAttribute('aria-label'));
  if (!n && isField(r)) n = labelText(e) || norm(e.getAttribute('placeholder')) || norm(e.getAttribute('title')) || norm(e.getAttribute('name'));
  if (!n && e.tagName === 'INPUT') n = norm(e.value) || norm(e.getAttribute('alt')) || norm(e.getAttribute('title'));
  if (!n) n = labelText(e) || norm(e.innerText || e.textContent) || norm(e.getAttribute('title')) || norm(e.getAttribute('alt'));
  return n.slice(0, 120);
}
function all() {
  return Array.prototype.filter.call(document.querySelectorAll(SEL), function (e) { return roleOf(e) && visible(e); });
}
function nthOf(e) {
  var r = roleOf(e), n = nameOf(e), k = 0, list = all();
  for (var i = 0; i < list.length; i++) { if (list[i] === e) return k; if (roleOf(list[i]) === r && nameOf(list[i]) === n) k++; }
  return 0;
}
function find(t) {
  var k = 0, list = all();
  for (var i = 0; i < list.length; i++) {
    var e = list[i];
    if (roleOf(e) === t.role && nameOf(e) === t.name) { if (k === (t.nth || 0)) return e; k++; }
  }
  return null;
}
function isSecret(e) {
  if (e.tagName !== 'INPUT') return false;
  var ty = (e.getAttribute('type') || '').toLowerCase();
  var ac = (e.getAttribute('autocomplete') || '').toLowerCase();
  return ty === 'password' || /cc-|one-time-code/.test(ac);
}
function valueOf(e) {
  var r = roleOf(e);
  if (r === 'checkbox' || r === 'radio') return e.checked || e.getAttribute('aria-checked') === 'true' ? 'on' : '';
  if (e.tagName === 'SELECT') { var o = e.options[e.selectedIndex]; return o ? norm(o.text) : ''; }
  return e.value == null ? '' : String(e.value);
}
function isSubmitter(e) {
  // The DOM's normalised type, not the attribute: a button with a missing or invalid type is a submit button
  // (security review), and the browser decides that, not the markup.
  var ty = String(e.type || '').toLowerCase();
  return (e.tagName === 'BUTTON' && ty === 'submit') || (e.tagName === 'INPUT' && (ty === 'submit' || ty === 'image'));
}
function submission(e, f) {
  // The effective submission: a submit button's formaction, formmethod and formtarget override the form's, and the
  // page's <base target> applies when neither has a target. Targets are read as attributes, which a field named
  // "target" can't shadow; an action a field shadows reads as no address, which the runner refuses.
  var sub = isSubmitter(e);
  var action = sub && e.hasAttribute('formaction') ? e.formAction : f.action;
  var method = sub && e.hasAttribute('formmethod') ? (e.formMethod || e.getAttribute('formmethod')) : f.method;
  var target;
  if (sub && e.hasAttribute('formtarget')) target = e.getAttribute('formtarget');
  else if (f.hasAttribute('target')) target = f.getAttribute('target');
  else { var b = document.querySelector('base[target]'); target = b ? b.getAttribute('target') : ''; }
  return { action: String(action == null ? '' : action), method: String(method || 'get').toLowerCase(), target: norm(target).toLowerCase().slice(0, 100) };
}
function formOf(e) {
  var f = e.form || (e.closest && e.closest('form'));
  if (!f) return undefined;
  var fields = [];
  Array.prototype.forEach.call(f.elements || [], function (x) {
    var r = roleOf(x);
    if (!r || r === 'button' || !visible(x)) return;
    var secret = isSecret(x);
    fields.push({ label: nameOf(x), value: secret ? '' : valueOf(x).slice(0, 200), secret: secret });
  });
  var s = submission(e, f);
  var id = (typeof f.id === 'string' && f.id) || ('form' + Array.prototype.indexOf.call(document.forms, f));
  return { id: id.slice(0, 200), action: s.action.slice(0, 2000), method: s.method.slice(0, 10), target: s.target, fields: fields.slice(0, 30) };
}
function pageHasForm() {
  return all().some(function (e) { var r = roleOf(e); return (r === 'textbox' || r === 'combobox') && !/search|buscar/i.test(nameOf(e)); });
}
var MONEY = /([$€£₡]\s?\d[\d.,]*|\d[\d.,]*\s?(USD|EUR|CRC|MXN|COP|USDT)\b)/i;
function nearby(e) {
  var c = (e.closest && e.closest('tr,li,dialog,[role=dialog],form,section,article')) || e.parentElement;
  var t = c ? norm(c.innerText) : '';
  var m = t.match(MONEY);
  return m ? norm(m[0]).slice(0, 60) : undefined;
}
function live(e) {
  var o = { role: roleOf(e), name: nameOf(e), nth: nthOf(e), pageHasForm: pageHasForm() };
  if (e.disabled || e.getAttribute('aria-disabled') === 'true') o.disabled = true;
  var ty = (e.getAttribute('type') || '').toLowerCase();
  if ((e.tagName === 'BUTTON' && (ty === '' || ty === 'submit') && e.form) || (e.tagName === 'INPUT' && (ty === 'submit' || ty === 'image'))) o.submits = true;
  var f = formOf(e); if (f) o.form = f;
  var n = nearby(e); if (n) o.nearby = n;
  return o;
}
function sig() { return location.href + '|' + (document.body ? document.body.innerText.length : 0) + '|' + document.getElementsByTagName('*').length; }
function setValue(e, v) {
  var proto = e.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  var d = Object.getOwnPropertyDescriptor(proto, 'value');
  if (d && d.set) d.set.call(e, v); else e.value = v;
  e.dispatchEvent(new Event('input', { bubbles: true }));
  e.dispatchEvent(new Event('change', { bubbles: true }));
}
function act(kind, t, v) {
  var e = find(t);
  if (!e) return { ok: false, reason: 'not_found' };
  if (e.disabled || e.getAttribute('aria-disabled') === 'true') return { ok: false, reason: 'disabled' };
  var before = valueOf(e);
  if (e.scrollIntoView) e.scrollIntoView({ block: 'center' });
  if (kind === 'click') { e.click(); return { ok: true, changed: true, sig: sig() }; }
  if (kind === 'fill') { if (e.focus) e.focus(); setValue(e, v); }
  else if (kind === 'select') {
    if (e.tagName !== 'SELECT') return { ok: false, reason: 'failed' };
    var opt = Array.prototype.find.call(e.options, function (o) { return norm(o.text) === v || o.value === v; });
    if (!opt) return { ok: false, reason: 'not_found' };
    e.value = opt.value;
    e.dispatchEvent(new Event('change', { bubbles: true }));
  } else if (kind === 'check') { if ((valueOf(e) === 'on') !== v) e.click(); }
  return { ok: true, changed: valueOf(e) !== before };
}
function mainFrameOn(origin) {
  return window.top === window && location.origin === origin;
}
function fillLogin(u, p, origin) {
  // Checked in this same call, right before the values go in: a navigation after the runner's own check fills nothing.
  if (typeof origin !== 'string' || !mainFrameOn(origin)) return { ok: false, reason: 'off_origin' };
  var pw = Array.prototype.find.call(document.querySelectorAll('input[type=password]'), visible);
  if (!pw) return { ok: false, reason: 'not_found' };
  var scope = pw.form || document;
  var users = Array.prototype.filter.call(scope.querySelectorAll('input'), function (x) {
    var ty = (x.getAttribute('type') || 'text').toLowerCase();
    return visible(x) && (ty === 'text' || ty === 'email' || ty === 'tel') && (x.compareDocumentPosition(pw) & 4);
  });
  var user = users[users.length - 1];
  if (pw.ownerDocument !== document || (user && user.ownerDocument !== document)) return { ok: false, reason: 'off_origin' };
  if (user && u) setValue(user, u);
  setValue(pw, p);
  return { ok: true, changed: true };
}
// SL-56: what the page shows after a sign-in click, from the top frame only (a frame's report is no report). Only
// visible things count: an invisible reCAPTCHA's badge frame or a button that carries the site key is no captcha.
var CAPTCHA_SEL = '.g-recaptcha,.h-captcha,.cf-turnstile,.frc-captcha,#FunCaptcha,[data-sitekey]';
function signInInputs() { return Array.prototype.filter.call(document.querySelectorAll('input'), visible); }
function inputType(x) { return (x.getAttribute('type') || 'text').toLowerCase(); }
// The text, number and tel inputs the report lists, in page order: fillCode finds its field by the same list.
function signInFields() {
  return signInInputs().filter(function (x) { var ty = inputType(x); return ty === 'text' || ty === 'number' || ty === 'tel'; }).slice(0, 30);
}
function fieldFacts(x) {
  return {
    autocomplete: norm(x.getAttribute('autocomplete')).slice(0, 60),
    name: norm(x.getAttribute('name') || x.id).slice(0, 120),
    label: (labelText(x) || norm(x.getAttribute('aria-label')) || norm(x.getAttribute('placeholder'))).slice(0, 200),
    inputmode: norm(x.getAttribute('inputmode')).slice(0, 20),
  };
}
// SL-56b: the one-time code into the field the runner chose from the report (its index and what the report said
// about it), checked in this same call: the main frame on the task's exact origin, the field still that one and in
// this document, and its form (if any) sending to the same origin in this window. Then the form is submitted, as the
// Enter key would. Nothing comes back but the outcome.
function fillCode(code, origin, index, expect) {
  if (typeof origin !== 'string' || typeof code !== 'string' || !mainFrameOn(origin)) return { ok: false, reason: 'off_origin' };
  var x = signInFields()[index];
  if (!x || !expect) return { ok: false, reason: 'not_found' };
  var f = fieldFacts(x);
  if (f.autocomplete !== expect.autocomplete || f.name !== expect.name || f.label !== expect.label) return { ok: false, reason: 'not_found' };
  if (x.ownerDocument !== document) return { ok: false, reason: 'off_origin' };
  var form = x.form || null;
  var sub;
  if (form) {
    sub = submission(form, form);
    var to;
    try { to = new URL(sub.action || location.href, location.href).origin; } catch (err) { to = ''; }
    if (to !== origin || (sub.target !== '' && sub.target !== '_self')) return { ok: false, reason: 'off_origin' };
  }
  if (x.focus) x.focus();
  setValue(x, code);
  if (form && typeof form.requestSubmit === 'function') form.requestSubmit();
  return { ok: true, changed: true };
}
function signInFacts() {
  if (window.top !== window) return null;
  var inputs = signInInputs();
  var password = inputs.some(function (x) { return inputType(x) === 'password'; });
  var fields = signInFields().map(fieldFacts);
  var frames = Array.prototype.filter.call(document.querySelectorAll('iframe'), function (f) {
    return visible(f) && !/[?&]size=invisible(&|$)/.test(String(f.src || ''));
  }).slice(0, 20).map(function (f) { return String(f.src || '').slice(0, 500); });
  var widget = Array.prototype.some.call(document.querySelectorAll(CAPTCHA_SEL), function (e) {
    return visible(e) && e.tagName !== 'BUTTON' && e.tagName !== 'INPUT' && e.getAttribute('data-size') !== 'invisible';
  });
  return { password: password, fields: fields, frames: frames, widget: widget };
}
function cut(lines, budget) {
  var size = lines.reduce(function (a, l) { return a + l.length + 1; }, 0);
  if (size <= budget) return lines.join('\n');
  var room = budget - 40, head = [], tail = [], used = 0, i;
  for (i = 0; i < lines.length && used + lines[i].length + 1 <= room * 0.8; i++) { head.push(lines[i]); used += lines[i].length + 1; }
  var tailUsed = 0;
  for (var j = lines.length - 1; j >= i && tailUsed + lines[j].length + 1 <= room * 0.2; j--) { tail.unshift(lines[j]); tailUsed += lines[j].length + 1; }
  return head.concat(['[... ' + (lines.length - head.length - tail.length) + ' lines cut ...]'], tail).join('\n');
}
function snapshot() {
  var lines = ['[page] ' + norm(document.title).slice(0, 80) + ' | ' + location.origin + location.pathname];
  var ref = 0;
  var nodes = document.querySelectorAll(SEL + ',h1,h2,h3,h4,h5,h6,p,li,td,th,dt,dd');
  Array.prototype.forEach.call(nodes, function (e) {
    if (!visible(e)) return;
    var r = roleOf(e);
    if (r === 'heading') { lines.push('## ' + nameOf(e)); return; }
    if (!r) {
      if (e.querySelector(SEL)) return;
      var t = norm(e.innerText).slice(0, 200);
      if (t) lines.push(t);
      return;
    }
    var line = '[' + (++ref) + '] ' + r + ' "' + nameOf(e) + '"';
    if (r === 'checkbox' || r === 'radio') { if (valueOf(e) === 'on') line += ' checked'; }
    else if (isField(r)) { var v = valueOf(e); if (v) line += ' = "' + (isSecret(e) ? '***' : v.slice(0, 80)) + '"'; }
    if (e.disabled) line += ' disabled';
    lines.push(line);
  });
  return cut(lines, BUDGET);
}
`;

/** JSON literal for an argument; U+2028 and U+2029 escaped, so a site's name can never end the literal. */
const literal = (v: unknown) => JSON.stringify(v ?? null).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");

/** The script for one call: Hermit's helpers, then `fn(...args)`, returned as a JSON string. */
export function pageCall(fn: "find" | "act" | "fillLogin" | "snapshot" | "candidates" | "sig" | "signInFacts" | "fillCode", ...args: unknown[]): string {
  const body =
    fn === "find" ? `var e = find(${literal(args[0])}); return e ? live(e) : null;`
    : fn === "act" ? `return act(${literal(args[0])}, ${literal(args[1])}, ${literal(args[2])});`
    : fn === "fillLogin" ? `return fillLogin(${literal(args[0])}, ${literal(args[1])}, ${literal(args[2])});`
    : fn === "snapshot" ? "return snapshot();"
    : fn === "candidates" ? `var r = ${literal(args[0])}; return all().filter(function (e) { return roleOf(e) === r; }).slice(0, 40).map(live);`
    : fn === "signInFacts" ? "return signInFacts();"
    : fn === "fillCode" ? `return fillCode(${literal(args[0])}, ${literal(args[1])}, ${literal(args[2])}, ${literal(args[3])});`
    : "return sig();";
  return `(function () { 'use strict'; ${LIB}\ntry { return JSON.stringify((function () { ${body} })()); } catch (err) { return JSON.stringify({ __error: String(err && err.message || err).slice(0, 200) }); } })()`;
}

/**
 * Where the native view puts the token it generates for one injection (hex, inside a JS string literal). JS never
 * holds the token: the native view replaces this right before it evaluates the script, and keeps the token to check.
 */
export const RECORDER_TOKEN_PLACEHOLDER = "__HERMIT_RECORDER_TOKEN__";

/**
 * The recorder (US-WEB-11): while the user does a task, each click, typed value and pick is posted to the native side
 * over the `HermitRecorder` web message channel, which the native view injects only into frames on the task's exact
 * origin and accepts only from the main frame while recording is on. Each message is `<token>:<json>`, the token being
 * the one the native view generated for this injection, so a script Hermit didn't inject can't post steps. The channel
 * is taken once, when the recorder starts, so a page that swaps it later reaches nothing. A secret field's value is
 * never posted (only that it was secret). A second injection replaces the first recorder.
 */
export const RECORDER_SCRIPT = `(function () { 'use strict'; ${LIB}
var TOKEN = '${RECORDER_TOKEN_PLACEHOLDER}';
var channel = window.HermitRecorder;
if (!channel || typeof channel.postMessage !== 'function') return 'unavailable';
// Captured at document start, before any page script runs (the native side injects this with
// addDocumentStartJavaScript), so a page can't swap postMessage, Function.prototype.call or JSON.stringify to read the
// token later. The token lives only in this closure.
var send = Function.prototype.call.bind(channel.postMessage, channel);
var stringify = JSON.stringify;
if (typeof window.__hermitRecorderStop === 'function') { try { window.__hermitRecorderStop(); } catch (err) {} }
function post(o) { try { send(TOKEN + ':' + stringify(o)); } catch (err) {} }
function target(e) { return { role: roleOf(e), name: nameOf(e), nth: nthOf(e) }; }
function onClick(ev) {
  var e = ev.target && ev.target.closest ? ev.target.closest(SEL) : null;
  if (!e || !roleOf(e)) return;
  var r = roleOf(e);
  if (r === 'checkbox' || r === 'radio') { setTimeout(function () { post({ kind: 'check', target: target(e), on: valueOf(e) === 'on' }); }, 0); return; }
  if (r === 'button' || r === 'link' || r === 'menuitem' || r === 'tab' || r === 'option') post({ kind: 'click', target: target(e), live: live(e) });
}
function onChange(ev) {
  var e = ev.target;
  if (!e || !roleOf(e)) return;
  var r = roleOf(e);
  var f = e.form || (e.closest && e.closest('form'));
  var form = f ? (f.id || ('form' + Array.prototype.indexOf.call(document.forms, f))) : undefined;
  if (e.tagName === 'SELECT') {
    post({ kind: 'select', target: target(e), value: valueOf(e), label: nameOf(e), options: Array.prototype.map.call(e.options, function (o) { return norm(o.text).slice(0, 60); }).slice(0, 20) });
    return;
  }
  if (r === 'textbox' || r === 'searchbox') post({ kind: 'fill', target: target(e), value: isSecret(e) ? '' : valueOf(e).slice(0, 200), secret: isSecret(e), label: nameOf(e), form: form });
}
window.addEventListener('click', onClick, true);
window.addEventListener('change', onChange, true);
try {
  Object.defineProperty(window, '__hermitRecorderStop', {
    configurable: true,
    value: function () { window.removeEventListener('click', onClick, true); window.removeEventListener('change', onChange, true); },
  });
} catch (err) {}
return 'recording';
})()`;

/**
 * What evaluateJavascript hands back: the JSON of the script's value, which is itself a JSON string. Undefined for
 * anything that isn't (a page that broke the script, a navigation mid-call).
 */
export function parseResult(raw: unknown): unknown {
  if (typeof raw !== "string") return undefined;
  try {
    const inner = JSON.parse(raw) as unknown;
    if (typeof inner !== "string") return undefined;
    const v = JSON.parse(inner) as unknown;
    return v && typeof v === "object" && "__error" in (v as object) ? undefined : v;
  } catch {
    return undefined;
  }
}

/** Exposed for tests: the helper library alone. */
export const PAGE_LIB = LIB;
