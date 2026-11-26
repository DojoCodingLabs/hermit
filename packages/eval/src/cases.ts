export interface EvalCase {
  id: string;
  lang: "es" | "en";
  input: string;
  /** args: exact values. contains: case-insensitive substrings each named arg must contain. */
  expect: { choice: string; args?: Record<string, unknown>; contains?: Record<string, string> };
  tags?: string[];
}

/** One case per line; blank lines are skipped. Errors name the line. */
export function loadCases(jsonl: string): EvalCase[] {
  const cases: EvalCase[] = [];
  jsonl.split("\n").forEach((line, i) => {
    if (!line.trim()) return;
    try {
      cases.push(JSON.parse(line) as EvalCase);
    } catch (err) {
      throw new Error(`cases: line ${i + 1} is not valid JSON (${(err as Error).message})`, { cause: err });
    }
  });
  return cases;
}
