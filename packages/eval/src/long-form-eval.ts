// Q155 on the Mac lab: long answers when asked, and cut-and-continue, with the phone's GGUF on llama-server (the same
// file and harness as the phone; only speed differs). Self-contained, so the same file measures master's snapshot (the
// "before") and this branch: it streams from llama-server itself, so time to first token is what a person would see.
//
// Usage: node --experimental-transform-types --no-warnings src/long-form-eval.ts <config> [--out file.jsonl]
//   config: before (master as shipped), long (the shipped long cap), normal (the normal cap: a hot phone, Seguir until
//   done), long-think (the long cap with thinking 256), detect (the blind detection set, no model).
import { writeFileSync } from "node:fs";
import { describeNowForModel, type Msg } from "@hermit/core";
import * as model from "@hermit/model";
import { createModelPort, profileById, userLanguage, type CompletionEngine, type EngineRequest, type EngineResult } from "@hermit/model";
import { firstWinSkills } from "@hermit/skills";

const args = process.argv.slice(2);
const config = args[0] ?? "long";
const out = args.indexOf("--out") >= 0 ? args[args.indexOf("--out") + 1] : undefined;
const URL_BASE = "http://localhost:8090";

/** Long-form asks for the speed and quality runs: development data, written for this measurement. */
const ASKS: Array<{ id: string; lang: "es" | "en"; kind: string; input: string }> = [
  { id: "es-recipe", lang: "es", kind: "recipe", input: "Dame una receta de arroz con leche" },
  { id: "en-recipe", lang: "en", kind: "recipe", input: "Give me a recipe for banana bread" },
  { id: "es-steps", lang: "es", kind: "steps", input: "¿Cómo cambio una llanta del auto paso a paso?" },
  { id: "en-steps", lang: "en", kind: "steps", input: "How do I set up a new Wi-Fi router?" },
  { id: "es-list", lang: "es", kind: "list", input: "Hazme una lista de 10 ideas para un cumpleaños infantil" },
  { id: "en-detail", lang: "en", kind: "detail", input: "Explain in detail how vaccines work" },
];

interface Call { firstTokenMs?: number; ms: number; promptTokens?: number; cachedTokens?: number; generated?: number; finish?: string; tools: boolean }

