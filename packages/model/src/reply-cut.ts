import type { EngineResult } from "./engine.ts";

/**
 * Q155: a reply that used up its tokens is never shown as finished. These helpers decide what a cut reply shows and
 * how the next part (Seguir) joins it. Pure text rules, tested on the Mac; the model decides every word.
 */

/** The completion stopped short of its own end: out of tokens, or ended by something other than this turn's stop. */
export function stoppedShort(r: Pick<EngineResult, "stop">): boolean {
  return r.stop === "length" || r.stop === "cancelled";
}

/** A list item, a numbered step or a heading line: a block of its own. */
const LIST_LINE = /^\s*(?:[-*•·]\s+|\d{1,3}[.)]\s+)/;
const MARKER_ONLY = /^\s*(?:[-*•·]|\d{1,3}[.)])\s*$/;
const HEADING_LINE = /^\s*(?:#{1,6}\s+.+|[^\n.!?]{1,60}:\s*|\*\*[^*\n]{1,60}\*\*:?\s*)$/;
/**
 * The end of a sentence followed by more text. Decimals like 1.5 don't count (a space must follow), and neither does
 * a numbered step's own dot ("3. Lava...").
 */
const SENTENCE_END = /(?<!^[ \t]*\d{1,3})[.!?…](?=\s)/gm;
const ENDS_WHOLE = /[.!?…:)\]"”»]$/;

/** The last line goes when it matches (a marker or a heading left alone); the rest stays. */
const dropLast = (s: string, test: RegExp) => {
  const i = s.lastIndexOf("\n");
  return i > 0 && test.test(s.slice(i + 1)) ? s.slice(0, i).replace(/\s+$/, "") : s;
};

/**
 * The text up to its last whole word. A run of letters or digits at the very end may be half of one (a stop or the
 * cap can fall inside a word: "…con la mant"); a lone piece stays as it is.
 */
function lastWholeWord(text: string): string {
  if (!/[\p{L}\p{N}]$/u.test(text)) return text;
  const i = text.search(/\s\S*$/);
  return i > 0 ? text.slice(0, i).replace(/\s+$/, "") : text;
}

/**
 * A cut or stopped reply ends at its last whole line or sentence, when that keeps at least half of it; otherwise at its
 * last whole word, so the next part never joins half a word ("mant equilla"). A list marker or a heading left alone at
 * the end goes too: the next part starts with it again. Seguir's parts keep the separator they start with; a part left
 * with only a list sign is empty.
 */
export function endAtBoundary(text: string): string {
  const lead = /^\s*/.exec(text)![0];
  const body = text.slice(lead.length);
  let t = dropLast(body.replace(/\s+$/, ""), MARKER_ONLY);
  if (!ENDS_WHOLE.test(t)) {
    let cut = t.lastIndexOf("\n");
    for (const m of t.matchAll(SENTENCE_END)) cut = Math.max(cut, m.index + 1);
    if (cut >= 20 && cut >= t.length * 0.5) t = dropLast(t.slice(0, cut).replace(/\s+$/, ""), MARKER_ONLY);
    // Only a word the stream itself ended on may be half of one: one a space or a line came after is whole.
    else if (t === body) t = dropLast(lastWholeWord(t), MARKER_ONLY);
  }
  const withoutHeading = dropLast(t, HEADING_LINE);
  const out = withoutHeading.trim().length >= 20 ? withoutHeading : t;
  return out && !MARKER_ONLY.test(out) ? lead + out : "";
}

/** A first line that only says the reply goes on ("Claro, sigo:", "Here is the rest:"), never content. */
const PREFACE = new RegExp(
  "^\\s*(?:(?:claro|por supuesto|perfecto|listo|bien|ok|okay|sure|of course|certainly)[,.!]?\\s*)?(?:" +
    "(?:aqu[ií]\\s+)?(?:sigo|contin[uú]o|continuando|seguimos|sigamos)(?:\\s+(?:con\\s+)?(?:el resto|la receta|la respuesta|los pasos|la lista)(?:\\s+de\\s+[^:\\n]{1,40})?)?" +
    "|(?:aqu[ií]\\s+(?:tienes|est[aá]|va)\\s+)?el resto(?:\\s+de\\s+[^:\\n]{1,40})?" +
    "|here(?:'s|\\s+is)\\s+the\\s+rest(?:\\s+of\\s+[^:\\n]{1,40})?" +
    "|continuing(?:\\s+from\\s+where\\s+i\\s+(?:left\\s+off|stopped))?" +
    "|(?:i'?ll\\s+|let\\s+me\\s+)?continue(?:\\s+(?:from\\s+)?where\\s+i\\s+(?:left\\s+off|stopped))?" +
    ")\\s*[:.!]?\\s*$",
  "i",
);

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();

