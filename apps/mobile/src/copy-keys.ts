// CT-10: pure source scan for copy keys written as whole string literals.
import { KEY_PATTERN } from "@hermit/copy";

const LITERAL_RE = /"([^"\\\n]*)"|'([^'\\\n]*)'|`([^`\\\n]*)`/g;

/** Returns every copy key written as a whole string literal ("...", '...', or `...` without `${`). */
export function extractCopyKeys(source: string): string[] {
  const keys: string[] = [];
  for (const match of source.matchAll(LITERAL_RE)) {
    const template = match[3];
    if (template !== undefined && template.includes("${")) continue;
    const value = match[1] ?? match[2] ?? template ?? "";
    if (KEY_PATTERN.test(value)) keys.push(value);
  }
  return keys;
}
