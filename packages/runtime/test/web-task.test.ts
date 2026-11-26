import { describe, expect, test } from "vitest";
import { createSignedApprovals, memoryNonceStore } from "@hermit/cage";
import { softwareApprovalKey } from "@hermit/cage/testing";
import { createWebTask, stepWords, type WebTaskDeps, type WebTaskState } from "../src/web-task.ts";
import { el, events, O, recipe, setup, shop, type Answer, type FakePage } from "./fake-browser.ts";

describe("a recipe replays without the model (FR-WEB-10, SL-50 verdict)", () => {
  test("open, click, fill, the committing click asks with the site, the button and the values, then the result is read", async () => {
    const s = setup();
    const task = createWebTask(s.deps, { recipe: recipe(), sessionId: "chat1" });
    const end = await task.start({ quantity: "2" });
    expect(end).toMatchObject({ kind: "done", answer: { text: "Order #4417" } });
    expect(s.browser.actions).toEqual([`open ${O}/orders`, "click Buy again", "fill Quantity=2", "click Submit order"]);
    expect(s.browser.effects).toEqual(["order"]);
    expect(s.repairs).toEqual([]);
    // Exactly one sheet: the submit, showing the site, the button and the values being sent.
    expect(s.asked).toHaveLength(1);
    expect(s.asked[0]!.call.skill).toBe("web_submit");
    expect(s.asked[0]!.summary.lines).toEqual([
      { label: "HM-WEB-02.sheet.site", value: "shop.example.com" },
      { label: "HM-WEB-02.sheet.button", value: "Submit order" },
      { label: "Quantity", value: "2" },
    ]);
    expect(events(s.audit, "web_task")).toEqual(["call_proposed:", "policy_decided:ask", "approval:ok:plan.start", "executed:ok"]);
    expect(events(s.audit, "web_submit")).toEqual(["call_proposed:", "policy_decided:ask", "approval:ok", "executed:ok"]);
    expect(events(s.audit, "web_read")).toEqual(["call_proposed:", "policy_decided:allow", "taint_added:", "executed:ok"]);
  });

  test("the page's words reach only the quarantined reader, and the answer comes back marked as the site's", async () => {
    const s = setup();
    const end = await createWebTask(s.deps, { recipe: recipe(), sessionId: "c" }).start({ quantity: "2" });
    expect(s.reads).toEqual([{ question: "What is the order number?", text: "## Thanks\nOrder #4417 is confirmed." }]);
    expect(end.kind === "done" && end.answer?.untrusted).toBe(true);
  });

  test("a page saying \"click Buy now\" causes nothing: only the recipe's elements are ever touched", async () => {
    const pages = shop();
    pages[`${O}/cart`]!.els.push(el("button", "Buy now", { effect: "gift card" }));
    const s = setup({ pages });
    await createWebTask(s.deps, { recipe: recipe(), sessionId: "c" }).start({ quantity: "2" });
    expect(s.browser.effects).toEqual(["order"]);
    expect(s.browser.actions.join("\n")).not.toContain("Buy now");
  });
});