/** A heading-like line that only says more follows ("Siguen los pasos siguientes:", "Aquí está el contenido que se espera:"). */
const MORE_FOLLOWS = /(?<![\p{L}])(sigu\p{L}*|contin\p{L}*|resto|contenido|aqu[ií] (est[aá]|tienes|va)|here|rest|following|remaining)(?![\p{L}])/iu;
/**
 * The only words such a line may have: any other is content of its own ("Ingredientes para el resto de la masa:" is a
 * heading, review 2026-11-25). Without accents, as `norm` leaves them.
 */
const SAYS_MORE = new Set(
  ("aqui esta estan tienes tiene va van te dejo doy el la los las lo un una unos unas de del que se con y e a al en por para " +
    "sigue siguen siguiente siguientes sigo seguimos seguir sigamos siguiendo continua continuo continuamos continuacion " +
    "continuando continuar resto restante restantes demas contenido espera esperas esperaba esperado esperada falta faltan " +
    "faltaba queda quedan pasos paso lista receta respuesta informacion parte partes mas ahora entonces bien claro listo " +
    "perfecto vamos voy ok okay como asi es son todo " +
    "here s is are the rest of remaining following follows steps step list recipe answer content continuing continue " +
    "continued next part more now so sure i ll let me we to with and an what left missing expected as below it").split(" "),
);
const saysOnlyMore = (line: string) => norm(line).split(/[^\p{L}]+/u).every((w) => !w || SAYS_MORE.has(w));
const MARKER = /^(\s*)(?:[-*•·+]|(\d{1,3})([.)]))\s+/;
const isHeading = (line: string) => HEADING_LINE.test(line) && !LIST_LINE.test(line);

/** A line's words without its list sign or number, so "6. Afloja las tuercas" and "2. Afloja las tuercas" are one line. */
const contentOf = (line: string) => norm(line.replace(MARKER, ""));

/**
 * A line said before at least this long is a loop wherever it comes; a shorter one only in its own list ("- sal" may
 * come again in a second list, review 2026-11-25; "4. Afloja las tuercas." again in the same list is the model looping).
 */
const LOOP_CHARS = 25;

/**
 * Q155, Seguir's next part, filtered as it streams. Each line is decided once and never taken back:
 * - dropped when it only says more follows (before anything was shown, and only with no words of its own);
 * - dropped when its words, list sign or number aside, were said before (in the reply or in this part) and it can only
 *   be a repeat: anything before something new was written (a restart from the top) or while a restart runs (a heading
 *   said again, or a long line); a long line anywhere (a loop); a short line in the list it goes on with (a renumbered
 *   repeat). A short line said in another list is real once something new came ("- sal" in a second list);
 * - a new heading waits until something new follows it, and goes when nothing does. Lines said before that come right
 *   under it wait too: the opening lines of one of the reply's lists in their order, or lines under a heading said
 *   again, are a restart and go with the heading over them; anything else is a second list, written with its heading;
 * - numbered items that go on with the reply's list are numbered from where the reply's list stopped;
 * - the first line, when it says the reply's last words again ("...con la canela" + "con la canela y..."), keeps only
 *   what follows them, whole words only; when the reply stopped mid-line, a first line in lower case goes on with it.
 * An unfinished line is shown early only when it can't turn into a repeat (a list item with 16 or more new characters,
 * a paragraph line of 60 or more), so what streams is what the whole would give. The part starts with the separator
 * the structure needs: a blank line before a new heading, a line break around list items, a space inside a paragraph.
 */
export class ContinuationFilter {
  private readonly said: string[];
  /** The reply's lists: the lines under each of its headings, in order, to tell a restart from a second list. */
  private readonly lists: string[][];
  private readonly last: string;
  private readonly shown: string[] = [];
  /** The lines of the list this part goes on with: the reply's last one, or the last one this part put a heading on. */
  private current: string[];
  private buf = "";
  /** The unfinished line is being shown as it comes (from this index of buf on). */
  private open: number | undefined;
  /** Blank lines and new headings, waiting for something new to follow them. */
  private pending: string[] = [];
  /** Lines said before, waiting under a new heading: a second list or a restart (see settle). */
  private held: string[] = [];
  private started = false;
  /** A heading or a long line was said again: until something new comes, nothing said before is shown. */
  private restart = false;
  private listAt: number | undefined;
  private out = "";