/** llama-server's OpenAI endpoint, streamed (SSE): content and reasoning deltas, tool calls by index, finish and timings. */
function streamingEngine(calls: Call[]): CompletionEngine {
  return {
    async complete(req: EngineRequest): Promise<EngineResult> {
      if (req.prefill) return { text: "", toolCalls: [] };
      const started = Date.now();
      const body: Record<string, unknown> = {
        messages: req.messages,
        stream: true,
        temperature: req.sampling.temperature,
        top_p: req.sampling.topP,
        top_k: req.sampling.topK,
        ...(req.sampling.presencePenalty !== undefined ? { presence_penalty: req.sampling.presencePenalty } : {}),
        max_tokens: req.maxTokens + (req.thinking.enabled ? (req.thinking.budgetTokens ?? 2048) : 0),
        chat_template_kwargs: { enable_thinking: req.thinking.enabled },
        ...(req.thinking.enabled && req.thinking.budgetTokens ? { thinking_budget_tokens: req.thinking.budgetTokens } : {}),
        seed: Number(process.env.HERMIT_SEED ?? 7),
        ...(req.jsonSchema ? { response_format: { type: "json_schema", json_schema: { name: "hermit", schema: req.jsonSchema } } } : {}),
        ...(req.tools ? { tools: req.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } })), ...(req.toolChoice ? { tool_choice: req.toolChoice } : {}), parallel_tool_calls: false } : {}),
      };
      const res = await fetch(`${URL_BASE}/v1/chat/completions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok || !res.body) throw new Error(`llama-server ${res.status}`);
      const call: Call = { ms: 0, tools: Boolean(req.tools) };
      let text = "";
      const tools: Array<{ name: string; args: string }> = [];
      let buffer = "";
      const decoder = new TextDecoder();
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        buffer += decoder.decode(chunk, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (data === "[DONE]") continue;
          const json = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string | null; reasoning_content?: string | null; tool_calls?: Array<{ index: number; function?: { name?: string; arguments?: string } }> }; finish_reason?: string | null }>; timings?: { prompt_n?: number; cache_n?: number; predicted_n?: number } };
          const choice = json.choices?.[0];
          const delta = choice?.delta;
          if (delta?.reasoning_content) req.onThinking?.(delta.reasoning_content);
          if (delta?.content) {
            call.firstTokenMs ??= Date.now() - started;
            text += delta.content;
            req.onToken?.(delta.content);
          }
          for (const tc of delta?.tool_calls ?? []) {
            tools[tc.index] ??= { name: "", args: "" };
            if (tc.function?.name) tools[tc.index]!.name += tc.function.name;
            if (tc.function?.arguments) tools[tc.index]!.args += tc.function.arguments;
          }
          if (choice?.finish_reason) call.finish = choice.finish_reason;
          if (json.timings) {
            call.promptTokens = json.timings.prompt_n;
            call.cachedTokens = json.timings.cache_n;
            call.generated = json.timings.predicted_n;
          }
        }
      }
      call.ms = Date.now() - started;
      calls.push(call);
      const toolCalls = tools.filter(Boolean).map((t) => ({ name: t.name, arguments: safeJson(t.args) }));
      return { text, toolCalls, ...(call.finish === "length" ? { stop: "length" as const } : { stop: "end" as const }) };
    },
  };
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

/** What the reply looks like: list lines, headings, raw markdown left, lines said twice, its language. */
function shape(text: string, lang: "es" | "en") {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const items = lines.filter((l) => /^([-*•·]|\d{1,3}[.)])\s/.test(l)).length;
  const headings = lines.filter((l) => /^#{1,6}\s|^\*\*.+\*\*:?$|^[^.!?]{1,60}:$/.test(l)).length;
  const markdown = (text.match(/\*\*|^#{1,6}\s|`/gm) ?? []).length;
  const seen = new Set<string>();
  let repeats = 0;
  for (const l of lines.filter((x) => x.length > 12)) {
    const k = l.toLowerCase().replace(/^([-*•·]|\d{1,3}[.)])\s*/, "");
    if (seen.has(k)) repeats++;
    seen.add(k);
  }
  const said = userLanguage(text);
  const languageOk = !said || (lang === "es" ? said === "Spanish (Latin America)" : said === "English");
  return { chars: text.length, lines: lines.length, items, headings, markdown, repeats, languageOk };
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)]! : NaN;
};

