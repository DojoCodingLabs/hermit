// The theme switch (lib/theme.mjs): the policy allows its two inline scripts by their exact hash and nothing else,
// they stay small and load nothing, and they behave: the head script picks the saved theme or the system, and the
// switch flips it, saves it and keeps aria-pressed and its label true. Run against a small fake DOM.
import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import { CSP_META, SCRIPT_HASHES } from "../lib/csp.mjs";
import { THEME_HEAD_SCRIPT, THEME_KEY, THEME_TOGGLE_SCRIPT } from "../lib/theme.mjs";
import en from "../locales/en.json";
import es from "../locales/es-419.json";

const hash = (text: string) => `sha256-${createHash("sha256").update(text, "utf8").digest("base64")}`;

/** Runs the head script with a saved value (or a storage that throws) and returns the theme it set on <html>. */
function head(saved: string | null | Error): string | undefined {
  const documentElement = { dataset: {} as Record<string, string> };
  const localStorage = {
    getItem: () => {
      if (saved instanceof Error) throw saved;
      return saved;
    },
  };
  new Function("document", "localStorage", THEME_HEAD_SCRIPT)({ documentElement }, localStorage);
  return documentElement.dataset.theme;
}

/** Runs the switch's script on a page whose <html> has `theme`, under a system that is dark or not. */
function toggle(theme: string, systemDark: boolean, withButton = true) {
  const attrs: Record<string, string> = {};
  const store: Record<string, string> = {};
  let press = () => {};
  let systemChanged = () => {};
  const button = {
    dataset: { dark: "Use dark theme", light: "Use light theme" },
    setAttribute: (name: string, value: string) => (attrs[name] = value),
    addEventListener: (_: string, f: () => void) => (press = f),
  };
  const documentElement = { dataset: { theme } as Record<string, string> };
  const media = { matches: systemDark, addEventListener: (_: string, f: () => void) => (systemChanged = f) };
  const document = { documentElement, querySelector: () => (withButton ? button : null) };
  new Function("document", "matchMedia", "localStorage", THEME_TOGGLE_SCRIPT)(document, () => media, { setItem: (k: string, v: string) => (store[k] = v) });
  return { attrs, store, documentElement, media, press: () => press(), systemChanged: () => systemChanged() };
}

describe("the theme scripts", () => {
  test("the policy allows exactly these two scripts, by their hash", () => {
    expect(SCRIPT_HASHES).toEqual([hash(THEME_HEAD_SCRIPT), hash(THEME_TOGGLE_SCRIPT)]);
    expect(CSP_META).toContain(`script-src '${SCRIPT_HASHES[0]}' '${SCRIPT_HASHES[1]}'`);
    expect(CSP_META).not.toMatch(/unsafe-/);
  });

  test("they stay small and load nothing", () => {
    expect(THEME_HEAD_SCRIPT.split("\n")).toHaveLength(2);
    expect(THEME_TOGGLE_SCRIPT.split("\n").length).toBeLessThanOrEqual(14);
    for (const script of [THEME_HEAD_SCRIPT, THEME_TOGGLE_SCRIPT]) {
      expect(script).not.toMatch(/fetch|XMLHttpRequest|WebSocket|import|eval|Function|innerHTML|cookie|\.src\b|createElement/);
    }
  });

  test("before the first paint, <html> gets the saved theme, or follows the system", () => {
    expect(head("dark")).toBe("dark");
    expect(head("light")).toBe("light");
    expect(head(null)).toBe("system");
    expect(head("purple")).toBe("system");
    expect(head(new Error("storage blocked"))).toBe("system");
  });

  test("on a light system, the switch turns dark, saves it, and says so", () => {
    const page = toggle("system", false);
    expect(page.attrs).toEqual({ "aria-pressed": "false", "aria-label": "Use dark theme" });
    page.press();
    expect(page.documentElement.dataset.theme).toBe("dark");
    expect(page.store[THEME_KEY]).toBe("dark");
    expect(page.attrs).toEqual({ "aria-pressed": "true", "aria-label": "Use light theme" });
    page.press();
    expect(page.documentElement.dataset.theme).toBe("light");
    expect(page.store[THEME_KEY]).toBe("light");
    expect(page.attrs["aria-pressed"]).toBe("false");
  });

  test("on a dark system, it starts pressed and turns light", () => {
    const page = toggle("system", true);
    expect(page.attrs).toEqual({ "aria-pressed": "true", "aria-label": "Use light theme" });
    page.press();
    expect(page.documentElement.dataset.theme).toBe("light");
    expect(page.attrs["aria-label"]).toBe("Use dark theme");
  });

  test("a saved choice beats the system, and with no choice a system change is followed", () => {
    expect(toggle("light", true).attrs["aria-pressed"]).toBe("false");
    expect(toggle("dark", false).attrs["aria-pressed"]).toBe("true");
    const page = toggle("system", false);
    page.media.matches = true;
    page.systemChanged();
    expect(page.attrs["aria-pressed"]).toBe("true");
  });

  test("a page without the switch runs the script without an error", () => {
    expect(() => toggle("system", false, false)).not.toThrow();
  });

  test("the switch's labels, in both languages", () => {
    expect([en["common.themeDark"], en["common.themeLight"]]).toEqual(["Use dark theme", "Use light theme"]);
    expect([es["common.themeDark"], es["common.themeLight"]]).toEqual(["Usar tema oscuro", "Usar tema claro"]);
  });
});