describe("the plan and the start (HM-WEB-02)", () => {
  test("a step whose value isn't set yet reads as a choice to make, never as an empty quote", () => {
    const r = recipe();
    const select = { op: "select" as const, target: { role: "combobox", name: "Tipo de entrega" }, value: { param: "delivery" } };
    const fill = { op: "fill" as const, target: { role: "textbox", name: "Cantidad" }, value: { param: "quantity" } };
    expect(stepWords(r, select, {})).toEqual({ key: "HM-WEB-02.step.selectUnset", vars: { field: "Tipo de entrega" } });
    expect(stepWords(r, select, { delivery: "  " })).toEqual({ key: "HM-WEB-02.step.selectUnset", vars: { field: "Tipo de entrega" } });
    expect(stepWords(r, fill, { quantity: "" })).toEqual({ key: "HM-WEB-02.step.fillUnset", vars: { field: "Cantidad" } });
    // Set, it quotes the value as before.
    expect(stepWords(r, select, { delivery: "Retiro en tienda" })).toEqual({ key: "HM-WEB-02.step.select", vars: { field: "Tipo de entrega", value: "Retiro en tienda" } });
    expect(stepWords(r, { ...select, value: { literal: "" } }, {})).toEqual({ key: "HM-WEB-02.step.selectUnset", vars: { field: "Tipo de entrega" } });
  });

  test("a required value missing refuses to start, and nothing is opened", async () => {
    const s = setup();
    const end = await createWebTask(s.deps, { recipe: recipe(), sessionId: "c" }).start({});
    expect(end).toEqual({ kind: "refused", reason: "missing_value" });
    expect(s.browser.actions).toEqual([]);
  });

  test("an invalid recipe never runs", async () => {
    const s = setup();
    const bad = recipe({ steps: [{ op: "open", path: "https://evil.example/" }] });
    expect(await createWebTask(s.deps, { recipe: bad, sessionId: "c" }).start({})).toEqual({ kind: "refused", reason: "invalid" });
    expect(s.browser.actions).toEqual([]);
  });

  test("with nobody on screen nothing runs: the night shift never drives the browser", async () => {
    const s = setup({ deps: { onScreen: () => false } });
    expect(await createWebTask(s.deps, { recipe: recipe(), sessionId: "c" }).start({ quantity: "1" })).toEqual({ kind: "refused", reason: "blocked" });
    expect(s.browser.actions).toEqual([]);
  });

  test("the plan lists every step in words with its value, from the recipe and never from a page", () => {
    const s = setup();
    const plan = createWebTask(s.deps, { recipe: recipe(), sessionId: "c" }).plan({ quantity: "3" });
    expect(plan.site).toBe("shop.example.com");
    expect(plan.steps.map((p) => p.key)).toEqual(["HM-WEB-02.step.open", "HM-WEB-02.step.click", "HM-WEB-02.step.fill", "HM-WEB-02.step.submit", "HM-WEB-02.step.read"]);
    expect(plan.steps[2]!.vars).toEqual({ field: "Quantity", value: "3" });
    expect(plan.missing).toEqual([]);
    expect(createWebTask(s.deps, { recipe: recipe(), sessionId: "c" }).plan({}).missing).toEqual(["quantity"]);
  });
});