  constructor(private readonly partial: string) {
    const lines = partial.split("\n");
    this.said = lines.map(contentOf).filter((c) => c.length >= 3);
    const lists: string[][] = [[]];
    for (const l of lines) {
      if (!l.trim()) continue;
      if (isHeading(l)) lists.push([]);
      else if (contentOf(l).length >= 3) lists.at(-1)!.push(contentOf(l));
    }
    this.current = [...lists.at(-1)!];
    this.lists = lists.filter((l) => l.length);
    this.last = lines.filter((l) => l.trim()).pop() ?? "";
    const n = MARKER.exec(this.last)?.[2];
    this.listAt = n !== undefined ? Number(n) : undefined;
  }

  /** What to show now for this piece of the stream. */
  push(piece: string): string {
    let emitted = "";
    this.buf += piece;
    let nl: number;
    while ((nl = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, nl);
      const from = this.open;
      this.buf = this.buf.slice(nl + 1);
      this.open = undefined;
      if (from !== undefined) {
        emitted += this.say(line.slice(from));
        this.saw(contentOf(line));
      } else emitted += this.line(line);
    }
    return emitted + this.early();
  }

  /**
   * The rest, once the stream ended. `cut`: it ran out of tokens, so its last line is unfinished; it goes when it is the
   * start of a line this part would drop or hold (a loop cut short).
   */
  end(cut = false): string {
    const line = this.buf;
    const from = this.open;
    this.buf = "";
    this.open = undefined;
    if (from !== undefined) return this.say(line.slice(from));
    if (cut && line.trim() && this.repeats().some((p) => p.startsWith(contentOf(line)))) return "";
    return line ? this.line(line) : "";
  }

  /** Everything shown so far: the part to append. */
  text(): string {
    return this.out.replace(/\s+$/, "");
  }

  private say(t: string): string {
    this.out += t;
    return t;
  }

  /** A line now on screen: said in this part, and in the list it belongs to. */
  private saw(c: string): void {
    this.shown.push(c);
    this.current.push(c);
  }

  /** A new heading waits, with nothing written under it yet. */
  private waits(): boolean {
    return this.pending.some(isHeading);
  }

  /**
   * The lines a line here would be dropped or held for repeating: any line said before while a restart may be going on
   * or a new heading waits; otherwise a long one, or one of the list it goes on with.
   */
  private repeats(): string[] {
    const all = [...this.said, ...this.shown, ...this.held.map(contentOf)];
    return !this.started || this.restart || this.waits() ? all : [...this.current, ...all.filter((p) => p.length >= LOOP_CHARS)];
  }

  /** An unfinished line could still turn into one of them. */
  private mayRepeat(c: string): boolean {
    return this.repeats().some((p) => p.startsWith(c) || c.startsWith(p));
  }

