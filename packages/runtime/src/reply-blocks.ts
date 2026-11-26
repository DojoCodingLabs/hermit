/**
 * Q155: the structure of a reply, read from its plain text, so the chat can draw a long answer cleanly (short headings,
 * numbered steps, bullets) and TalkBack can say it as sentences. Markdown is drawn, never shown: #, bold, italics, code
 * ticks, rules, quotes and table bars go, and other bullet signs (*, •, ·, dashes) become the design system's bullet.
 * Model text is untrusted for links: a markdown link keeps its words and its address as plain text, and nothing here
 * is ever made tappable.
 */
export type ReplyBlock =
  | { kind: "heading"; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "bullet"; text: string; depth: 0 | 1 }
  | { kind: "step"; n: string; text: string; depth: 0 | 1 };

const RULE = /^\s*(?:([-*_])\s*){3,}$/;
const TABLE_RULE = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)*\|?\s*$/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const BULLET = /^(\s*)(?:[-*•·–—+])\s+(.+)$/;
const STEP = /^(\s*)(\d{1,3})[.)]\s+(.+)$/;
const NAMED_STEP = /^(\s*)(?:paso|step)\s+(\d{1,3})\s*[:.)-]\s*(.+)$/i;
const MD_HEADING = /^\s*#{1,6}\s+(.+?)\s*#*\s*$/;
const BOLD_LINE = /^\s*(?:\*\*|__)(.+?)(?:\*\*|__)\s*:?\s*$/;
/** A short line that introduces what follows ("Ingredientes:"), with no sentence inside it. */
const COLON_LINE = /^\s*([^\n.!?]{1,60}?)\s*:\s*$/;

/** Inline markdown out, words kept: bold, italics, strike, code ticks, links (words and address, plain). */
function inline(text: string): string {
  return text
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, "$1 ($2)")
    .replace(/(\*\*|__)(?=\S)([^\n]*?\S)\1/g, "$2")
    .replace(/~~(?=\S)([^\n]*?\S)~~/g, "$1")
    .replace(/(?<![\p{L}\p{N}*])\*(?=\S)([^*\n]*?\S)\*(?![\p{L}\p{N}*])/gu, "$1")
    .replace(/(?<![\p{L}\p{N}_])_(?=\S)([^_\n]*?\S)_(?![\p{L}\p{N}_])/gu, "$1")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/^\s*>\s?/, "")
    .trim();
}

const depthOf = (indent: string): 0 | 1 => (indent.replace(/\t/g, "  ").length >= 2 ? 1 : 0);

export function replyBlocks(text: string): ReplyBlock[] {
  const blocks: ReplyBlock[] = [];
  let paragraph: string[] = [];
  // The previous line was a list item with no blank line after it: a plain line goes on with that item.
  let afterItem = false;
  const endParagraph = () => {
    if (paragraph.length) blocks.push({ kind: "paragraph", text: paragraph.join("\n") });
    paragraph = [];
  };
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim() || RULE.test(line) || TABLE_RULE.test(line)) {
      endParagraph();
      afterItem = false;
      continue;
    }
    if (TABLE_ROW.test(line)) {
      endParagraph();
      afterItem = false;
      const cells = line.trim().replace(/^\||\|$/g, "").split("|").map((c) => inline(c)).filter(Boolean);
      if (cells.length) blocks.push({ kind: "paragraph", text: cells.join(" · ") });
      continue;
    }
    const heading = MD_HEADING.exec(line) ?? BOLD_LINE.exec(line);
    if (heading) {
      endParagraph();
      afterItem = false;
      blocks.push({ kind: "heading", text: inline(heading[1]!).replace(/\s*:$/, "") });
      continue;
    }
    const step = STEP.exec(line) ?? NAMED_STEP.exec(line);
    if (step) {
      endParagraph();
      afterItem = true;
      blocks.push({ kind: "step", n: step[2]!, text: inline(step[3]!), depth: depthOf(step[1]!) });
      continue;
    }
    const bullet = BULLET.exec(line);
    if (bullet) {
      endParagraph();
      afterItem = true;
      blocks.push({ kind: "bullet", text: inline(bullet[2]!), depth: depthOf(bullet[1]!) });
      continue;
    }
    const colon = COLON_LINE.exec(line);
    if (colon && !paragraph.length) {
      afterItem = false;
      blocks.push({ kind: "heading", text: inline(colon[1]!) });
      continue;
    }
    const last = blocks[blocks.length - 1];
    if (afterItem && last && (last.kind === "step" || last.kind === "bullet")) {
      last.text = `${last.text}\n${inline(line)}`;
      continue;
    }
    paragraph.push(inline(line));
  }
  endParagraph();
  return blocks;
}

/** A reply as TalkBack says it: headings and items as sentences, steps with their number, no list signs spoken. */
export function spokenReply(text: string): string {
  const sentence = (s: string) => {
    const t = s.replace(/\s*\n\s*/g, " ").trim();
    return /[.!?…:;,]$/.test(t) ? t : `${t}.`;
  };
  return replyBlocks(text)
    .map((b) => (b.kind === "step" ? `${b.n}, ${sentence(b.text)}` : sentence(b.text)))
    .join(" ");
}
