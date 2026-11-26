import { describe, expect, test } from "vitest";
import {
  classifyClick, draftRecipe, MAX_RECIPE_STEPS, originOf, recipeUrl, sameApprovedElement, stepRisk, validateRecipe,
  type LiveElement, type Recipe, type RecordedEvent,
} from "../src/web-task.ts";

const el = (role: string, name: string, extra: Partial<LiveElement> = {}): LiveElement => ({ role, name, nth: 0, pageHasForm: false, ...extra });

const recipe = (over: Partial<Recipe> = {}): Recipe => ({
  format: 1,
  id: "r1a2b3",
  version: 1,
  name: "Reorder my usual",
  kind: "reorder",
  origin: "https://shop.example.com",
  params: [{ name: "quantity", label: "Quantity", kind: "number", required: true }],
  steps: [
    { op: "open", path: "/orders" },
    { op: "click", target: { role: "link", name: "Buy again", nth: 0 } },
    { op: "fill", target: { role: "textbox", name: "Quantity" }, value: { param: "quantity" } },
    { op: "click", target: { role: "button", name: "Place order" }, commit: "spend" },
    { op: "read", question: "What is the order number?" },
  ],
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

describe("validateRecipe (FR-WEB-10: Hermit's own format, code-owned and versioned)", () => {
  test("a well-formed recipe is accepted as it is", () => {
    const r = recipe();
    expect(validateRecipe(r)).toEqual({ ok: true, recipe: r });
  });

  test("the origin must be an exact https origin: no path, no http, no credentials, no default port", () => {
    for (const origin of ["http://shop.example.com", "https://shop.example.com/", "https://shop.example.com/orders", "https://u:p@shop.example.com", "https://shop.example.com:443", "shop.example.com", "https://localhost"]) {
      const v = validateRecipe(recipe({ origin }));
      expect(v.ok, origin).toBe(false);
    }
    expect(validateRecipe(recipe({ origin: "https://shop.example.com:8443" })).ok).toBe(true);
  });

  test("every navigation stays on the recipe's origin: paths only, never another site", () => {
    for (const path of ["https://evil.example/x", "//evil.example/x", "orders", "/a\\b", "/a b", "/x\n", ""]) {
      const v = validateRecipe(recipe({ steps: [{ op: "open", path }, ...recipe().steps.slice(1)] }));
      expect(v.ok, JSON.stringify(path)).toBe(false);
    }
  });

  test("the first step opens a page and there are at most 15 steps (FR-WEB-06)", () => {
    const first = validateRecipe(recipe({ steps: recipe().steps.slice(1) }));
    expect(first.ok).toBe(false);
    const many = Array.from({ length: MAX_RECIPE_STEPS }, () => ({ op: "click" as const, target: { role: "button", name: "Next" } }));
    const long = validateRecipe(recipe({ steps: [{ op: "open", path: "/" }, ...many], params: [] }));
    expect(long.ok).toBe(false);
    if (!long.ok) expect(long.problems.map((p) => p.code)).toContain("steps");
  });

  test("a value names a declared parameter, and every parameter is used", () => {
    const unknown = validateRecipe(recipe({ steps: [{ op: "open", path: "/" }, { op: "fill", target: { role: "textbox", name: "Q" }, value: { param: "other" } }] }));
    expect(unknown.ok).toBe(false);
    const unused = validateRecipe(recipe({ params: [...recipe().params, { name: "note", label: "Note", kind: "text", required: false }] }));
    expect(unused.ok).toBe(false);
  });

  test("unknown task kinds, steps and roles are refused (only the known task kinds, FR-WEB-06)", () => {
    expect(validateRecipe(recipe({ kind: "browse" as never })).ok).toBe(false);
    expect(validateRecipe(recipe({ steps: [{ op: "open", path: "/" }, { op: "eval", code: "x" } as never] })).ok).toBe(false);
    expect(validateRecipe(recipe({ steps: [{ op: "open", path: "/" }, { op: "click", target: { role: "iframe", name: "x" } }], params: [] })).ok).toBe(false);
  });

  test("a choice parameter carries its options; a profile value names a profile kind", () => {
    const choice = recipe({
      params: [{ name: "time", label: "Time", kind: "choice", required: true }],
      steps: [{ op: "open", path: "/" }, { op: "select", target: { role: "combobox", name: "Time" }, value: { param: "time" } }],
    });
    expect(validateRecipe(choice).ok).toBe(false);
    const profile = recipe({ params: [], steps: [{ op: "open", path: "/" }, { op: "fill", target: { role: "textbox", name: "Email" }, value: { profile: "email" } }] });
    expect(validateRecipe(profile).ok).toBe(true);
    const badProfile = recipe({ params: [], steps: [{ op: "open", path: "/" }, { op: "fill", target: { role: "textbox", name: "Card" }, value: { profile: "card_number" as never } }] });
    expect(validateRecipe(badProfile).ok).toBe(false);
  });

  test("garbage is refused, never thrown", () => {
    for (const raw of [null, 1, "x", [], { format: 2 }, { ...recipe(), steps: "x" }, { ...recipe(), params: [null] }]) {
      expect(validateRecipe(raw).ok).toBe(false);
    }
  });
});

describe("recipeUrl and originOf: navigation is bound to the exact origin", () => {
  test("a path joins the recipe's origin", () => {
    expect(recipeUrl(recipe(), "/orders?x=1")).toBe("https://shop.example.com/orders?x=1");
  });

  test("originOf reads the exact origin of a page, and nothing that isn't web", () => {
    expect(originOf("https://Shop.Example.com/orders?x")).toBe("https://shop.example.com");
    expect(originOf("https://shop.example.com:443/")).toBe("https://shop.example.com");
    expect(originOf("https://shop.example.com.evil.example/")).toBe("https://shop.example.com.evil.example");
    expect(originOf("javascript:alert(1)")).toBeUndefined();
    expect(originOf("about:blank")).toBeUndefined();
  });
});

describe("classifyClick (FR-WEB-07): code decides which clicks commit; err toward asking", () => {
  test("pay and order buttons are spend, in English and Spanish", () => {
    for (const name of ["Place order", "Pay now", "Buy now", "Realizar pedido", "Pagar", "Confirmar compra"]) expect(classifyClick(el("button", name)), name).toBe("spend");
  });

  test("money next to a generic Continue is spend", () => {
    expect(classifyClick(el("button", "Continue", { nearby: "Total $23.40" }))).toBe("spend");
    expect(classifyClick(el("button", "Continuar ₡12 500"))).toBe("spend");
  });

  test("sign in and grant are credential", () => {
    for (const name of ["Sign in", "Log in", "Iniciar sesión", "Authorize", "Permitir"]) expect(classifyClick(el("button", name)), name).toBe("credential");
  });

  test("submit, book, send and delete are remote writes", () => {
    for (const name of ["Submit", "Book table", "Reservar", "Send", "Delete account", "Cancelar pedido", "Enviar"]) expect(classifyClick(el("button", name)), name).toBe("remote_write");
  });

  test("navigation into a flow does not ask", () => {
    for (const name of ["Add to cart", "Buy again", "Proceed to checkout", "Your orders", "Ver carrito"]) expect(classifyClick(el("link", name)), name).toBeNull();
  });

  test("an unclassifiable button on a page with a form defaults to remote_write; a field is never a click", () => {
    expect(classifyClick(el("button", "Go", { pageHasForm: true }))).toBe("remote_write");
    expect(classifyClick(el("button", "Go"))).toBeNull();
    expect(classifyClick(el("textbox", "Place order"))).toBeNull();
  });

  test("a submit-type button or a link whose action posts a form asks", () => {
    expect(classifyClick(el("button", "OK", { submits: true }))).toBe("remote_write");
  });
});

describe("stepRisk: what the recipe recorded and what the live page says, the stricter one wins", () => {
  test("a recorded commit stays a commit even if the live button looks harmless", () => {
    expect(stepRisk({ op: "click", target: { role: "button", name: "Next" }, commit: "remote_write" }, el("button", "Next"))).toBe("remote_write");
  });

  test("a live commit is a commit even if the recipe didn't record one", () => {
    expect(stepRisk({ op: "click", target: { role: "button", name: "Place order" } }, el("button", "Place order"))).toBe("spend");
  });

  test("spend outranks credential outranks remote_write", () => {
    expect(stepRisk({ op: "click", target: { role: "button", name: "x" }, commit: "remote_write" }, el("button", "Pay"))).toBe("spend");
    expect(stepRisk({ op: "click", target: { role: "button", name: "x" }, commit: "spend" }, el("button", "Sign in"))).toBe("spend");
  });

  test("fills, selects and waits never commit on their own", () => {
    expect(stepRisk({ op: "fill", target: { role: "textbox", name: "Pay" }, value: { literal: "x" } }, el("textbox", "Pay"))).toBeNull();
  });
});

describe("sameApprovedElement (FR-WEB-09): after the approval the element must still be what the sheet showed", () => {
  const shown = el("button", "Place order", { form: { id: "f1", action: "https://shop.example.com/checkout", fields: [] } });

  test("the same role, name, origin and form target pass", () => {
    expect(sameApprovedElement({ element: shown, origin: "https://shop.example.com" }, { element: { ...shown }, origin: "https://shop.example.com" })).toBe(true);
  });

  test("a renamed button, another origin or a new form target cancels", () => {
    const base = { element: shown, origin: "https://shop.example.com" };
    expect(sameApprovedElement(base, { element: { ...shown, name: "Place order + gift card" }, origin: base.origin })).toBe(false);
    expect(sameApprovedElement(base, { element: shown, origin: "https://evil.example" })).toBe(false);
    expect(sameApprovedElement(base, { element: { ...shown, form: { id: "f1", action: "https://evil.example/steal", fields: [] } }, origin: base.origin })).toBe(false);
    expect(sameApprovedElement(base, { element: { ...shown, role: "link" }, origin: base.origin })).toBe(false);
    expect(sameApprovedElement(base, { element: { ...shown, form: { id: "f1", action: "https://shop.example.com/checkout", target: "_blank", fields: [] } }, origin: base.origin })).toBe(false);
  });

  test("changed field values since the sheet cancel too", () => {
    const withFields = el("button", "Book", { form: { id: "f", fields: [{ label: "People", value: "2", secret: false }] } });
    const changed = el("button", "Book", { form: { id: "f", fields: [{ label: "People", value: "20", secret: false }] } });
    expect(sameApprovedElement({ element: withFields, origin: "https://a.example" }, { element: changed, origin: "https://a.example" })).toBe(false);
  });
});

describe("draftRecipe: the user did the task; code turns it into a recipe draft the user saves", () => {
  const events: RecordedEvent[] = [
    { kind: "fill", target: { role: "textbox", name: "Email" }, value: "ana@example.com", secret: false, label: "Email", form: "login" },
    { kind: "fill", target: { role: "textbox", name: "Password" }, value: "hunter2", secret: true, label: "Password", form: "login" },
    { kind: "click", target: { role: "button", name: "Sign in" }, risk: "credential" },
    { kind: "click", target: { role: "link", name: "Reserve a table" }, risk: null },
    { kind: "fill", target: { role: "textbox", name: "People" }, value: "1", secret: false, label: "People" },
    { kind: "fill", target: { role: "textbox", name: "People" }, value: "4", secret: false, label: "People" },
    { kind: "select", target: { role: "combobox", name: "Time" }, value: "20:00", label: "Time", options: ["19:00", "20:00"] },
    { kind: "click", target: { role: "button", name: "Book" }, risk: "remote_write" },
  ];

  test("the start page, the steps in order, the user's values as parameters with their defaults", () => {
    const d = draftRecipe({ startUrl: "https://eat.example.com/login?next=/", events, name: "Table for 4", kind: "book", now: 5, id: "abc" });
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(d.recipe.origin).toBe("https://eat.example.com");
    expect(d.recipe.steps[0]).toEqual({ op: "open", path: "/login?next=/" });
    expect(d.recipe.steps.map((s) => s.op)).toEqual(["open", "login", "click", "click", "fill", "select", "click"]);
    expect(d.recipe.params).toEqual([
      { name: "people", label: "People", kind: "text", required: true, default: "4" },
      { name: "time", label: "Time", kind: "choice", options: ["19:00", "20:00"], required: true, default: "20:00" },
    ]);
    expect(d.recipe.steps.at(-1)).toEqual({ op: "click", target: { role: "button", name: "Book" }, commit: "remote_write" });
    expect(validateRecipe(d.recipe).ok).toBe(true);
  });

  test("a password is never recorded: its form becomes a vault login step, the username too", () => {
    const d = draftRecipe({ startUrl: "https://eat.example.com/", events, name: "x", kind: "book", now: 1, id: "abc" });
    expect(JSON.stringify(d)).not.toContain("hunter2");
    expect(JSON.stringify(d)).not.toContain("ana@example.com");
  });

  test("the start page can't be plain http, and too many steps can't be saved", () => {
    expect(draftRecipe({ startUrl: "http://eat.example.com/", events: [], name: "x", kind: "book", now: 1, id: "a" }).ok).toBe(false);
    const many: RecordedEvent[] = Array.from({ length: 20 }, (_, i) => ({ kind: "click", target: { role: "link", name: `Page ${i}` }, risk: null }));
    const long = draftRecipe({ startUrl: "https://eat.example.com/", events: many, name: "x", kind: "book", now: 1, id: "a" });
    expect(long).toEqual({ ok: false, reason: "too_long" });
  });

  test("a value the user marks as fixed is kept as is instead of asked each time", () => {
    const d = draftRecipe({ startUrl: "https://eat.example.com/", events, name: "x", kind: "book", now: 1, id: "abc", fixed: ["time"] });
    expect(d.ok && d.recipe.params.map((p) => p.name)).toEqual(["people"]);
    expect(d.ok && d.recipe.steps.find((s) => s.op === "select")).toEqual({ op: "select", target: { role: "combobox", name: "Time" }, value: { literal: "20:00" } });
  });

  test("a question to answer at the end adds a read step", () => {
    const d = draftRecipe({ startUrl: "https://eat.example.com/", events: [], name: "x", kind: "status", now: 1, id: "abc", question: "What is the status?" });
    expect(d.ok && d.recipe.steps).toEqual([{ op: "open", path: "/" }, { op: "read", question: "What is the status?" }]);
  });
});
