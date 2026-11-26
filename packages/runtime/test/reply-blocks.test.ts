/**
 * Q155: a long answer's structure, for the bubble and for TalkBack. Short headings, numbered steps and bullets are
 * drawn by the design system; markdown symbols never show; nothing in the model's text becomes a link.
 */
import { describe, expect, test } from "vitest";
import { replyBlocks, spokenReply } from "../src/reply-blocks.ts";

const RECIPE = [
  "Arroz con leche para 4 personas.",
  "",
  "Ingredientes:",
  "- 1 taza de arroz",
  "- 1 litro de leche",
  "",
  "Pasos:",
  "1. Lava el arroz.",
  "2. Hiérvelo con la leche y la canela,",
  "revolviendo seguido.",
  "3. Sirve frío.",
].join("\n");

describe("the structure of a reply", () => {
  test("a recipe: a paragraph, headings without their colon, bullets, numbered steps", () => {
    expect(replyBlocks(RECIPE)).toEqual([
      { kind: "paragraph", text: "Arroz con leche para 4 personas." },
      { kind: "heading", text: "Ingredientes" },
      { kind: "bullet", text: "1 taza de arroz", depth: 0 },
      { kind: "bullet", text: "1 litro de leche", depth: 0 },
      { kind: "heading", text: "Pasos" },
      { kind: "step", n: "1", text: "Lava el arroz.", depth: 0 },
      // A line that continues a step stays with it.
      { kind: "step", n: "2", text: "Hiérvelo con la leche y la canela,\nrevolviendo seguido.", depth: 0 },
      { kind: "step", n: "3", text: "Sirve frío.", depth: 0 },
    ]);
  });

  test("a plain reply is one paragraph, its line breaks kept", () => {
    expect(replyBlocks("Mañana tienes dentista a las 9:30.\nY la reunión con Pedro a las 15:00.")).toEqual([
      { kind: "paragraph", text: "Mañana tienes dentista a las 9:30.\nY la reunión con Pedro a las 15:00." },
    ]);
    expect(replyBlocks("Hola.\n\n¿En qué te ayudo?")).toEqual([{ kind: "paragraph", text: "Hola." }, { kind: "paragraph", text: "¿En qué te ayudo?" }]);
    expect(replyBlocks("")).toEqual([]);
  });

  test("markdown is drawn, never shown: #, bold, italics, code ticks, rules, quotes, other bullet signs", () => {
    const md = "## Ingredientes\n**Para la masa:**\n* 2 tazas de *harina*\n• 1 huevo\n· sal\n- __mantequilla__ y `azúcar`\n---\n> Un consejo: no la amases de más.\n1) Mezcla todo.";
    expect(replyBlocks(md)).toEqual([
      { kind: "heading", text: "Ingredientes" },
      { kind: "heading", text: "Para la masa" },
      { kind: "bullet", text: "2 tazas de harina", depth: 0 },
      { kind: "bullet", text: "1 huevo", depth: 0 },
      { kind: "bullet", text: "sal", depth: 0 },
      { kind: "bullet", text: "mantequilla y azúcar", depth: 0 },
      { kind: "paragraph", text: "Un consejo: no la amases de más." },
      { kind: "step", n: "1", text: "Mezcla todo.", depth: 0 },
    ]);
  });

  test("nested items keep one level of indent; 'Paso 2:' and 'Step 3:' are steps", () => {
    expect(replyBlocks("- Verduras\n  - tomate\n    - cebolla\nPaso 2: corta todo.\nStep 3: mix it.")).toEqual([
      { kind: "bullet", text: "Verduras", depth: 0 },
      { kind: "bullet", text: "tomate", depth: 1 },
      { kind: "bullet", text: "cebolla", depth: 1 },
      { kind: "step", n: "2", text: "corta todo.", depth: 0 },
      { kind: "step", n: "3", text: "mix it.", depth: 0 },
    ]);
  });

  test("model text is never a link: a markdown link shows its words and its address as plain text", () => {
    expect(replyBlocks("Mira [la guía oficial](https://example.com/guia) antes.")).toEqual([{ kind: "paragraph", text: "Mira la guía oficial (https://example.com/guia) antes." }]);
  });

  test("a table reads as rows; a sentence ending in a colon mid-paragraph is not a heading", () => {
    expect(replyBlocks("| Ingrediente | Cantidad |\n|---|---|\n| Arroz | 1 taza |")).toEqual([
      { kind: "paragraph", text: "Ingrediente · Cantidad" },
      { kind: "paragraph", text: "Arroz · 1 taza" },
    ]);
    expect(replyBlocks("Te cuento lo que necesitas saber sobre el tema, que es bastante largo de explicar aquí:")[0]!.kind).toBe("paragraph");
  });

  test("snake_case, multiplication and a lone asterisk survive the cleanup", () => {
    expect(replyBlocks("Usa 2*3 tazas; el archivo se llama mi_receta_final.")).toEqual([{ kind: "paragraph", text: "Usa 2*3 tazas; el archivo se llama mi_receta_final." }]);
  });
});

describe("a reply as TalkBack says it", () => {
  test("headings, steps and bullets read as sentences, with no list signs spoken", () => {
    expect(spokenReply(RECIPE)).toBe("Arroz con leche para 4 personas. Ingredientes. 1 taza de arroz. 1 litro de leche. Pasos. 1, Lava el arroz. 2, Hiérvelo con la leche y la canela, revolviendo seguido. 3, Sirve frío.");
    expect(spokenReply("Hola.")).toBe("Hola.");
  });
});