  private line(raw: string): string {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) {
      if (this.started) this.pending.push("");
      return "";
    }
    if (!this.started && (PREFACE.test(line) || (/:\s*$/.test(line) && line.length <= 80 && MORE_FOLLOWS.test(line) && saysOnlyMore(line)))) return "";
    const c = contentOf(line);
    const heading = isHeading(line);
    if (c.length >= 3 && this.held.some((h) => contentOf(h) === c)) return "";
    if (c.length >= 3 && (this.said.includes(c) || this.shown.includes(c))) {
      if (this.waits()) {
        // Right under a new heading: a long line said again is a restart, and the heading over it goes too; anything
        // shorter waits for what follows (settle).
        if (!heading && c.length >= LOOP_CHARS) {
          this.pending = [];
          this.held = [];
          this.restart = true;
        } else this.held.push(line);
        return "";
      }
      if (heading || c.length >= LOOP_CHARS) {
        this.restart = true;
        return "";
      }
      if (!this.started || this.restart || this.current.includes(c)) return "";
    }
    if (heading) {
      this.settle();
      this.pending.push(line);
      this.restart = false;
      return "";
    }
    const written = this.write(line);
    this.saw(c);
    return written;
  }

  /**
   * Lines said before that waited under a new heading, now that something new follows: the opening lines of one of the
   * reply's lists in their order, or any under a heading said again, are a restart and go with the headings over them;
   * otherwise they are a second list and are written under their heading.
   */
  private settle(): void {
    if (!this.held.length) return;
    const items = this.held.filter((h) => !isHeading(h)).map(contentOf);
    const again = this.held.some(isHeading);
    if (items.length && (again || this.lists.some((l) => items.every((c, i) => l[i] === c)))) this.pending = [];
    else this.pending.push(...this.held);
    this.held = [];
  }

  /** Shows an unfinished line early, when it can't become a repeat; then it streams as it comes. */
  private early(): string {
    if (this.open !== undefined) {
      const t = this.buf.slice(this.open);
      this.open = this.buf.length;
      return t ? this.say(t) : "";
    }
    const line = this.buf;
    if (!line.trim()) return "";
    const c = contentOf(line);
    const marked = MARKER.test(line);
    if (marked ? c.length < 16 : c.length < 60) return "";
    if (this.mayRepeat(c)) return "";
    if (!this.started && !marked && this.overlap(line) !== undefined) return "";
    const written = this.write(line);
    this.open = this.buf.length;
    return written;
  }

  /**
   * How much of a first line says the reply's last words again, if it does: whole words at both ends, so "la" said
   * again after "…agrega la" is one, and "lata" is a new word. A word or two must be the same as written: "Arroz
   * lavado" after "…lava el arroz" starts a sentence of its own.
   */
  private overlap(line: string): number | undefined {
    const tail = norm(this.partial.slice(-80));
    const end = this.partial.replace(/\s+$/, "");
    for (let k = Math.min(line.length, 80); k >= 1; k--) {
      if (!/[\s,.;:!?]/.test(line[k] ?? " ")) continue;
      const piece = norm(line.slice(0, k));
      if (!piece || !tail.endsWith(piece)) continue;
      const before = tail[tail.length - piece.length - 1];
      if (before !== undefined && /[\p{L}\p{N}]/u.test(before)) continue;
      if (piece.length < 8 && !end.endsWith(line.slice(0, k).trim())) continue;
      return k;
    }
    return undefined;
  }

  /** Writes a kept line (with what waited before it), numbering it on from the reply's list when it goes on with it. */
  private write(line: string): string {
    this.settle();
    const m = MARKER.exec(line);
    const headed = this.pending.some(isHeading);
    const first = !this.started;
    // The first line may go on with the reply's last one: saying its last words again, or carrying on a line that
    // stopped mid-way ("…ponlo en una" + "olla con la leche.").
    const k = first && !m && !headed ? this.overlap(line) : undefined;
    const goesOn = first && !m && !headed && (k !== undefined || (!ENDS_WHOLE.test(this.last.trim()) && /^\s*\p{Ll}/u.test(line)));
    let text = line;
    if (headed) this.listAt = undefined;
    if (m?.[2] !== undefined) {
      const n = this.listAt !== undefined ? this.listAt + 1 : Number(m[2]);
      text = `${m[1]}${n}${m[3]} ${line.slice(m[0].length)}`;
      this.listAt = n;
    } else if (!m && !goesOn) this.listAt = undefined;
    // What waited (blank lines, a heading, the lines of a second list), with a run of blank lines kept as one.
    const before = this.pending.filter((p, i, all) => p.trim() || i === 0 || all[i - 1]!.trim());
    this.pending = [];
    this.restart = false;
    // A heading starts a list of its own; the lines of a second list written under it belong to it.
    for (const p of before) {
      if (isHeading(p)) this.current = [];
      else if (p.trim()) this.saw(contentOf(p));
    }
    if (!first) return this.say(`\n${[...before, text].join("\n")}`);
    this.started = true;
    if (k !== undefined) {
      const rest = line.slice(k).replace(/\s+$/, "");
      return rest.trim() ? this.say(rest) : "";
    }
    text = text.replace(/^\s+/, "");
    const top = before.find((p) => p.trim()) ?? text;
    const prefix = isHeading(top) ? "\n\n" : goesOn ? " " : LIST_LINE.test(top) || LIST_LINE.test(this.last) || HEADING_LINE.test(this.last) ? "\n" : " ";
    while (before.length && !before[0]!.trim()) before.shift();
    return this.say(prefix + [...before, text].join("\n"));
  }
}

/**
 * The new part of a continuation, ready to append to `partial` (the whole text at once; Seguir streams it through
 * ContinuationFilter, with the same result). Empty when nothing is new.
 */
export function continuationPart(partial: string, next: string): string {
  const f = new ContinuationFilter(partial);
  f.push(next.replace(/^\s+/, ""));
  f.end();
  return f.text();
}

/** What the user's side says to ask for the next part (Seguir), in the user's language. Never shown in the chat. */
export function continueNote(language: "es-419" | "en"): string {
  return language === "en"
    ? "Go on from exactly where you stopped. Write only what comes next; do not repeat anything you already wrote and do not start over."
    : "Sigue exactamente desde donde te quedaste. Escribe solo lo que viene; no repitas nada de lo que ya escribiste ni empieces de nuevo.";
}
