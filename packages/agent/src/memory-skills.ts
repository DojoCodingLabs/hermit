import { MemoryError, type BotMemory, type Note, type ReadKind, type SessionState } from "@hermit/core";
import { skillById } from "@hermit/skills";
import { factBack, quotable, speaker, type AnswerWords } from "./answers.ts";
import type { SkillRuntime } from "./types.ts";

const def = (id: string) => {
  const d = skillById(id);
  if (!d) throw new Error(`skill ${id} is missing from the catalog`);
  return d;
};

/** The session has read these too (`SessionState.reads`, each kind once): what the cage's alone split goes by. */
export function addReads(session: SessionState, kinds: readonly ReadKind[]): void {
  for (const kind of kinds) if (!session.reads?.includes(kind)) session.reads = [...(session.reads ?? []), kind];
}

/**
 * Security review 00:40: notes read back bring what they were read from into the session (private data, the web), so the
 * alone split between them holds across runs, whichever run saved the note.
 */
function readBack(session: SessionState, notes: readonly Note[]): void {
  addReads(session, notes.flatMap((n) => n.kinds ?? []));
}

/**
 * remember, recall and forget, backed by on-device memory. With `words` (W1), remember and forget say what they did in
 * code's words ("Listo, lo recuerdo: tu pasaporte vence en marzo."); recall's answer stays the model's, which reads the
 * notes against the question.
 */
export function memorySkills(memory: BotMemory, opts: { words?: AnswerWords } = {}): SkillRuntime[] {
  const { words } = opts;
  return [
    {
      def: def("remember"),
      async execute(args, { session, userText }) {
        try {
          const fact = String(args.fact);
          // A fact saved after reading other people's text keeps that provenance, and so does one saved after reading
          // private data or the web (the session's reads).
          await memory.remember(fact, { tainted: session.taint.length > 0, kinds: session.reads ?? [] });
          const s = words && speaker(words, userText);
          if (!s) return { ok: true, modelText: "Saved." };
          const back = factBack(fact, s.language);
          return { ok: true, modelText: "Saved.", answer: s.t(back.quoted ? "done.rememberQuoted" : "done.remember", { fact: back.text }) };
        } catch (err) {
          if (err instanceof MemoryError) return { ok: false, modelText: err.message };
          throw err;
        }
      },
    },
    {
      def: def("recall"),
      async execute(args, { session }) {
        const notes = await memory.recall(String(args.query));
        readBack(session, notes);
        // Per-call taint: only facts saved from untrusted content taint the session.
        if (notes.length) return { ok: true, modelText: notes.map((n) => `- ${n.fact}`).join("\n"), untrusted: notes.some((n) => n.tainted) };
        // The keyword search can't cross languages ("tipo de sangre" never matches "blood type"): show the
        // newest notes and let the model judge whether one answers. The user's own notes, same taint rule.
        const recent = await memory.recent(5);
        readBack(session, recent);
        if (!recent.length) return { ok: true, modelText: "Nothing saved about that.", untrusted: false };
        return {
          ok: true,
          modelText: `No note matched those words. The newest notes (one may answer, maybe in another language; if none does, say nothing is saved about it):\n${recent.map((n) => `- ${n.fact}`).join("\n")}`,
          untrusted: recent.some((n) => n.tainted),
        };
      },
    },
    {
      def: def("forget"),
      async execute(args, { userText }) {
        try {
          const query = String(args.query);
          const n = await memory.forget(query);
          // "Forgot N." is what the prompt reads to blank the forgotten fact from the model's history (scrubForgotten).
          const modelText = n ? `Forgot ${n}.` : "Nothing matched.";
          const s = words && speaker(words, userText);
          if (!s) return { ok: true, modelText };
          const vars = { query: quotable(query, 80), count: String(n) };
          return { ok: true, modelText, answer: s.t(n === 0 ? "done.forgetNone" : n === 1 ? "done.forgetOne" : "done.forgetMany", vars) };
        } catch (err) {
          if (err instanceof MemoryError) return { ok: false, modelText: err.message };
          throw err;
        }
      },
    },
  ];
}
