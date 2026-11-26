/** Splits a migration script on top-level semicolons, keeping trigger bodies (BEGIN ... END;) whole. */
export function splitStatements(script: string): string[] {
  const out: string[] = [];
  let buf = "";
  let depth = 0;
  for (const part of script.split(/(;)/)) {
    buf += part;
    if (part !== ";") {
      depth += (part.match(/\bBEGIN\b/gi) ?? []).length - (part.match(/\bEND\b/gi) ?? []).length;
      continue;
    }
    if (depth <= 0) {
      if (buf.trim() !== ";") out.push(buf.trim());
      buf = "";
      depth = 0;
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out.filter((s) => s.replace(/;$/, "").trim());
}
