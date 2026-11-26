import type { EvalCase } from "./cases.ts";

const rem = (id: string, lang: "es" | "en", input: string, sub: string): EvalCase =>
  ({ id, lang, input, expect: { choice: "remember", contains: { fact: sub } }, tags: ["memory"] });
const rec = (id: string, lang: "es" | "en", input: string, sub: string): EvalCase =>
  ({ id, lang, input, expect: { choice: "recall", contains: { query: sub } }, tags: ["memory"] });
const fgt = (id: string, lang: "es" | "en", input: string, sub: string): EvalCase =>
  ({ id, lang, input, expect: { choice: "forget", contains: { query: sub } }, tags: ["memory"] });
const dec = (id: string, lang: "es" | "en", input: string): EvalCase =>
  ({ id, lang, input, expect: { choice: "respond" }, tags: ["decline"] });
const ask = (id: string, lang: "es" | "en", input: string): EvalCase =>
  ({ id, lang, input, expect: { choice: "ask_user" }, tags: ["ask"] });

/** Memory (remember/recall/forget), decline/chat and ask cases. 30 es / 30 en. */
export const MEMDEC_CASES: readonly EvalCase[] = [
  // es: remember
  rem("md-es-1", "es", "mi grupo sanguineo es O+", "o+"),
  rem("md-es-2", "es", "para que sepas, la clave del wifi de la casa es pollito2024", "pollito2024"),
  rem("md-es-3", "es", "apunta q mi talla de camisa es M", "camisa"),
  rem("md-es-4", "es", "no se te olvide que el cumple de mi mama es el 14 de marzo", "marzo"),
  rem("md-es-5", "es", "vos sabes que mi numero de pasaporte es G1234567? guardalo porfa", "g1234567"),
  rem("md-es-6", "es", "deje las llaves de repuesto con doña Marta la vecina, acordate de eso", "marta"),
  // es: recall
  rec("md-es-7", "es", "no me acuerdo cual era la clave del gym", "gym"),
  rec("md-es-8", "es", "¿cuánto calzo?", "calz"),
  rec("md-es-9", "es", "cual es el pin de mi tarjeta del banco", "pin"),
  rec("md-es-10", "es", "oye y donde guarde el pasaporte?", "pasaporte"),
  rec("md-es-11", "es", "como se llamaba el veterinario de la Luna?", "veterinari"),
  rec("md-es-12", "es", "que dia era el aniversario con mi novia", "aniversario"),
  rec("md-es-13", "es", "recordame cual es la placa de mi carro", "placa"),
  rec("md-es-14", "es", "che, que cafe es el que me gusta a mi?", "caf"),
  // es: forget
  fgt("md-es-15", "es", "borra la clave vieja del wifi", "wifi"),
  fgt("md-es-16", "es", "olvidate de lo del gym, ya no voy", "gym"),
  fgt("md-es-17", "es", "ya no necesito que guardes mi talla de pantalon, borralo", "pantal"),
  fgt("md-es-18", "es", "elimina lo que te dije de la placa del carro", "placa"),
  // es: decline / chat
  dec("md-es-19", "es", "cual es la capital de mi pais, costa rica?"),
  dec("md-es-20", "es", "cuanto es el 15% de 340"),
  dec("md-es-21", "es", "como se dice 'te extraño' en ingles"),
  dec("md-es-22", "es", "llamale a mi mama"),
  dec("md-es-23", "es", "pedime un uber pa la casa"),
  dec("md-es-24", "es", "pagá el recibo de la luz con mi tarjeta"),
  dec("md-es-25", "es", "pone musica de bad bunny"),
  dec("md-es-26", "es", "que tal, como estas?"),
  dec("md-es-27", "es", "contame un chiste de perros"),
  // es: ask
  ask("md-es-28", "es", "acordate de esto"),
  ask("md-es-29", "es", "borra eso"),
  ask("md-es-30", "es", "cual era mi...?"),

  // en: remember
  rem("md-en-1", "en", "my blood type is A negative", "blood"),
  rem("md-en-2", "en", "fyi the garage code is 4471", "4471"),
  rem("md-en-3", "en", "my shoe size is 10.5, keep that in mind", "10.5"),
  rem("md-en-4", "en", "remember my sister's bday is june 3rd", "june"),
  rem("md-en-5", "en", "my dentist is dr okafor", "okafor"),
  rem("md-en-6", "en", "heads up, i parked on level 3 spot B12", "b12"),
  // en: recall
  rec("md-en-7", "en", "what was that wifi thing again", "wifi"),
  rec("md-en-8", "en", "whats my locker combo", "locker"),
  rec("md-en-9", "en", "remind me what my frequent flyer number is", "flyer"),
  rec("md-en-10", "en", "how do i take my coffee?", "coffee"),
  rec("md-en-11", "en", "where did i leave the spare key", "key"),
  rec("md-en-12", "en", "when's our anniversary", "anniversary"),
  rec("md-en-13", "en", "what's my ring size", "ring"),
  rec("md-en-14", "en", "who's my landlord again, i forgot his name", "landlord"),
  // en: forget
  fgt("md-en-15", "en", "forget my old gym password", "gym"),
  fgt("md-en-16", "en", "delete the thing about my parking spot", "park"),
  fgt("md-en-17", "en", "pls remove my ex's birthday from your memory", "birthday"),
  fgt("md-en-18", "en", "you can forget the alarm code now, we changed it", "alarm"),
  // en: decline / chat
  dec("md-en-19", "en", "what's the capital of my country Costa Rica"),
  dec("md-en-20", "en", "whats 18 times 23"),
  dec("md-en-21", "en", "how do you say good morning in portuguese"),
  dec("md-en-22", "en", "call my brother"),
  dec("md-en-23", "en", "order me a large pepperoni pizza"),
  dec("md-en-24", "en", "send 50 bucks to my mom on venmo"),
  dec("md-en-25", "en", "is it gonna rain tomorrow"),
  dec("md-en-26", "en", "turn the volume up"),
  dec("md-en-27", "en", "hey hows it going"),
  // en: ask
  ask("md-en-28", "en", "remember this"),
  ask("md-en-29", "en", "forget that"),
  ask("md-en-30", "en", "what's my"),
];