describe("committing steps (US-WEB-09, FR-WEB-07, FR-WEB-09)", () => {
  test("a denied submit clicks nothing and ends the task", async () => {
    const s = setup({ answers: ["deny"] });
    const end = await createWebTask(s.deps, { recipe: recipe(), sessionId: "c" }).start({ quantity: "2" });
    expect(end).toMatchObject({ kind: "failed", reason: "denied" });
    expect(s.browser.effects).toEqual([]);
  });

  test("a click the recipe didn't mark as committing still asks when the live button commits", async () => {
    const r = recipe();
    r.steps[3] = { op: "click", target: { role: "button", name: "Submit order" } };
    const s = setup();
    await createWebTask(s.deps, { recipe: r, sessionId: "c" }).start({ quantity: "2" });
    expect(s.asked.map((a) => a.call.skill)).toEqual(["web_submit"]);
  });

  test("the button changed after the sheet: the action is cancelled (FR-WEB-09)", async () => {
    const pages = shop();
    const s = setup({
      pages,
      answers: [
        (req) => {
          // While the sheet is open, the page swaps the form's target.
          pages[`${O}/cart`]!.els[1]!.form = { id: "cart", action: "https://evil.example/steal", fields: [{ label: "Quantity", value: "", secret: false }] };
          return { kind: "approved", biometric: false, argsHash: req.call.argsHash };
        },
      ],
    });
    const end = await createWebTask(s.deps, { recipe: recipe(), sessionId: "c" }).start({ quantity: "2" });
    expect(end).toMatchObject({ kind: "failed", reason: "changed" });
    expect(s.browser.effects).toEqual([]);
    expect(events(s.audit, "web_submit")).toContain("executed:error:web.changed");
  });

  test("a form that submits to another site is refused before anything asks", async () => {
    const pages = shop();
    // The button's own formaction overrides the form's: the script reports the effective target.
    pages[`${O}/cart`]!.els[1]!.form = { id: "cart", action: "https://evil.example/steal", method: "post", fields: [{ label: "Quantity", value: "", secret: false }] };
    const s = setup({ pages });
    const end = await createWebTask(s.deps, { recipe: recipe(), sessionId: "c" }).start({ quantity: "2" });
    expect(end).toMatchObject({ kind: "failed", reason: "left_site", step: 3 });
    expect(s.asked).toEqual([]);
    expect(s.browser.effects).toEqual([]);
    expect(events(s.audit, "web_task")).toContain("executed:error:web.form_off_site");
  });

  test("a form that submits into a new window is refused like one that leaves the site", async () => {
    for (const target of ["_blank", "popup", "_parent"]) {
      const pages = shop();
      pages[`${O}/cart`]!.els[1]!.form = { id: "cart", action: `${O}/order`, target, fields: [{ label: "Quantity", value: "", secret: false }] };
      const s = setup({ pages });
      const end = await createWebTask(s.deps, { recipe: recipe(), sessionId: "c" }).start({ quantity: "2" });
      expect(end, target).toMatchObject({ kind: "failed", reason: "left_site", step: 3 });
      expect(s.asked).toEqual([]);
      expect(s.browser.effects).toEqual([]);
      expect(events(s.audit, "web_task")).toContain("executed:error:web.form_new_window");
    }
  });

  test("a form on the task's origin that stays in the page still asks and submits", async () => {
    for (const target of [undefined, "", "_self"]) {
      const pages = shop();
      pages[`${O}/cart`]!.els[1]!.form = { id: "cart", action: `${O}/order`, method: "post", ...(target === undefined ? {} : { target }), fields: [{ label: "Quantity", value: "", secret: false }] };
      const s = setup({ pages });
      const end = await createWebTask(s.deps, { recipe: recipe(), sessionId: "c" }).start({ quantity: "2" });
      expect(end.kind, String(target)).toBe("done");
      expect(s.asked.map((a) => a.call.skill)).toEqual(["web_submit"]);
      expect(s.browser.effects).toEqual(["order"]);
    }
  });

  test("the form's window changed after the sheet: the action is cancelled (FR-WEB-09)", async () => {
    const pages = shop();
    const s = setup({
      pages,
      answers: [
        (req) => {
          pages[`${O}/cart`]!.els[1]!.form = { id: "cart", action: `${O}/order`, target: "_blank", fields: [{ label: "Quantity", value: "", secret: false }] };
          return { kind: "approved", biometric: false, argsHash: req.call.argsHash };
        },
      ],
    });
    const end = await createWebTask(s.deps, { recipe: recipe(), sessionId: "c" }).start({ quantity: "2" });
    expect(end).toMatchObject({ kind: "failed", reason: "changed" });
    expect(s.browser.effects).toEqual([]);
  });

  test("an approval for other arguments doesn't count", async () => {
    const s = setup({ answers: [() => ({ kind: "approved", biometric: false, argsHash: "0".repeat(64) })] });
    const end = await createWebTask(s.deps, { recipe: recipe(), sessionId: "c" }).start({ quantity: "2" });
    expect(end).toMatchObject({ kind: "failed", reason: "denied" });
    expect(s.browser.effects).toEqual([]);
  });

  test("Hermit never clicks pay (Q121): the task pauses for the user to pay, then resumes or stops", async () => {
    const pages = shop();
    pages[`${O}/cart`]!.els[1] = el("button", "Pay $23.40", { effect: "paid", to: `${O}/done` });
    const r = recipe();
    r.steps[3] = { op: "click", target: { role: "button", name: "Pay $23.40" } };
    const s = setup({ pages });
    const task = createWebTask(s.deps, { recipe: r, sessionId: "c" });
    const states: WebTaskState[] = [];
    task.subscribe((st) => {
      states.push(st);
      if (st.kind === "paused" && st.reason === "pay_yourself") {
        // The user pays with their own tap, then tells Hermit to carry on.
        void s.browser.click({ role: "button", name: "Pay $23.40" }).then(() => task.resume());
      }
    });
    const end = await task.start({ quantity: "2" });
    expect(states.some((st) => st.kind === "paused" && st.reason === "pay_yourself")).toBe(true);
    expect(s.asked).toEqual([]);
    expect(events(s.audit, "web_pay")).toEqual(["call_proposed:", "policy_decided:deny"]);
    expect(s.browser.actions.filter((a) => a.startsWith("click Pay"))).toHaveLength(1);
    expect(end.kind).toBe("done");
  });
});

