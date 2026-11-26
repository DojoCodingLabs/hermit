/**
 * Q155: long answers when asked. The user's own words, read by code, say when a reply may run long: a recipe, steps or
 * a how-to, a list, a detailed explanation, or more of the last answer. The model still writes every word; this only
 * picks the prompt that allows structure and the higher cap (FR-MODEL-05: the cap is the profile's `longReplyTokens`).
 *
 * Words that only look like it are refused first, so a skill keeps them: a prescription and its refills ("receta
 * médica", "renueva mi receta"; the web task flow handles refills), the user's own lists and data ("mi lista", "lista de
 * mis recordatorios", "más detalles sobre mi vuelo"), and a request to do something with a list or a recipe ("guarda
 * esta lista", "mándale la lista a Ana"). "Más largo" and "sigue" count only as the whole message ("el río más largo"
 * is a question, not a request).
 */
export type LongFormKind = "recipe" | "steps" | "list" | "detail" | "longer";

/** Whole words, with accents counted as letters. */
const words = (alternatives: string) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternatives})(?![\\p{L}\\p{N}])`, "iu");

/** A prescription, or a refill of one: never a cooking recipe. */
const PRESCRIPTION = words(String.raw`recetas? (m[eé]dicas?|electr[oó]nicas?|retenidas?|del (m[eé]dico|doctor|dentista)|de (la |mi |mis |los |las )?(m[eé]dic[oa]|doctor|doctora|dentista|lentes|anteojos|gafas|medicamentos?|medicinas?|remedios?|pastillas|antibi[oó]ticos?)|para (el |la |los |las |mis )?(lentes|anteojos|gafas|medicamentos?|medicinas?|remedios?|pastillas|antibi[oó]ticos?))|(surt|resurt|renuev|renov|rellen|recog|recarg|retir)\p{L}*( \p{L}+){0,3} recetas?|prescriptions?|refills?|farmacias?|pharmac(y|ies)|isapre|fonasa`);

/**
 * The user's own things: their skills (recall, lists, mail, calendar) answer, not a long answer from the model. "Para mi
 * cumpleaños" and "for my interview" are a purpose, not data, so they don't count.
 */
const THEIRS = new RegExp(String.raw`(?<!(?:para|for) )(?<![\p{L}\p{N}])(?:mi|mis|m[ií]os?|m[ií]as?|nuestr[oa]s?|my|mine|our|ours)(?![\p{L}\p{N}])`, "iu");

/** A request to act (save, remind, send, add, search, open, read): a skill's turn, whatever else it says. */
const ACTS = words(String.raw`guard[aá](la|lo|las|los|me)?|guardar|an[oó]ta(la|lo|me)?|anotar|ap[uú]nta(la|lo|me)?|apuntar|recu[eé]rdame|rec[oó]rdame|av[ií]same|ag[eé]nda(la|lo|me)?|agendar|m[aá]nd(a|ale|ales|ame)|mandar|env[ií]a(la|lo|le|les|me)?|enviar|escr[ií]be(le|les)|dile|dec[ií]le|b[oó]rra(la|lo)?|borrar|elimin(a|ala|alo|ar)|agreg(a|ala|alo|ar|ue)|añad(e|ela|elo|ir)|sum[aá]le|quit(a|ala|alo|ar) de|busca(la|lo|me|r)?|b[uú]scame|abr(e|ir)|[aá]bre(la|lo|me)|llam(a|ale|ar)|comp[aá]rte(la|lo)?|compartir|l[eé]e(la|lo|me)|leer|save|note down|remind|send|text|e-?mail|tell (?!me\b)|delete|remove|add|put|search|look up|google|open|call|share|read|forward|reply`);

/** Verbs of doing something step by step, for "cómo instalo...", "how do I fix...". */
const DO_ES = String.raw`hac(e|er|en)|hago|instal(a|ar|o|an)|configur(a|ar|o|an)|arregl(a|ar|o|an)|repar(a|ar|o|an)|limpi(a|ar|o|an)|cambi(a|ar|o|an)|reemplaz(a|ar|o|an)|cre(a|ar|o|an)|constru(ye|ir|yo|yen)|plant(a|ar|o|an)|cultiv(a|ar|o|an)|entren(a|ar|o|an)|aprend(e|er|o|en)|quit(a|ar|o|an)|sac(a|ar|o|an)|destap(a|ar|o|an)|amarr(a|ar|o|an)|at(a|ar|o|an)|dobl(a|ar|o|an)|pint(a|ar|o|an)|tej(e|er|o|en)|cos(e|er|o|en)|dibuj(a|ar|o|an)|reinici(a|ar|o|an)|actualiz(a|ar|o|an)|tramit(a|ar|o|an)|renuev(a|o|an)|renovar|ahorr(a|ar|o|an)|invert(ir)|invierto|empez(ar)|empiezo|aprendo|armo|arm(a|ar|an)|monto|mont(a|ar|an)|lav(a|ar|o|an)|plancho|planch(a|ar|an)`;
const DO_EN = String.raw`make|build|install|set up|setup|fix|repair|clean|change|replace|create|plant|grow|train|learn|remove|get rid of|unclog|tie|fold|paint|knit|sew|draw|configure|reset|update|upgrade|apply for|register|start|assemble|wash|iron|save money|invest|prepare|write a|study for`;

const ASKS: ReadonlyArray<[LongFormKind, RegExp]> = [
  ["recipe", words(String.raw`recetas?|recipes?|ingredientes|ingredients|c[oó]mo (se )?(prepara|preparan|cocina|cocinan|hornea|hornean)|c[oó]mo (preparo|preparar|cocino|cocinar|horneo|hornear)|qu[eé] necesito para (preparar|cocinar|hornear|hacer) (un|una|unos|unas|el|la|los|las)? ?\p{L}+|how (do|can|should) (i|you|we|one) (cook|bake)|how to (cook|bake)`)],
  ["steps", words(String.raw`paso a paso|step[- ]by[- ]step|(los |cu[aá]les son los )?pasos (para|de|a seguir)|steps (to|for)|instrucciones (para|de)|instructions (for|to|on)|gu[ií]a (para|de)|a guide (to|for|on)|tutorial|ens[eé]ñame (a|c[oó]mo)|teach me (how )?to|walk me through|guide me through|c[oó]mo (se |puedo |debo |tengo que |hago para |se puede )?(${DO_ES})|how (do|can|should) (i|you|we|one) (${DO_EN})|how to (${DO_EN})`)],
  ["list", words(String.raw`(una |la )?lista de|enum[eé]ra(me)?|enlista(me)?|(dame|dime|hazme|escr[ií]beme|sugi[eé]reme|recomi[eé]ndame) (\d+|un par de|unas?|algunas?|varias|varios|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez) (ideas|opciones|recomendaciones|sugerencias|razones|ejemplos|consejos|tips|nombres|lugares|libros|pel[ií]culas|series|canciones|planes|actividades|juegos|regalos)|(\d+|cinco|diez) (ideas|consejos|tips|razones|ejemplos|lugares|libros|pel[ií]culas) (para|de|sobre)|ideas para|consejos para|(a |the )?list of|make (me )?an? (\p{L}+ ){0,2}list|(give|tell|show) me (\d+|some|a few|several|two|three|four|five|six|seven|eight|nine|ten) (\p{L}+ )?(ideas|options|recommendations|suggestions|reasons|examples|tips|names|places|books|movies|shows|songs|plans|activities|games|gifts)|top (\d+|three|five|ten)|ideas for|tips (for|on)`)],
  ["detail", words(String.raw`en detalle|con detalle|detalladamente|a fondo|con lujo de detalles|explicaci[oó]n (detallada|completa|larga)|todo (lo que sepas )?sobre|cu[eé]ntame todo|in detail|in depth|in-depth|detailed|thoroughly|everything (you know )?about|tell me everything`)],
];

/** More of the last answer: the whole message asks for it ("más largo, porfa", "sigue", "go on"). */
const LONGER = new RegExp(
  String.raw`^\s*(?:(?:ok|okay|dale|bueno|y|pero|please|porfa|por favor)[,.!\s]+)?(?:` +
    String.raw`(?:hazl[oa]|h[aá]celo|escr[ií]bel[oa]|expl[ií]cal[oa]|d[ií]mel[oa]|ponl[oa])? ?m[aá]s (?:larg[oa]|extens[oa]|complet[oa]|detallad[oa])|(?:dame |con )?m[aá]s detalles?|(?:expl[ií]ca(?:lo|la|me)? )?con m[aá]s detalles?|ampl[ií]a(?:lo|la)?|desarr[oó]lla(?:lo|la)?|sigue|segu[ií]|contin[uú]a|contin[uú]ale|` +
    String.raw`(?:make it |write it )?longer|(?:give me |with )?more details?|(?:explain it )?in more detail|go on|keep going|continue|tell me more|expand on (?:it|that|this)|elaborate` +
    String.raw`)(?:[,.!\s]+(?:porfa|por favor|please|thanks|gracias))?[\s.!?]*$`,
  "iu",
);

export function longFormAsked(text: string): LongFormKind | undefined {
  const t = text.trim();
  if (!t || /https?:\/\/|www\./i.test(t)) return undefined;
  if (LONGER.test(t)) return "longer";
  if (PRESCRIPTION.test(t) || THEIRS.test(t) || ACTS.test(t)) return undefined;
  return ASKS.find(([, pattern]) => pattern.test(t))?.[0];
}