async function speed() {
  const shipped = profileById("botpsy-q4-native-think256");
  if (!shipped) throw new Error("no shipped profile");
  const profile =
    config === "normal" ? { ...shipped, longReplyTokens: undefined }
    : config === "long-think" ? { ...shipped, longThinking: { mode: "on" as const, budgetTokens: 256 } }
    : shipped;
  const NOW = Date.parse("2026-11-11T21:00:00-06:00");
  const rows: unknown[] = [];
  const summary: Array<{ id: string; ttft: number; total: number; cut: boolean; taps: number; chars: number }> = [];
  for (const ask of ASKS) {
    const calls: Call[] = [];
    const port = createModelPort(streamingEngine(calls), profile, firstWinSkills, () => ({ language: "es-419", now: describeNowForModel(NOW, "America/Costa_Rica"), profile: [] }));
    const messages: Msg[] = [{ role: "user", content: ask.input }];
    const t0 = Date.now();
    let firstShown: number | undefined;
    const onToken = () => (firstShown ??= Date.now() - t0);
    const picked = await port.pick({ prefixCacheKey: "eval", messages, menu: firstWinSkills.map((s) => s.id), live: { onToken } });
    let text = picked.text ?? "";
    let cut = Boolean((picked as { cut?: boolean }).cut);
    if (picked.choice === "respond" && picked.text === undefined) {
      const r = await port.respond({ prefixCacheKey: "eval", messages }, onToken);
      text = typeof r === "string" ? r : r.text;
      cut = typeof r === "string" ? false : Boolean(r.cut);
    }
    const total = Date.now() - t0;
    // master has no cut flag: read it from the engine's own finish reason.
    const lengthStop = calls.some((c) => c.finish === "length" && !c.tools) || (calls.at(-1)?.finish === "length");
    if (config === "before") cut = lengthStop;
    // The prompt the first call read: what a phone must read before its first word (the S26: 4,400 tokens took 8 to 20 s).
    const prompt = (calls[0]?.promptTokens ?? 0) + (calls[0]?.cachedTokens ?? 0);
    const first = { ttftMs: firstShown ?? total, totalMs: total, promptTokens: prompt, choice: picked.choice, cut, calls: calls.length, generated: calls.reduce((n, c) => n + (c.generated ?? 0), 0), toolCalls: picked.choice !== "respond" && picked.choice !== "ask_user", ...shape(text, ask.lang) };
    // Seguir, on the branch, while the reply stays cut (at most 8 taps).
    const taps: Array<{ ttftMs: number; totalMs: number; cut: boolean; chars: number }> = [];
    let whole = text;
    if (port.continueReply && cut) {
      let history: Msg[] = [...messages, { role: "assistant", content: whole }];
      for (let i = 0; i < 8 && cut; i++) {
        const s0 = Date.now();
        let f: number | undefined;
        const next = await port.continueReply({ prefixCacheKey: "eval", messages: history }, () => (f ??= Date.now() - s0));
        whole += next.text;
        cut = Boolean(next.cut);
        taps.push({ ttftMs: f ?? Date.now() - s0, totalMs: Date.now() - s0, cut, chars: next.text.length });
        history = [...messages, { role: "assistant", content: whole }];
        if (!next.text) break;
      }
    }
    const row = { id: ask.id, config, ...first, taps, final: { ...shape(whole, ask.lang), stillCut: cut }, text: whole };
    rows.push(row);
    summary.push({ id: ask.id, ttft: first.ttftMs, total: first.totalMs + taps.reduce((n, t) => n + t.totalMs, 0), cut: first.cut, taps: taps.length, chars: whole.length });
    console.log(`${ask.id.padEnd(10)} ttft ${String(first.ttftMs).padStart(6)} ms  prompt ${String(first.promptTokens).padStart(5)} tok  first ${String(first.totalMs).padStart(6)} ms  ${first.choice}${first.toolCalls ? " (TOOL)" : ""}  cut ${first.cut}  gen ${first.generated} tok  ${first.chars} ch  items ${first.items} headings ${first.headings} md ${first.markdown} rep ${first.repeats} lang ${first.languageOk ? "ok" : "WRONG"}${taps.length ? `  | Seguir x${taps.length}: ${taps.map((t) => `${t.ttftMs}/${t.totalMs}ms${t.cut ? "+" : ""}`).join(" ")} -> ${whole.length} ch, rep ${row.final.repeats}, still cut ${cut}` : ""}`);
  }
  console.log(`\n${config}: median ttft ${median(summary.map((s) => s.ttft))} ms, median first reply ${median(rows.map((r) => (r as { totalMs: number }).totalMs))} ms, median prompt ${median(rows.map((r) => (r as { promptTokens: number }).promptTokens))} tok, median to the whole answer ${median(summary.map((s) => s.total))} ms, cut ${summary.filter((s) => s.cut).length}/${summary.length}, Seguir taps ${summary.reduce((n, s) => n + s.taps, 0)}`);
  if (out) writeFileSync(out, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
}

/**
 * The blind detection set (long-form-blind-cases.ts, written by a separate agent that never read the detector or the
 * model package). Blind means blind: only counts are printed and kept, never which case failed or its words, so
 * nothing can be tuned on it.
 */
async function detect() {
  const ask = (model as { longFormAsked?: (t: string) => string | undefined }).longFormAsked;
  if (!ask) throw new Error("this build has no long-form detector");
  const { LONG_FORM_BLIND } = await import("./long-form-blind-cases.ts");
  const rows: unknown[] = [];
  for (const lang of ["es", "en"]) {
    const cases = LONG_FORM_BLIND.filter((c) => c.lang === lang);
    let tp = 0, fp = 0, fn = 0, tn = 0, kind = 0;
    for (const c of cases) {
      const got = ask(c.input) ?? null;
      if (c.expect && got) tp++;
      else if (!c.expect && got) fp++;
      else if (c.expect && !got) fn++;
      else tn++;
      if (c.expect && got === c.expect) kind++;
    }
    const line = { lang, found: tp, longForm: tp + fn, falseAlarms: fp, notLongForm: fp + tn, rightKind: kind };
    rows.push(line);
    console.log(`${lang}: long-form found ${tp}/${tp + fn} (recall ${(tp / Math.max(1, tp + fn)).toFixed(2)}), false alarms ${fp}/${fp + tn} (precision ${(tp / Math.max(1, tp + fp)).toFixed(2)}), right kind ${kind}/${tp + fn}`);
  }
  if (out) writeFileSync(out, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
}

await (config === "detect" ? detect() : speed());
