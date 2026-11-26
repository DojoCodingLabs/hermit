import { cancel, completion, deleteCache, loadModel, subscribeServerLogs, unloadModel } from "@qvac/sdk";
import { budgetFor, engineStats, generationBudget, stopOf, type CompletionEngine, type ModelProfile, type RuntimeConditions, type RuntimePlan } from "@hermit/model";

type QvacTool = Extract<NonNullable<Parameters<typeof completion>[0]["tools"]>[number], { type: "function" }>;

/**
 * SL-09 (spike S1): the CompletionEngine over QVAC. The model runs in the bare worklet; this side only
 * sends requests and reads events. Tools come back unexecuted: the cage decides what runs (ADR-005).
 */
/**
 * With a device plan (docs/research/device-adaptive-runtime.md), threads, core mask, batch and context come
 * from the plan, and each request's thinking budget and reply cap shrink with heat and battery saver.
 */
export interface DeviceTuning {
  plan: RuntimePlan;
  conditions(): RuntimeConditions;
}

/**
 * Generation speed of the last call (tokens per second), whatever slowed it: memory pressure (other apps
 * running once left 89 MB free and the model at 0.23 tok/s), heat or contention. The runtime turns it
 * into a pressure level so budgets shrink when the phone is struggling.
 */
let lastTokensPerSecond: number | undefined;
export function observedTokensPerSecond(): number | undefined {
  return lastTokensPerSecond;
}

