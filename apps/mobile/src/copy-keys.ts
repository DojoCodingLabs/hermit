import { KEY_PATTERN } from "@hermit/copy";

const LITERAL = /"([^"\\\n]*)"|'([^'\\\n]*)'|`([^`\\$]*(?:\$(?!\{)[^`\\$]*)*)`/g;

/**
 * Extracts copy keys written as whole string literals (double quotes, single quotes, or
 * backticks without `${` interpolations) from a TypeScript/TSX source file.
 */
export function copyKeys(source: string): string[] {
  const seen = new Set<string>();
  for (const match of source.matchAll(LITERAL)) {
    const value = match[1] ?? match[2] ?? match[3];
    if (value !== undefined && KEY_PATTERN.test(value)) seen.add(value);
  }
  return [...seen];
}
