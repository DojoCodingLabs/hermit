import { expect, test } from "vitest";
import { createSim, type Site } from "../src/web/sim.ts";

const site: Site = {
  id: "t",
  origin: "https://shop.test",
  start: "home",
  pages: {
    home: {
      title: "Test shop",
      path: "/",
      nodes: (s) => [
        { id: "h", role: "heading", name: "Welcome" },
        { id: "promo", role: "text", name: "Free delivery today" },
        { id: "orders", role: "link", name: "Your orders", to: "orders" },
        { id: "cart", role: "link", name: `Cart (${(s.fields.cart ?? "").split(",").filter(Boolean).length})`, to: "cart" },
        { id: "add", role: "button", name: "Add to cart", onClick: (x) => void (x.fields.cart = [x.fields.cart, "milk"].filter(Boolean).join(",")) },
        { id: "noop", role: "button", name: "Nothing" },
      ],
    },
    orders: { title: "Orders", path: "/orders", nodes: [{ id: "home", role: "link", name: "Home", to: "home" }] },
    cart: { title: "Cart", path: "/cart", nodes: [] },
    form: {
      title: "Book",
      path: "/book",
      nodes: [
        { id: "party", role: "combobox", name: "Party size", options: ["1", "2", "3"] },
        { id: "t1", role: "radio", name: "7:00 PM", group: "time" },
        { id: "t2", role: "radio", name: "9:00 PM", group: "time", disabled: true },
        { id: "name", role: "textbox", name: "Name" },
        { id: "card", role: "textbox", name: "Card number", secret: true },
        { id: "go", role: "button", name: "Confirm reservation", to: "done", requires: ["party", "time", "name"], effect: "booked" },
      ],
    },
    done: { title: "Done", path: "/done", nodes: [{ id: "ok", role: "heading", name: "Booked" }] },
  },
};

test("a snapshot is one line per node with numbered refs for interactive nodes only", () => {
  const snap = createSim(site).snapshot();
  expect(snap.text).toBe(
    ["[page] Test shop | https://shop.test/", "## Welcome", "Free delivery today", '[1] link "Your orders"', '[2] link "Cart (0)"', '[3] button "Add to cart"', '[4] button "Nothing"'].join("\n"),
  );
  expect(snap.refs.get(1)?.id).toBe("orders");
  expect(snap.refs.size).toBe(4);
});

test("clicking a link navigates and reports one outcome line", () => {
  const sim = createSim(site);
  const r = sim.act({ kind: "click", ref: 1 });
  expect(r).toMatchObject({ ok: true, changed: true, line: '[ok] click [1] link "Your orders" -> navigated to /orders' });
  expect(sim.view().page).toBe("orders");
});

test("a click that changes data re-renders the page; a dead click is no change", () => {
  const sim = createSim(site);
  expect(sim.act({ kind: "click", ref: 3 }).line).toBe('[ok] click [3] button "Add to cart" -> page changed');
  expect(sim.snapshot().text).toContain('[2] link "Cart (1)"');
  expect(sim.act({ kind: "click", ref: 4 })).toMatchObject({ changed: false, line: '[ok] click [4] button "Nothing" -> no change' });
});

test("an unknown ref is an error and changes nothing", () => {
  const sim = createSim(site);
  expect(sim.act({ kind: "click", ref: 99 })).toMatchObject({ ok: false, changed: false, line: "[error] no element [99] on this page" });
});

test("forms: select, radio, type, masked secrets, disabled options and required fields", () => {
  const sim = createSim(site, "form");
  const snap = sim.snapshot();
  expect(snap.text).toContain('[1] combobox "Party size" options: 1 | 2 | 3');
  expect(snap.text).toContain('[3] radio "9:00 PM" disabled');
  expect(sim.act({ kind: "click", ref: 6 })).toMatchObject({ ok: false, changed: false, line: '[error] click [6] button "Confirm reservation": fill "Party size", "time", "Name" first' });
  expect(sim.act({ kind: "click", ref: 3 })).toMatchObject({ ok: false, line: '[error] click [3] radio "9:00 PM": disabled' });
  expect(sim.act({ kind: "select", ref: 1, option: "4" })).toMatchObject({ ok: false, line: '[error] select [1] combobox "Party size": no option "4"' });
  expect(sim.act({ kind: "select", ref: 1, option: "2" }).line).toBe('[ok] select [1] combobox "Party size" = "2"');
  expect(sim.act({ kind: "click", ref: 2 }).line).toBe('[ok] click [2] radio "7:00 PM" -> checked');
  expect(sim.act({ kind: "type", ref: 4, text: "Ana Mora" }).line).toBe('[ok] type [4] textbox "Name" = "Ana Mora"');
  sim.act({ kind: "type", ref: 5, text: "4242424242424242" });
  const after = sim.snapshot().text;
  expect(after).toContain('[1] combobox "Party size" = "2" options: 1 | 2 | 3');
  expect(after).toContain('[2] radio "7:00 PM" checked');
  expect(after).toContain('[5] textbox "Card number" = "***"');
  expect(sim.act({ kind: "click", ref: 6 }).line).toBe('[ok] click [6] button "Confirm reservation" -> navigated to /done');
  expect(sim.view().effects).toEqual(["booked"]);
});

test("typing only goes into text boxes, selecting only into comboboxes", () => {
  const sim = createSim(site, "form");
  expect(sim.act({ kind: "type", ref: 1, text: "x" }).ok).toBe(false);
  expect(sim.act({ kind: "select", ref: 4, option: "x" }).ok).toBe(false);
});

test("a long page is cut to the budget keeping the first 80% and the last 20%", () => {
  const big: Site = {
    id: "big",
    origin: "https://big.test",
    start: "p",
    pages: { p: { title: "Big", path: "/", nodes: Array.from({ length: 200 }, (_, i) => ({ id: `n${i}`, role: "link" as const, name: `Item number ${i}` })) } },
  };
  const snap = createSim(big).snapshot(1000);
  expect(snap.text.length).toBeLessThanOrEqual(1000);
  expect(snap.text).toMatch(/\.\.\. \d+ lines cut/);
  expect(snap.text).toContain('[1] link "Item number 0"');
  expect(snap.text).toContain('[200] link "Item number 199"');
  // Cut lines are not offered as refs.
  expect(snap.refs.has(100)).toBe(false);
  expect(snap.refs.has(200)).toBe(true);
});

test("re-applying what is already there is no change: same option, same text, checked radio", () => {
  const form = createSim(site, "form");
  form.act({ kind: "select", ref: 1, option: "2" });
  expect(form.act({ kind: "select", ref: 1, option: "2" })).toMatchObject({ ok: true, changed: false, line: '[ok] select [1] combobox "Party size" = "2" -> no change' });
  form.act({ kind: "type", ref: 4, text: "Ana" });
  expect(form.act({ kind: "type", ref: 4, text: "Ana" })).toMatchObject({ changed: false });
  form.act({ kind: "click", ref: 2 });
  expect(form.act({ kind: "click", ref: 2 })).toMatchObject({ changed: false, line: '[ok] click [2] radio "7:00 PM" -> no change' });
});

test("a link to the page already shown is no change", () => {
  const self: Site = { id: "s", origin: "https://s.test", start: "a", pages: { a: { title: "A", path: "/a", nodes: [{ id: "x", role: "link", name: "A", to: "a" }] } } };
  expect(createSim(self).act({ kind: "click", ref: 1 })).toMatchObject({ changed: false, line: '[ok] click [1] link "A" -> no change' });
});