export async function qvacEngine(modelPath: string, profile: ModelProfile, tuning?: DeviceTuning): Promise<CompletionEngine & { close(): Promise<void> }> {
  // Dev diagnostics: only QVAC warnings and errors, and never a line that echoes a prompt or output.
  // (Its info logs include "Starting inference with prompt: ...", i.e. the conversation; FR-ACT-02, ADR-009.)
  subscribeServerLogs((entry) => {
    if (entry.level !== "warn" && entry.level !== "error") return;
    if (/prompt|content|messages|output/i.test(entry.message)) return;
    console.log("[qvac]", entry.level, entry.namespace, entry.message.slice(0, 200));
  });
  const t0 = Date.now();
  const threads = tuning ? `threads ${tuning.plan.threads}, batch ${tuning.plan.threadsBatch}${tuning.plan.cpuMask ? `, mask ${tuning.plan.cpuMask}` : ""}` : `threads ${profile.runtime.threads ?? "default"}`;
  console.log("[hermit:S1] loading model", profile.id, "on", profile.runtime.device, threads);
  // QVAC wants a filesystem path, not a file:// URI.
  const fsPath = modelPath.startsWith("file://") ? decodeURIComponent(modelPath.slice("file://".length)) : modelPath;
  const modelId = await loadModel({
    modelSrc: fsPath,
    modelType: "llamacpp-completion",
    modelConfig: {
      ctx_size: profile.runtime.ctxSize ?? (tuning ? Math.min(profile.contextTokens, tuning.plan.ctxSize) : profile.contextTokens),
      ...(profile.runtime.loadMode ? { load_mode: profile.runtime.loadMode } : {}),
      ...(tuning
        ? {
            threads: tuning.plan.threads,
            "threads-batch": tuning.plan.threadsBatch,
            "ubatch-size": tuning.plan.ubatch,
            ...(tuning.plan.cpuMask ? { "cpu-mask": tuning.plan.cpuMask, "cpu-mask-batch": tuning.plan.cpuMask } : {}),
          }
        : {}),
      // Render tools into the prompt with the model's own template and parse its calls. Without this QVAC
      // drops the tools silently and a native_tools request fails (docs/research/harness-inference.md, B1).
      tools: profile.format === "native_tools",
      device: profile.runtime.device,
      ...(profile.runtime.backend ? { backend: profile.runtime.backend } : {}),
      ...(!tuning && profile.runtime.threads ? { threads: profile.runtime.threads } : {}),
    },
  });

  console.log(`[hermit:S1] model loaded in ${Date.now() - t0} ms`);
  // Reclaim automatic caches from earlier runs that no request is using (keeps disk use bounded).
  await deleteCache({ auto: true }).catch(() => {});
  // Named caches (one per cache key) hold conversation content (Q35). Their file path includes a hash of the
  // system prompt, so each new prompt (hourly with the stable prefix) would add a file: keep one per key by
  // deleting the key's cache whenever its system prompt changes, and all of them at load and close.
  const named = new Map<string, string>();
  const dropNamed = async () => {
    for (const key of named.keys()) await deleteCache({ kvCacheKey: key }).catch(() => {});
    named.clear();
  };
  // A cache left by an earlier run of the app (the loop's key is "hermit-v1:<profile id>"): reclaim it at load.
  await deleteCache({ kvCacheKey: `hermit-v1:${profile.id}`.replace(/[^A-Za-z0-9_-]/g, "-") }).catch(() => {});
  return {
    async close() {
      await unloadModel({ modelId });
      await deleteCache({ auto: true }).catch(() => {});
      await dropNamed();
    },
    async complete(req) {
      // A stopped turn starts nothing (FR-LOOP-06).
      if (req.signal?.aborted) throw new Error("Stopped by the user.");
      const started = Date.now();
      // Heat and battery shrink thinking first, then the reply cap; never more than the profile asks. A free-text
      // reply's thinking comes on top of its cap (predict counts both), as on the Mac lab (generationBudget, Q155).
      const budget = tuning ? budgetFor(tuning.plan, tuning.conditions()) : undefined;
      const { predict, thinkTokens } = generationBudget(req, budget);
      const cacheKey = req.cacheKey ? req.cacheKey.replace(/[^A-Za-z0-9_-]/g, "-") : undefined;
      if (cacheKey) {
        const system = req.messages[0]?.role === "system" ? req.messages[0].content : "";
        const before = named.get(cacheKey);
        if (before !== undefined && before !== system) await deleteCache({ kvCacheKey: cacheKey }).catch(() => {});
        named.set(cacheKey, system);
      }
      let firstToken: number | undefined;
      const run = completion({
        modelId,
        history: req.messages,
        stream: true,
        ...(req.prefill && cacheKey ? { prefill: true } : {}),
        captureThinking: true,
        ...(req.jsonSchema ? { responseFormat: { type: "json_schema" as const, json_schema: { name: "hermit", schema: req.jsonSchema } } } : {}),
        // QVAC can't combine a response format with tools: a constrained call drops the tool block (the rare
        // fallback pays a full prompt read; every other call keeps the stable prefix).
        ...(req.tools && !req.jsonSchema ? { tools: req.tools.map((t) => ({ type: "function" as const, name: t.name, description: t.description, parameters: t.parameters as QvacTool["parameters"] })) } : {}),
        // Q35 (2026-11-12): the KV cache is on, accepting that QVAC writes it to the app's private
        // storage unencrypted (it encodes conversation content). Automatic keys hash the history, so a cache
        // is reused only when the prefix truly matches; each step then reads only what is new instead of the
        // whole ~1,800-token prompt. Leftovers are reclaimed at every model load.
        // A named key, not `true`: with a key QVAC sends the whole prompt and the addon keeps the longest
        // prefix it already holds, decoding only the rest. Automatic keys need the exact earlier history
        // (hashed, tool-call turns never cached), which Hermit's prompts never repeated. The system prompt is
        // part of the file path, so the stable-prefix profile changes it once a day.
        kvCache: cacheKey ?? true,
        generationParams: {
          temp: req.sampling.temperature,
          top_p: req.sampling.topP,
          top_k: req.sampling.topK,
          ...(req.sampling.presencePenalty !== undefined ? { presence_penalty: req.sampling.presencePenalty } : {}),
          predict,
          // FR-MODEL-05: 0 turns the reasoning channel off; a positive number caps it.
          reasoning_budget: thinkTokens === Infinity ? -1 : thinkTokens,
          ...(req.toolChoice && !req.jsonSchema && !req.prefill ? { tool_choice: req.toolChoice } : {}),
          parallel_tool_calls: false,
        },
      });
      // Stop (US-CHAT-06): cancel exactly this run in the worklet, so the phone stops generating at once
      // instead of finishing a reply nobody will read. A cancel that races the run's start is applied when it begins.
      const onAbort = () => {
        void cancel({ requestId: run.requestId }).catch(() => {});
        // Nobody awaits a cancelled run's result; keep its rejection from surfacing as unhandled.
        void run.final.catch(() => {});
      };
      req.signal?.addEventListener("abort", onAbort, { once: true });
      // Dev only: what a call wrote when it ran into its token cap (fast-route calls hit 200 every time on
      // the S26 but stop at about 70 on llama-server; this shows what QVAC keeps generating).
      let seen = "";
      let final: Awaited<typeof run.final>;
      try {
        for await (const e of run.events) {
          if (req.signal?.aborted) break;
          if (e.type === "thinkingDelta") {
            req.onThinking?.(e.text);
            if (__DEV__) seen += e.text;
          }
          if (e.type === "contentDelta") {
            firstToken ??= Date.now();
            req.onToken?.(e.text);
            if (__DEV__) seen += e.text;
          }
        }
        if (req.signal?.aborted) throw new Error("Stopped by the user.");
        final = await run.final;
      } finally {
        req.signal?.removeEventListener("abort", onAbort);
      }
      if (req.signal?.aborted) throw new Error("Stopped by the user.");
      const generated = (final.stats as { generatedTokens?: number } | undefined)?.generatedTokens ?? 0;
      const tps = (final.stats as { tokensPerSecond?: number } | undefined)?.tokensPerSecond;
      if (typeof tps === "number" && Number.isFinite(tps) && generated >= 8) lastTokensPerSecond = tps;
      // Q155: QVAC says why it ended (stopReason "length" when generatedTokens reached predict or the context filled);
      // the count against predict is the fallback for a runtime that doesn't. A cut reply is never shown as finished.
      const stop = stopOf({ ...(final.stopReason ? { stopReason: final.stopReason } : {}), generatedTokens: generated }, predict);
      if (__DEV__ && stop === "length") console.log(`[hermit:S1] hit the ${predict}-token cap; tail: ${JSON.stringify(seen.slice(-400))} calls ${final.toolCalls.length}`);
      const kind = req.jsonSchema ? "schema" : req.tools ? "tools" : "text";
      // The log line carries the parameters this call ran with, so a stale bundle from an old Metro watcher shows.
      console.log(`[hermit:S1] ${kind} completion: predict ${predict}, think ${thinkTokens === Infinity ? -1 : thinkTokens}, stop ${stop}, first token ${firstToken ? firstToken - started : -1} ms, total ${Date.now() - started} ms, stats ${JSON.stringify(final.stats ?? {})}`);
      // The runtime's own speeds for this call, for the Device lab's speed probe.
      const stats = engineStats(final.stats);
      return { text: final.contentText, toolCalls: final.toolCalls.map((c) => ({ name: c.name, arguments: c.arguments })), stop, ...(stats ? { stats } : {}) };
    },
  };
}
