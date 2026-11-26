/**
 * FR-MODEL-05: a model profile is the model file plus every setting that changes its behavior,
 * pinned and evaluated together. The eval picks the profile that meets PDR-003 with the best accuracy.
 */
export interface ModelFile {
  id: string;
  /** Pinned to a repository revision, HTTPS only (ADR-008). */
  url: string;
  sha256: string;
  size: number;
  license: string;
}

export type Thinking = { mode: "off" } | { mode: "on"; budgetTokens: number };
/** two_stage: pick from the enum, then fill the schema (ADR-004). native_tools: the model's own tool-call format, grammar-constrained. */
export type DecodingFormat = "two_stage" | "native_tools";

export interface Sampling {
  temperature: number;
  topP: number;
  topK: number;
  presencePenalty?: number;
}

/**
 * Where the model runs. Measured on the S26 (SM8850), BotPsy-0.8B Q4_K_M: CPU with 8 threads decodes
 * 21 to 32 tok/s and reads prompts at 450 to 500 tok/s; OpenCL about 8 and 160; QVAC's GPU default about
 * 6 and 110; Vulkan broke grammar-constrained decoding. Small models win on CPU.
 */
export interface ModelRuntime {
  device: "cpu" | "gpu";
  threads?: number;
  backend?: Array<"vulkan" | "opencl">;
  /**
   * How the weights are loaded. "mmap" (the default) maps the file, so under memory pressure Android drops the
   * pages and re-reads them from storage on every token. "none" reads them into RAM, which compressed swap
   * can hold. Android caps pinned memory at 64 KB per app, so mlock is not an option.
   */
  loadMode?: "mmap" | "none";
  /** Context size override (tokens); a smaller KV cache leaves room when memory is tight. */
  ctxSize?: number;
}

export interface ModelProfile {
  id: string;
  file: ModelFile;
  thinking: Thinking;
  format: DecodingFormat;
  sampling: Sampling;
  /** Upper bound on tokens for a free-text reply. */
  maxReplyTokens: number;
  /**
   * Q155: the cap for a long answer the user asked for (a recipe, steps, a list, a detailed explanation), when the
   * phone allows it (budgetFor's longReplyTokens) and the context leaves room (longReplyCap). Absent: no long answers.
   */
  longReplyTokens?: number;
  /** Q155: thinking for those long answers. Off unless set: the words should start at once. */
  longThinking?: Thinking;
  /** Context the prompt and history must fit in (FR-LOOP-07). */
  contextTokens: number;
  runtime: ModelRuntime;
  /** System prompt style: "menu" (default) lists skills and examples in prose; "slim" leaves tools to the chat template. On 124 cases menu scored 91 and slim 80 (harness-diagnosis.md). */
  prompt?: "menu" | "slim";
  /** When the router forces a skill, skip the thinking call and fill the arguments with one short constrained call. */
  fastRoute?: boolean;
  /** Byte-stable prefix: all skills as tools in a fixed order, a daily system prompt, per-turn details in a note on the latest user message, and fallbacks that keep the tool block. */
  stablePrefix?: boolean;
}

const BOTPSY_REVISION = "17bb36aa29c58fcde8e321aaaad3f2f7372aa655";

/** Tether's BotPsy-0.8B, Q4_K_M (docs/research/botpsy.md). Hashes from the Hugging Face tree at the pinned revision. */
export const BOTPSY_Q4: ModelFile = {
  id: "botpsy-0.8b-q4_k_m",
  url: `https://huggingface.co/qvac/BotPsy-0.8B-GGUFs/resolve/${BOTPSY_REVISION}/botpsy-0.8b-q4_k_m-imat.gguf`,
  sha256: "482db2dfdbc8ab7db3d3216fd8ef071d7381dd8547aff9933bc03312839d4d83",
  size: 529_296_960,
  license: "Apache-2.0",
};

/** Qwen3.5 Q4_K_M builds from unsloth (Apache 2.0), pinned for the on-phone eval (Q29). */
export const QWEN35_2B_Q4: ModelFile = {
  id: "qwen3.5-2b-q4_k_m",
  url: "https://huggingface.co/unsloth/Qwen3.5-2B-GGUF/resolve/f6d5376be1edb4d416d56da11e5397a961aca8ae/Qwen3.5-2B-Q4_K_M.gguf",
  sha256: "aaf42c8b7c3cab2bf3d69c355048d4a0ee9973d48f16c731c0520ee914699223",
  size: 1_280_835_840,
  license: "Apache-2.0",
};

