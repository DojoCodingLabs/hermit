import { stopOf, type CompletionEngine, type EngineRequest, type EngineResult, type EngineStop } from "@hermit/model";

/** One raw exchange, kept so a failed case shows what the model actually wrote. */
export interface Trace {
  kind: "schema" | "tools" | "text";
  /** The last turns sent, for reading a failed trajectory. */
  tail: Array<{ role: string; content: string }>;
  reasoning: string;
  text: string;
  toolCalls: EngineResult["toolCalls"];
  ms: number;
  /** Prompt tokens llama.cpp had to read, and tokens it reused from the cache. */
  promptTokens?: number;
  cachedTokens?: number;
  /** Why the completion ended (Q155): "length" means it ran out of tokens. */
  stop?: EngineStop;
}

/**
 * The CompletionEngine over llama.cpp's llama-server (OpenAI-compatible, started with --jinja), for running
 * the eval on a desktop. Same GGUF and same harness as the phone; only the runtime differs, so accuracy
 * carries over (speed does not). QVAC wraps llama.cpp too.
 */
export function llamaServerEngine(baseUrl: string, traces: Trace[] = []): CompletionEngine {
  return {
    async complete(req: EngineRequest): Promise<EngineResult> {
      const started = Date.now();
      // llama-server keeps the prefix by itself (and reuses it across cases); nothing to warm.
      if (req.prefill) return { text: "", toolCalls: [] };
      const body: Record<string, unknown> = {
        messages: req.messages,
        temperature: req.sampling.temperature,
        top_p: req.sampling.topP,
        top_k: req.sampling.topK,
        ...(req.sampling.presencePenalty !== undefined ? { presence_penalty: req.sampling.presencePenalty } : {}),
        max_tokens: req.maxTokens + (req.thinking.enabled ? (req.thinking.budgetTokens ?? 2048) : 0),
        chat_template_kwargs: { enable_thinking: req.thinking.enabled },
        // A hard budget that closes the think block cleanly, like QVAC's reasoning_budget on the phone.
        ...(req.thinking.enabled && req.thinking.budgetTokens ? { thinking_budget_tokens: req.thinking.budgetTokens } : {}),
        seed: Number(process.env.HERMIT_SEED ?? 7),
        ...(req.jsonSchema ? { response_format: { type: "json_schema", json_schema: { name: "hermit", schema: req.jsonSchema } } } : {}),
        ...(req.tools
          ? {
              tools: req.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } })),
              ...(req.toolChoice ? { tool_choice: req.toolChoice } : {}),
              parallel_tool_calls: false,
            }
          : {}),
      };
      const res = await fetch(`${baseUrl}/v1/chat/completions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(`llama-server ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const json = (await res.json()) as {
        choices: Array<{ finish_reason?: string | null; message: { content?: string | null; reasoning_content?: string | null; tool_calls?: Array<{ function: { name: string; arguments: string } }> } }>;
        timings?: { prompt_n?: number; cache_n?: number; predicted_n?: number };
      };
      const choice = json.choices[0]!;
      const msg = choice.message;
      const toolCalls = (msg.tool_calls ?? []).map((c) => ({ name: c.function.name, arguments: parseArgs(c.function.arguments) }));
      const text = msg.content ?? "";
      req.onToken?.(text);
      // Q155: llama-server's finish_reason ("length" when max_tokens ran out), else the count, as on the phone.
      const stop = stopOf({ ...(choice.finish_reason ? { stopReason: choice.finish_reason } : {}), ...(json.timings?.predicted_n !== undefined ? { generatedTokens: json.timings.predicted_n } : {}) }, Number(body.max_tokens));
      traces.push({ kind: req.jsonSchema ? "schema" : req.tools ? "tools" : "text", tail: req.messages.slice(-2).map((m) => ({ role: m.role, content: m.content.slice(0, 400) })), reasoning: msg.reasoning_content ?? "", text, toolCalls, ms: Date.now() - started, promptTokens: json.timings?.prompt_n, cachedTokens: json.timings?.cache_n, stop });
      return { text, toolCalls, stop };
    },
  };
}

function parseArgs(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}
