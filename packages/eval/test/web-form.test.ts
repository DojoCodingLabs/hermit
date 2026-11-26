import { expect, test } from "vitest";
import { fillSchema, formsOf, parseFill } from "../src/web/form.ts";
import { createSim, type Site } from "../src/web/sim.ts";

const site: Site = {
  id: "f",
  origin: "https://f.test",
  start: "p",
  pages: {
    p: {
      title: "Book",
      path: "/",
      nodes: [
        { id: "q", role: "textbox", name: "Search" },
        { id: "party", role: "combobox", name: "Party size", options: ["1", "2"] },
        { id: "t1", role: "radio", name: "7 PM", group: "Time" },
        { id: "t2", role: "radio", name: "9 PM", group: "Time", disabled: true },
        { id: "name", role: "textbox", name: "Name" },
        { id: "notes", role: "textbox", name: "Notes (optional)" },
        { id: "news", role: "textbox", name: "Email for newsletter", form: "newsletter" },
        { id: "go", role: "button", name: "Confirm" },
      ],
    },
  },
};
const snap = createSim(site).snapshot();

test("a page's fields are grouped by form; search boxes and disabled options are left out", () => {
  const forms = formsOf(snap);
  expect(forms.map((f) => [f.id, f.fields.map((x) => [x.key, x.kind, x.optional, x.options ?? null])])).toEqual([
    ["main", [["Party size", "choice", false, ["1", "2"]], ["Time", "radio", false, ["7 PM"]], ["Name", "text", false, null], ["Notes (optional)", "text", true, null]]],
    ["newsletter", [["Email for newsletter", "text", false, null]]],
  ]);
});

test("the fill grammar is one object per form, with the options pinned and optional fields not required", () => {
  const [main] = fillSchema(formsOf(snap)) as Array<{ properties: { form: { const: string }; values: { properties: Record<string, unknown>; required: string[] } } }>;
  expect(main!.properties.form.const).toBe("main");
  expect(main!.properties.values.properties).toEqual({
    "Party size": { type: "string", enum: ["1", "2"] },
    Time: { type: "string", enum: ["7 PM"] },
    Name: { type: "string", maxLength: 80 },
    "Notes (optional)": { type: "string", maxLength: 80 },
  });
  expect(main!.properties.values.required).toEqual(["Party size", "Time", "Name"]);
});

test("a fill becomes the primitive actions code runs, skipping empty optional values", () => {
  const r = parseFill({ form: "main", values: { "Party size": "2", Time: "7 PM", Name: "Ana", "Notes (optional)": "" } }, snap);
  expect(r).toEqual({ ok: true, steps: [{ kind: "select", ref: 2, option: "2" }, { kind: "click", ref: 3 }, { kind: "type", ref: 5, text: "Ana" }] });
  expect(parseFill({ form: "main", values: { Time: "9 PM" } }, snap)).toEqual({ ok: false, error: 'no option "9 PM" for "Time"' });
  expect(parseFill({ form: "nope", values: {} }, snap)).toEqual({ ok: false, error: "no form nope on this page" });
});

test("running a fill applies every value and reports one line", () => {
  const sim = createSim(site);
  sim.snapshot();
  const r = sim.act({ kind: "fill", steps: [{ kind: "select", ref: 2, option: "2" }, { kind: "click", ref: 3 }, { kind: "type", ref: 5, text: "Ana" }] });
  expect(r).toMatchObject({ ok: true, changed: true, line: '[ok] fill: "Party size" = "2"; "7 PM" checked; "Name" = "Ana"' });
  expect(sim.view().fields).toEqual({ party: "2", Time: "7 PM", name: "Ana" });
});
