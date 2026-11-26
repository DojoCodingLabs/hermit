import { expect, test } from "vitest";
import { actionSchema, parseAction } from "../src/web/action.ts";
import { classifyClick } from "../src/web/classify.ts";
import { createSim, type Site, type WebNode } from "../src/web/sim.ts";

const site: Site = {
  id: "t",
  origin: "https://t.test",
  start: "p",
  pages: {
    p: {
      title: "Form",
      path: "/",
      nodes: [
        { id: "b", role: "button", name: "Next" },
        { id: "name", role: "textbox", name: "Name" },
        { id: "size", role: "combobox", name: "Size", options: ["S", "M"] },
        { id: "r", role: "radio", name: "7 PM", group: "time" },
        { id: "off", role: "button", name: "Sold out", disabled: true },
      ],
    },
  },
};
const snap = createSim(site).snapshot();

test("the schema pins refs to the ones shown, by kind", () => {
  const s = actionSchema(snap) as { anyOf: Array<{ properties: Record<string, { enum?: unknown[]; const?: unknown }> }> };
  const byAction = Object.fromEntries(s.anyOf.map((v) => [v.properties.action!.const, v.properties.ref?.enum]));
  expect(byAction).toEqual({ click: [1, 4], type: [2], select: [3], done: undefined, infeasible: undefined });
});

test("the schema drops type and select when the page has nothing to type into or select", () => {
  const plain = createSim({ ...site, pages: { p: { title: "x", path: "/", nodes: [{ id: "b", role: "button", name: "Go" }] } } }).snapshot();
  const s = actionSchema(plain) as { anyOf: Array<{ properties: { action: { const: string } } }> };
  expect(s.anyOf.map((v) => v.properties.action.const)).toEqual(["click", "done", "infeasible"]);
});

test("parses each action kind", () => {
  expect(parseAction('{"action":"click","ref":1}', snap)).toEqual({ ok: true, action: { kind: "click", ref: 1 } });
  expect(parseAction('{"action":"type","ref":2,"text":"Ana"}', snap)).toEqual({ ok: true, action: { kind: "type", ref: 2, text: "Ana" } });
  expect(parseAction('{"action":"select","ref":3,"option":"M"}', snap)).toEqual({ ok: true, action: { kind: "select", ref: 3, option: "M" } });
  expect(parseAction('{"action":"done","answer":"Shipped"}', snap)).toEqual({ ok: true, action: { kind: "done", answer: "Shipped" } });
  expect(parseAction('{"action":"infeasible","reason":"no slot"}', snap)).toEqual({ ok: true, action: { kind: "infeasible", reason: "no slot" } });
});

test("tolerates think blocks, code fences and string refs", () => {
  expect(parseAction('<think>the orders link</think>\n```json\n{"action": "click", "ref": "4"}\n```', snap)).toEqual({ ok: true, action: { kind: "click", ref: 4 } });
});

test("rejects refs not shown, wrong kinds, and junk", () => {
  expect(parseAction('{"action":"click","ref":9}', snap)).toEqual({ ok: false, error: "ref 9 is not on this page" });
  expect(parseAction('{"action":"type","ref":1,"text":"x"}', snap)).toEqual({ ok: false, error: "ref 1 is a button, not a textbox" });
  expect(parseAction('{"action":"select","ref":2,"option":"x"}', snap)).toEqual({ ok: false, error: "ref 2 is a textbox, not a combobox" });
  expect(parseAction('{"action":"type","ref":2}', snap)).toEqual({ ok: false, error: "type needs text" });
  expect(parseAction('{"action":"fly"}', snap)).toEqual({ ok: false, error: "unknown action fly" });
  expect(parseAction("I will click Next", snap)).toEqual({ ok: false, error: "no JSON object" });
});

const node = (role: WebNode["role"], name: string): WebNode => ({ id: name, role, name });
const form = [node("textbox", "Email"), node("button", "Go")];

test("the classifier flags pay, sign-in, submit and delete clicks, in English and Spanish", () => {
  expect(classifyClick(node("button", "Place order"), [])).toBe("spend");
  expect(classifyClick(node("button", "Realizar pedido"), [])).toBe("spend");
  expect(classifyClick(node("button", "Pay $12.40"), [])).toBe("spend");
  expect(classifyClick(node("button", "Continue - $45.00"), [])).toBe("spend");
  expect(classifyClick(node("button", "Sign in"), [])).toBe("credential");
  expect(classifyClick(node("button", "Iniciar sesión"), [])).toBe("credential");
  expect(classifyClick(node("button", "Confirm reservation"), [])).toBe("remote_write");
  expect(classifyClick(node("button", "Confirmar reserva"), [])).toBe("remote_write");
  expect(classifyClick(node("button", "Cancel order"), [])).toBe("remote_write");
  expect(classifyClick(node("button", "Enviar solicitud"), [])).toBe("remote_write");
});

test("navigation, cart and search clicks do not ask", () => {
  expect(classifyClick(node("link", "Your orders"), [])).toBeNull();
  expect(classifyClick(node("button", "Buy again"), [])).toBeNull();
  expect(classifyClick(node("button", "Volver a comprar"), [])).toBeNull();
  expect(classifyClick(node("button", "Proceed to checkout"), [])).toBeNull();
  expect(classifyClick(node("button", "Search"), form)).toBeNull();
  expect(classifyClick(node("radio", "7:30 PM"), form)).toBeNull();
});

test("an unclassifiable button on a page with a form defaults to remote_write", () => {
  expect(classifyClick(node("button", "Go"), form)).toBe("remote_write");
  expect(classifyClick(node("button", "Go"), [node("button", "Go")])).toBeNull();
});