export const QWEN35_4B_Q4: ModelFile = {
  id: "qwen3.5-4b-q4_k_m",
  url: "https://huggingface.co/unsloth/Qwen3.5-4B-GGUF/resolve/e87f176479d0855a907a41277aca2f8ee7a09523/Qwen3.5-4B-Q4_K_M.gguf",
  sha256: "00fe7986ff5f6b463e62455821146049db6f9313603938a70800d1fb69ef11a4",
  size: 2_740_937_888,
  license: "Apache-2.0",
};

const QWEN_SAMPLING: Sampling = { temperature: 0.3, topP: 0.9, topK: 20 };

/** The card's recommended sampling (temperature 0.3, top_p 0.95, top_k 20, presence penalty 1.5). */
const BOTPSY_SAMPLING: Sampling = { temperature: 0.3, topP: 0.95, topK: 20, presencePenalty: 1.5 };

const CPU8: ModelRuntime = { device: "cpu", threads: 8 };

/**
 * The profiles the evals compare. PROFILES[0] is the shipped default (Q30, 2026-11-11): BotPsy's own tool
 * format with thinking capped at 256 tokens, which closes the think block cleanly. On the Mac it scored
 * 116/124 on the VA set against 91 for the JSON harness (docs/research/harness-diagnosis.md).
 */
/**
 * Q155: long answers when asked, about 800 tokens while the phone is cool. Thinking off for them, measured on the Mac
 * lab with the phone's GGUF (docs/build/long-answers-2026-11-21.md): the words start at once and the structure holds.
 */
const LONG_ANSWERS = { longReplyTokens: 800, longThinking: { mode: "off" } } as const satisfies Pick<ModelProfile, "longReplyTokens" | "longThinking">;

export const PROFILES: readonly ModelProfile[] = [
  { id: "botpsy-q4-native-think256", file: BOTPSY_Q4, thinking: { mode: "on", budgetTokens: 256 }, format: "native_tools", sampling: BOTPSY_SAMPLING, maxReplyTokens: 120, ...LONG_ANSWERS, contextTokens: 8192, runtime: CPU8 },
  { id: "botpsy-q4-native-nothink", file: BOTPSY_Q4, thinking: { mode: "off" }, format: "native_tools", sampling: BOTPSY_SAMPLING, maxReplyTokens: 120, ...LONG_ANSWERS, contextTokens: 8192, runtime: CPU8 },
  { id: "botpsy-q4-two-stage-nothink", file: BOTPSY_Q4, thinking: { mode: "off" }, format: "two_stage", sampling: BOTPSY_SAMPLING, maxReplyTokens: 120, ...LONG_ANSWERS, contextTokens: 8192, runtime: CPU8 },
];

/** Candidates the on-phone eval compares (Q29). PROFILES[0] stays the shipped default until the eval decides. */
export const EVAL_PROFILES: readonly ModelProfile[] = [
  ...PROFILES,
  // Phone speed variants of the shipped profile (11 s per first action on the S26 at thinking 256).
  { ...PROFILES[0]!, id: "botpsy-q4-native-think256-fast", fastRoute: true },
  { ...PROFILES[0]!, id: "botpsy-q4-native-think128", thinking: { mode: "on", budgetTokens: 128 } },
  { ...PROFILES[0]!, id: "botpsy-q4-native-think128-fast", thinking: { mode: "on", budgetTokens: 128 }, fastRoute: true },
  // Prompt-cache variants (harness-sota-parity.md priority 0): one byte-stable prefix for every call.
  { ...PROFILES[0]!, id: "botpsy-q4-native-think256-stable", stablePrefix: true },
  { ...PROFILES[0]!, id: "botpsy-q4-native-think256-fast-stable", fastRoute: true, stablePrefix: true },
  { id: "qwen35-2b-q4-two-stage-nothink", file: QWEN35_2B_Q4, thinking: { mode: "off" }, format: "two_stage", sampling: QWEN_SAMPLING, maxReplyTokens: 120, contextTokens: 8192, runtime: CPU8 },
  { id: "qwen35-4b-q4-two-stage-nothink", file: QWEN35_4B_Q4, thinking: { mode: "off" }, format: "two_stage", sampling: QWEN_SAMPLING, maxReplyTokens: 120, contextTokens: 8192, runtime: CPU8 },
];

export function profileById(id: string): ModelProfile | undefined {
  return EVAL_PROFILES.find((p) => p.id === id);
}