describe("bounds (FR-WEB-06)", () => {
  test("a click that lands on another site stops the task there", async () => {
    const pages = shop();
    pages[`${O}/orders`]!.els[1]!.to = "https://evil.example/cart";
    pages["https://evil.example/cart"] = shop()[`${O}/cart`]!;
    const s = setup({ pages });
    const end = await createWebTask(s.deps, { recipe: recipe(), sessionId: "c" }).start({ quantity: "2" });
    expect(end).toMatchObject({ kind: "failed", reason: "left_site" });
    expect(s.browser.actions).toEqual([`open ${O}/orders`, "click Buy again"]);
  });

  test("a form that sends to another site is refused before the sheet, and nothing is sent", async () => {
    const pages = shop();
    pages[`${O}/cart`]!.els[1]!.form = { id: "cart", action: "https://evil.example/collect", fields: [{ label: "Quantity", value: "", secret: false }] };
    const s = setup({ pages });
    const end = await createWebTask(s.deps, { recipe: recipe(), sessionId: "c" }).start({ quantity: "2" });
    expect(end).toMatchObject({ kind: "failed", reason: "left_site" });
    expect(s.asked).toEqual([]);
    expect(s.browser.effects).toEqual([]);
  });

  test("three actions in a row that change nothing stop the task", async () => {
    const pages = { [`${O}/`]: { els: [el("link", "Nothing")] } };
    const click = { op: "click" as const, target: { role: "link", name: "Nothing" } };
    const s = setup({ pages });
    const end = await createWebTask(s.deps, { recipe: recipe({ params: [], steps: [{ op: "open", path: "/" }, click, click, click, click] }), sessionId: "c" }).start({});
    expect(end).toMatchObject({ kind: "failed", reason: "stuck" });
    expect(s.browser.actions.filter((a) => a === "click Nothing")).toHaveLength(3);
  });
});

