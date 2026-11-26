import { describe, expect, test } from "vitest";
import { longFormAsked, type LongFormKind } from "../src/long-form.ts";

// Q155: long answers when asked. Code reads the user's own words; the answer still comes from the model. The list is
// tested both ways: what must count, and what only looks like it (a prescription, a refill, the user's own lists and
// data, a request to do something with a list, a superlative).

const asks: Array<[string, LongFormKind]> = [
  // Recipes
  ["dame una receta de arroz con leche", "recipe"],
  ["¿Me das la receta del pie de limón?", "recipe"],
  ["receta de lasaña para 6 personas", "recipe"],
  ["¿cómo se prepara el ceviche?", "recipe"],
  ["como se hace el pan de molde", "steps"],
  ["¿Cómo preparo unas empanadas de pino?", "recipe"],
  ["qué ingredientes lleva el pastel de choclo", "recipe"],
  ["¿qué necesito para hacer sopaipillas?", "recipe"],
  ["recetas fáciles con pollo", "recipe"],
  ["give me a recipe for banana bread", "recipe"],
  ["how do I make pancakes?", "steps"],
  ["How to bake sourdough bread", "recipe"],
  ["what are the ingredients for guacamole", "recipe"],
  // Steps and how-to
  ["explícame paso a paso cómo cambiar una llanta", "steps"],
  ["¿Cómo instalo una lámpara de techo?", "steps"],
  ["cómo puedo destapar un lavamanos", "steps"],
  ["¿cuáles son los pasos para sacar el pasaporte?", "steps"],
  ["instrucciones para armar una carpa", "steps"],
  ["enséñame a hacer un nudo de corbata", "steps"],
  ["how do I change a flat tire?", "steps"],
  ["step by step guide to planting tomatoes", "steps"],
  ["walk me through setting up a new router", "steps"],
  ["how can I unclog a drain", "steps"],
  ["instructions for assembling a bookshelf", "steps"],
  // Lists
  ["hazme una lista de compras para la semana", "list"],
  ["dame 10 ideas para un cumpleaños", "list"],
  ["una lista de películas para ver en familia", "list"],
  ["enumera los planetas del sistema solar", "list"],
  ["dame algunas ideas para cenar", "list"],
  ["make me a packing list for a beach trip", "list"],
  ["give me 5 tips for sleeping better", "list"],
  ["a list of good books for teenagers", "list"],
  ["top 10 places to visit in Peru", "list"],
  // "For my ..." is a purpose, not the user's data.
  ["dame ideas para mi cumpleaños", "list"],
  ["dame una receta para mi dieta sin gluten", "recipe"],
  ["give me tips for my job interview", "list"],
  // A detailed explanation
  ["explícame en detalle cómo funciona la fotosíntesis", "detail"],
  ["cuéntame con detalle la historia de Chile", "detail"],
  ["explícame a fondo qué es la inflación", "detail"],
  ["explain in detail how vaccines work", "detail"],
  ["tell me everything about the Inca empire", "detail"],
  // More of the last answer
  ["más largo", "longer"],
  ["hazlo más largo, porfa", "longer"],
  ["dame más detalles", "longer"],
  ["sigue", "longer"],
  ["continúa por favor", "longer"],
  ["make it longer", "longer"],
  ["more details please", "longer"],
  ["go on", "longer"],
  ["tell me more", "longer"],
];

const notAsks: string[] = [
  // A prescription, and refills (the web task flow handles those), never a cooking recipe.
  "necesito una receta médica para el antibiótico",
  "renueva mi receta en la farmacia",
  "¿cuándo vence mi receta?",
  "pide la receta de mis lentes",
  "la receta del doctor dice dos pastillas al día",
  "surte la receta en Farmacias Ahumada",
  "recoge mi receta retenida",
  "refill my prescription",
  "how do I refill my prescription at the pharmacy",
  // The user's own lists and data: their skills answer, not a long answer from the model.
  "¿qué hay en mi lista de compras?",
  "la lista de mis recordatorios",
  "dame la lista de mis contactos",
  "dame más detalles sobre mi vuelo",
  "explícame en detalle mi factura",
  "what's on my list",
  // Doing something with a list or a recipe: an action, not a long answer.
  "guarda esta lista: pan, leche y huevos",
  "agrega leche a la lista de compras",
  "anota la receta de la abuela",
  "recuérdame la receta de la tía a las 6",
  "mándale a Ana la lista de invitados",
  "add milk to my shopping list",
  "save this recipe",
  "send Ana the guest list",
  // Questions that are short however they are worded.
  "¿cuál es el río más largo del mundo?",
  "¿qué día es más largo, el 21 de junio o el 21 de diciembre?",
  "how do I look?",
  "how do I say thank you in Japanese?",
  "¿cómo estás?",
  "¿cómo te llamas?",
  "explícame qué es un fondo mutuo",
  "sigue lloviendo en Santiago",
  "continue with the reminder for tomorrow at 9",
  "hola",
  "",
];

describe("long-form requests, by the user's own words (Q155)", () => {
  test.each(asks)("%s asks for a long answer (%s)", (text, kind) => {
    expect(longFormAsked(text)).toBe(kind);
  });

  test.each(notAsks)("%s is not a long-form request", (text) => {
    expect(longFormAsked(text)).toBeUndefined();
  });
});
