/** `[cases.jsonl] [--model <name>]`, in any order. */
export function parseCliArgs(argv: string[]): { file: string | undefined; model: string } {
  const i = argv.indexOf("--model");
  const model = i >= 0 ? (argv[i + 1] ?? "fake") : "fake";
  const file = argv.find((a, j) => a.endsWith(".jsonl") && (i < 0 || j !== i + 1));
  return { file, model };
}