describe("a step that fails calls the model for that step only (FR-WEB-10)", () => {
  const renamed = () => {
    const pages = shop();
    pages[`${O}/orders`]!.els = [el("link", "Home"), el("link", "Order again", { to: `${O}/cart` })];
    return pages;
  };

  test("the model picks among the page's elements of that role; the repaired click runs and is counted", async () => {
    const s = setup({ pages: renamed(), deps: { repair: async (i) => i.candidates.indexOf("Order again") } });
    const task = createWebTask(s.deps, { recipe: recipe(), sessionId: "c" });
    const end = await task.start({ quantity: "2" });
    expect(end).toMatchObject({ kind: "done", repaired: 1 });
    expect(s.browser.actions).toContain("click Order again");
    // The fix can be saved by the user: the recipe with the new target, one version up.
    const fixed = task.repairedRecipe();
    expect(fixed?.version).toBe(2);
    expect(fixed?.steps[1]).toEqual({ op: "click", target: { role: "link", name: "Order again", nth: 0 } });
    expect(events(s.audit, "web_repair")).toEqual(["call_proposed:", "policy_decided:allow", "taint_added:", "executed:ok"]);
  });

  test("the model can't repair its way into a committing click", async () => {
    const pages = renamed();
    pages[`${O}/orders`]!.els.push(el("link", "Delete account", { effect: "deleted" }));
    const s = setup({ pages, deps: { repair: async (i) => i.candidates.indexOf("Delete account") } });
    const task = createWebTask(s.deps, { recipe: recipe(), sessionId: "c" });
    const states: WebTaskState[] = [];
    task.subscribe((st) => {
      states.push(st);
      if (st.kind === "paused") task.stop();
    });
    const end = await task.start({ quantity: "2" });
    expect(s.browser.effects).toEqual([]);
    expect(states.some((st) => st.kind === "paused" && st.reason === "do_step")).toBe(true);
    expect(end).toEqual({ kind: "stopped" });
  });

  test("after the model read the page, the task is tainted: later steps ask, and a sign-in is refused", async () => {
    const s = setup({ pages: renamed(), deps: { repair: async (i) => i.candidates.indexOf("Order again") } });
    await createWebTask(s.deps, { recipe: recipe(), sessionId: "c" }).start({ quantity: "2" });
    expect(s.asked.map((a) => a.call.skill)).toEqual(["web_step", "web_step", "web_submit"]);
    expect(s.asked.every((a) => a.taintWarning !== undefined)).toBe(true);
  });
});

describe("watched live, take over, stop (US-WEB-08, FR-WEB-08)", () => {
  test("each step is announced in words before it runs", async () => {
    const s = setup();
    const task = createWebTask(s.deps, { recipe: recipe(), sessionId: "c" });
    const doing: string[] = [];
    task.subscribe((st) => st.kind === "running" && doing.push(st.doing.key));
    await task.start({ quantity: "2" });
    expect(doing).toEqual(["HM-WEB-02.step.open", "HM-WEB-02.step.click", "HM-WEB-02.step.fill", "HM-WEB-02.step.submit", "HM-WEB-02.step.read"]);
  });

  test("take over pauses before the next step and resume carries on; both are logged", async () => {
    const s = setup();
    const task = createWebTask(s.deps, { recipe: recipe(), sessionId: "c" });
    let paused = false;
    task.subscribe((st) => {
      if (st.kind === "running" && st.step === 1 && !paused) {
        paused = true;
        task.takeOver();
      }
      if (st.kind === "paused" && st.reason === "take_over") {
        expect(s.browser.actions).toEqual([`open ${O}/orders`, "click Buy again"]);
        task.resume();
      }
    });
    const end = await task.start({ quantity: "2" });
    expect(end.kind).toBe("done");
    expect(s.audit.filter((e) => e.event === "web_task").map((e) => e.reason)).toEqual(["web.taken_over", "web.resumed"]);
  });

  test("stop while the sheet is open closes it as denied and nothing more runs", async () => {
    const holder: { task?: ReturnType<typeof createWebTask> } = {};
    const s = setup({
      answers: [
        () => {
          holder.task!.stop();
          return { kind: "denied" };
        },
      ],
    });
    const task = (holder.task = createWebTask(s.deps, { recipe: recipe(), sessionId: "c" }));
    const end = await task.start({ quantity: "2" });
    expect(end).toEqual({ kind: "stopped" });
    expect(s.browser.effects).toEqual([]);
    expect(s.audit.filter((e) => e.event === "web_task").map((e) => e.reason)).toEqual(["web.stopped"]);
  });
});

