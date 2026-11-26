// How many prompt tokens a first step costs (prefill is paid on every step on the phone).
import { describeNowForModel } from "@hermit/core";
import { leanSchema, systemPrompt } from "@hermit/model";
import { firstWinSkills } from "@hermit/skills";

const url = process.argv[2] ?? "http://localhost:8090";
const ctx = { language: "es-419" as const, now: describeNowForModel(Date.UTC(2026, 10, 12, 3), "America/Costa_Rica"), profile: [] };
const tools = firstWinSkills.map((s) => ({ type: "function", function: { name: s.id, description: s.menuLine, parameters: process.argv.includes("--full") ? s.args : leanSchema(s.args) } }));
for (const style of ["menu", "slim"] as const) {
  const messages = [{ role: "system", content: systemPrompt(ctx, firstWinSkills, style) }, { role: "user", content: "recuérdame mañana a las 7 sacar la basura" }];
  const t = (await (await fetch(`${url}/apply-template`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages, tools }) })).json()) as { prompt: string };
  const n = (await (await fetch(`${url}/tokenize`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ content: t.prompt }) })).json()) as { tokens: number[] };
  const sys = (await (await fetch(`${url}/tokenize`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ content: messages[0]!.content }) })).json()) as { tokens: number[] };
  console.log(`${style}: whole prompt ${n.tokens.length} tokens, our system text ${sys.tokens.length}`);
}
