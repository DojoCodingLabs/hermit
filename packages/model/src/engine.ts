import type { JsonSchema, StopSignal } from "@hermit/core";

/**
 * The slice of a completion runtime Hermit needs. QVAC's `completion()` implements it on the phone
 * (`responseFormat: json_schema` becomes a GBNF grammar in llama.cpp; tools are returned unexecuted).
 * Tests and the eval use fakes. Nothing here knows about React Native.
 */
export interface EngineMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
}

export interface EngineTool {
  name: string;
  description: string;
  parameters: JsonSchema;
}

export interface EngineRequest {
  messages: EngineMessage[];
  /** Constrain the whole output to this JSON schema. */
  jsonSchema?: JsonSchema;
  /** Offer tools in the model's native format; `toolChoice: "required"` forces exactly one call. */
  tools?: EngineTool[];
  toolChoice?: "auto" | "required" | "none";
  thinking: { enabled: boolean; budgetTokens?: number };
  sampling: { temperature: number; topP: number; topK: number; presencePenalty?: number };
  maxTokens: number;
  /** Reuse the KV cache for an identical prompt prefix. */
  cacheKey?: string;
  /** Process the prompt into the cache without generating (needs a cache key). */
  prefill?: boolean;
  /** The user stopped the turn (FR-LOOP-06): cancel the run and reject. */
  signal?: StopSignal;
  /**
   * Q155: a long answer the user asked for. A device-tuned engine lets it run to maxTokens only while the phone is cool
   * (budgetFor's longReplyTokens); otherwise the normal reply cap holds. Words only: never with tools or a schema.
   */
  longForm?: boolean;
  onToken?(token: string): void;
  /** Reasoning tokens (QVAC thinkingDelta), for the collapsible thinking panel. Never the answer. */
  onThinking?(token: string): void;
}

export interface EngineResult {
  text: string;
  toolCalls: Array<{ name: string; arguments: unknown }>;
  /**
   * Why generation ended (Q155): "end" when the model finished (or hit a stop sequence), "length" when it used up its
   * token budget (or the context window) so the text stops short, "cancelled" when something other than this turn's
   * stop ended it. A stop the user asked for never resolves: the call rejects. Absent means the runtime couldn't say,
   * which is read as "end": nothing is reported cut on a guess.
   */
  stop?: EngineStop;
  /** What the runtime measured for this call, when it says. The Device lab reads it; nothing else depends on it. */
  stats?: EngineStats;
}

export type EngineStop = "end" | "length" | "cancelled";

export interface EngineStats {
  /** Generation speed, tokens per second. */
  tokensPerSecond?: number;
  /** Prompt reading speed, tokens per second. */
  promptTokensPerSecond?: number;
  /** The runtime's own time to the first token, in milliseconds. */
  timeToFirstTokenMs?: number;
  promptTokens?: number;
  generatedTokens?: number;
}

/** The speeds and counts from a runtime's stats (QVAC's completion stats): finite, non-negative numbers only. */
export function engineStats(raw: unknown): EngineStats | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const out: EngineStats = {};
  const keep = (from: string, to: keyof EngineStats) => {
    const v = r[from];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) out[to] = v;
  };
  keep("tokensPerSecond", "tokensPerSecond");
  keep("promptTokensPerSecond", "promptTokensPerSecond");
  keep("timeToFirstToken", "timeToFirstTokenMs");
  keep("promptTokens", "promptTokens");
  keep("generatedTokens", "generatedTokens");
  return Object.keys(out).length ? out : undefined;
}

/**
 * The stop reason from a runtime's own report: QVAC's `stopReason` (eos, stopSequence, length, cancelled; llama-server's
 * `finish_reason` maps the same way), else the generated count against the budget it was given, the way QVAC itself
 * decides "length" (`stoppedByLength`: generatedTokens >= predict). Nothing known is "end".
 */
export function stopOf(final: { stopReason?: string; generatedTokens?: number } | undefined, predict: number): EngineStop {
  const reason = final?.stopReason;
  if (reason === "eos" || reason === "stopSequence" || reason === "stop") return "end";
  if (reason === "length") return "length";
  if (reason === "cancelled") return "cancelled";
  const generated = final?.generatedTokens;
  return predict > 0 && generated !== undefined && generated >= predict ? "length" : "end";
}

export interface CompletionEngine {
  complete(req: EngineRequest): Promise<EngineResult>;
}