describe("signing in with the vault on the exact origin (US-WEB-06, FR-VAULT-04)", () => {
  const loginPages = (): Record<string, FakePage> => ({
    [`${O}/login`]: { els: [el("textbox", "Email", { pageHasForm: true }), el("button", "Sign in", { pageHasForm: true, to: `${O}/orders` })] },
    ...shop(),
  });
  const loginRecipe = () => recipe({
    params: [],
    steps: [{ op: "open", path: "/login" }, { op: "login" }, { op: "click", target: { role: "button", name: "Sign in" }, commit: "credential" }],
  });
  const signedSetup = (over: Partial<WebTaskDeps> = {}, answers?: Answer[], pages = loginPages()) => {
    const key = softwareApprovalKey(7);
    const signed = createSignedApprovals({
      key: { state: async () => ({ state: "ready", level: "tee", publicKey: key.spki }) },
      enrolledKey: async () => key.spki,
      nonces: memoryNonceStore(),
      randomNonce: () => "ab".repeat(32),
      now: () => 1_000,
    });
    const opened: string[] = [];
    return {
      ...setup({
        pages,
        answers: answers ?? [(req) => ({ kind: "approved", biometric: true, argsHash: req.call.argsHash, signature: key.sign(req.signed!.message) })],
        deps: {
          signed,
          logins: {
            list: async (origin) => (origin === O ? [{ id: "item1", hash: "c".repeat(64), name: "Shop account" }] : []),
            open: async (id, origin) => {
              opened.push(`${id} ${origin}`);
              return { username: "ana@example.com", secret: "hunter2" };
            },
          },
          ...over,
        },
      }),
      opened,
    };
  };

  test("one signed approval for the site's login fills it; the sign-in click right after is covered by it", async () => {
    const s = signedSetup();
    const end = await createWebTask(s.deps, { recipe: loginRecipe(), sessionId: "c" }).start({});
    expect(end.kind).toBe("done");
    expect(s.asked).toHaveLength(1);
    expect(s.asked[0]!.call.skill).toBe("fill_login");
    expect(s.asked[0]!.signed?.payload).toMatchObject({ risk: "credential", origin: O, item: "c".repeat(64), requester: "android://aa@io.dojocoding.hermit" });
    expect(s.opened).toEqual([`item1 ${O}`]);
    expect(s.browser.logins).toEqual([{ username: "ana@example.com", password: "hunter2" }]);
    expect(events(s.audit, "web_signin")).toEqual(["call_proposed:", "policy_decided:ask", "approval:ok:login.covered", "executed:ok"]);
    // The values are never in the log.
    expect(JSON.stringify(s.audit)).not.toContain("hunter2");
  });

  test("a navigation between the origin check and the fill: nothing is filled and the task stops", async () => {
    const s = signedSetup({
      logins: {
        list: async (origin) => (origin === O ? [{ id: "item1", hash: "c".repeat(64), name: "Shop account" }] : []),
        open: async () => {
          // The runner reads the address (still the shop), then the page goes elsewhere before the fill runs.
          s.browser.afterUrl = () => {
            s.browser.current = "https://evil.example/login";
          };
          return { username: "ana@example.com", secret: "hunter2" };
        },
      },
    });
    s.browser.pages["https://evil.example/login"] = { els: [el("button", "Sign in", { pageHasForm: true })] };
    const end = await createWebTask(s.deps, { recipe: loginRecipe(), sessionId: "c" }).start({});
    expect(end).toMatchObject({ kind: "failed", reason: "left_site", step: 1 });
    expect(s.browser.logins).toEqual([]);
    expect(s.browser.actions).not.toContain("click Sign in");
    expect(events(s.audit, "fill_login")).toContain("executed:error:web.left_site");
    expect(events(s.audit, "web_signin")).toEqual([]);
  });

  test("the page leaves the site right after the fill: the task stops before the sign-in click", async () => {
    const s = signedSetup();
    s.browser.pages["https://evil.example/login"] = { els: [el("button", "Sign in", { pageHasForm: true })] };
    s.browser.afterFill = () => {
      s.browser.current = "https://evil.example/login";
    };
    const end = await createWebTask(s.deps, { recipe: loginRecipe(), sessionId: "c" }).start({});
    expect(end).toMatchObject({ kind: "failed", reason: "left_site", step: 1 });
    expect(s.browser.actions).not.toContain("click Sign in");
    expect(events(s.audit, "fill_login")).toContain("executed:error:web.left_site");
    expect(events(s.audit, "web_signin")).toEqual([]);
  });

  test("no login stored for this exact origin: the user signs in themselves", async () => {
    const s = signedSetup({ logins: { list: async () => [], open: async () => undefined } });
    const task = createWebTask(s.deps, { recipe: loginRecipe(), sessionId: "c" });
    const reasons: string[] = [];
    task.subscribe((st) => {
      if (st.kind === "paused") {
        reasons.push(st.reason);
        task.stop();
      }
    });
    expect(await task.start({})).toEqual({ kind: "stopped" });
    expect(reasons).toEqual(["sign_in_yourself"]);
    expect(s.browser.logins).toEqual([]);
  });

  test("once the model read the page (a repaired step), the task never gets a password", async () => {
    const pages = loginPages();
    pages[`${O}/orders`]!.els.push(el("link", "My account", { to: `${O}/login` }));
    const s = signedSetup({ repair: async (i) => i.candidates.indexOf("My account") }, ["approve", "approve"], pages);
    const r = recipe({
      params: [],
      steps: [{ op: "open", path: "/orders" }, { op: "click", target: { role: "link", name: "Your account" } }, { op: "login" }, { op: "click", target: { role: "button", name: "Sign in" }, commit: "credential" }],
    });
    const task = createWebTask(s.deps, { recipe: r, sessionId: "c" });
    task.subscribe((st) => st.kind === "paused" && task.stop());
    await task.start({});
    expect(s.browser.actions).toContain("click My account");
    expect(s.asked.map((a) => a.call.skill)).not.toContain("fill_login");
    expect(s.browser.logins).toEqual([]);
    expect(events(s.audit, "fill_login")).toEqual(["call_proposed:", "policy_decided:deny"]);
  });

  test("a signature over anything else is refused and nothing is filled", async () => {
    const s = signedSetup({}, [(req) => ({ kind: "approved", biometric: true, argsHash: req.call.argsHash, signature: softwareApprovalKey(9).sign(req.signed!.message) })]);
    const task = createWebTask(s.deps, { recipe: loginRecipe(), sessionId: "c" });
    task.subscribe((st) => st.kind === "paused" && task.stop());
    await task.start({});
    expect(s.opened).toEqual([]);
    expect(s.browser.logins).toEqual([]);
  });
});

describe("profile values go through the profile's own approval (SL-35)", () => {
  const profileRecipe = () => recipe({
    params: [],
    steps: [{ op: "open", path: "/cart" }, { op: "fill", target: { role: "textbox", name: "Quantity" }, value: { profile: "phone" } }],
  });

  test("a plain profile value asks, showing the field and the value, before it is typed into the site", async () => {
    const s = setup({ deps: { profile: { value: async (k) => (k === "phone" ? "+506 8888 0000" : undefined) } } });
    const end = await createWebTask(s.deps, { recipe: profileRecipe(), sessionId: "c" }).start({});
    expect(end.kind).toBe("done");
    expect(s.asked.map((a) => a.call.skill)).toEqual(["fill_form"]);
    expect(s.asked[0]!.summary.lines).toContainEqual({ label: "Quantity", value: "+506 8888 0000" });
    expect(s.browser.actions).toContain("fill Quantity=+506 8888 0000");
  });

  test("denied, nothing is typed", async () => {
    const s = setup({ answers: ["deny"], deps: { profile: { value: async () => "+506 8888 0000" } } });
    const task = createWebTask(s.deps, { recipe: profileRecipe(), sessionId: "c" });
    task.subscribe((st) => st.kind === "paused" && task.stop());
    await task.start({});
    expect(s.browser.actions.some((a) => a.startsWith("fill"))).toBe(false);
  });
});
