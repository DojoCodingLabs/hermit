# Device-adaptive runtime: making BotPsy-0.8B fast and accurate on any phone

Read 2026-11-11. Two parts. First, the QVAC code we actually ship, read from `node_modules` (no network). Second, web research on mobile llama.cpp practice, with sources. Hermit code read: `apps/mobile/src/adapters/qvac-engine.ts`, `apps/mobile/src/adapters/device.ts`, `packages/model/src/profile.ts`, `packages/model/src/prompt.ts`.

Paths below are abbreviated:

- `SDK/` = `node_modules/.pnpm/@qvac+sdk@0.23.0_c16f6548d648c0b63022b1f6cb3c51f5/node_modules/@qvac/sdk/dist/`
- `INF/` = `node_modules/.pnpm/@qvac+inference@0.23.0_1902d49843acebfaef6ca9639338b6bf/node_modules/@qvac/inference/dist/`
- `ADDON/` = `node_modules/.pnpm/@qvac+llm-llamacpp@0.65.1_@qvac+fabric-android-arm64@0.25.0_@qvac+fabric-ios@0.25.0_bar_a1ff73d862883c5db6f8e7ef539b55e9/node_modules/@qvac/llm-llamacpp/`
- `FABRIC-A/` = `node_modules/.pnpm/@qvac+fabric-android-arm64@0.25.0/node_modules/@qvac/fabric-android-arm64/prebuilds/android-arm64/qvac__fabric-android-arm64/`

Labels: **[code]** read in the installed package; **[web]** from a cited source; **[computed]** our arithmetic; **[uncertain]** inference that needs a phone to confirm.

## 1. Bottom line

The single biggest lever is not threads or quantization. It is that every agent step today re-reads the whole prompt (tools plus system plus history, about 1,000 to 1,500 tokens before any history) at 450 to 500 tok/s, so 2 to 3 s of prefill per step on a flagship and far more on a low-end phone. QVAC can keep that prefix in memory, but the SDK writes it to disk after every turn, which is why we turned it off. A small patch fixes that.

Ranked by expected impact on what the user feels (time to first action, then decode speed, then accuracy):

| # | Optimization | Expected impact | QVAC today | What we need |
|---|---|---|---|---|
| 1 | **In-memory prompt cache** (reuse the tools plus system prefix and the growing agent-loop history; only the new suffix is decoded) | Largest. Prefill per agent step drops from the whole prompt to the new tokens (a tool result, a user turn). On the S26 that is roughly 2 to 3 s saved per step; on a low-end phone with 5x slower prefill, 10 s or more [computed] | Partly. `completion({ kvCache: "<key>" })` plus load option `cache_checkpoints` (int 0 to 1024, default 1) and `cache_checkpoint_storage: "memory"` (default) [code: `INF/schemas/llamacpp-config.js`]. The addon has a run option `ephemeral: boolean` ("keep this conversation in memory only") [code: `ADDON/index.d.ts:545-556`]. **But the SDK never forwards `ephemeral` and calls `saveCache(cachePath)` after every custom-key turn** [code: `INF/plugins/builtin/llamacpp-completion/ops/completion-stream.js:138-147, 300-305`] | **Local patch now** (`pnpm patch @qvac/inference`: pass `ephemeral: true`, skip `saveCacheFile`), and an **upstream request** to expose `ephemeral` on `completion()`. Details in 2.5 |
| 2 | **Threads = performance cores only**, chosen by calibration, separate prompt threads | Large on big.LITTLE phones (most mid and low end). llama.cpp's default uses every core on Android, including little cores; one report shows "8 threads causes 55% tg regression" on a Snapdragon 8 Elite [web 1, 2]. Neutral on the S26 (SM8850 has no efficiency cores, which is why 8 threads works there) | Yes: `threads` (int), `'threads-batch'` (int), `'cpu-mask'` (hex string), `'cpu-mask-batch'` (hex string), `poll`, `pollBatch` (0 to 100) [code: `INF/schemas/llamacpp-config.js`]. Affinity works on Android (`sched_setaffinity`), is a no-op on Apple [web 3] | Hermit side: detect core clusters (native module reading `/sys/devices/system/cpu/cpu*/cpufreq/cpuinfo_max_freq`) and calibrate. Thread count is **load-time only**: llamacpp has no `reload`, so a change costs an unload plus load (about 2 s on the S26) [code: `INF/handlers/load-model/handler.js:261`, `ADDON/index.js` has no `reload` method] |
| 3 | **Keep weight repacking on and keep Q4_K_M** | Large, and already on. Arm measured exactly Qwen3.5-0.8B Q4_K_M on a vivo X300: 44.8 vs 19.1 tok/s decode and 442 vs 2,143 ms TTFT with repack vs without, MMLU unchanged [web 4]. Our 21 to 40 tok/s on the S26 is consistent with repack being active | Yes, built in. Every Android CPU variant contains `CPU_REPACK` with repacked layouts for `q4_0`, `q4_K`, `q5_K`, `q6_K`, `q8_0`, `iq4_nl` [code: `strings FABRIC-A/libqvac-ggml-cpu-android_*.so`]. QVAC ships 7 Android CPU variants picked at runtime: `armv8.0_1`, `armv8.2_1`, `armv8.2_2`, `armv8.6_1`, `armv9.0_1`, `armv9.2_1`, `armv9.2_2` [code: file list] | Nothing to change. Do **not** set `load_mode: "none"` or anything that defeats repack. Confirm in a verbose log line `repack tensor ... with q4_K_8x8` on each tier |
| 4 | **Stable prompt prefix** (byte-identical tools block and static rules; volatile text after) | Precondition for #1. Any change in the tool list or above the cut invalidates the whole cached prefix | n/a (our prompt). The Qwen3.5 template renders tools first, then our system text [docs/research/harness-inference.md:57]. `prompt.ts:36-47` already puts `Now:` and profile facts last | Always send the same tool list in the same order; narrow choices with `tool_choice` or grammar, never by dropping tools from the prompt (also in harness-diagnosis.md:71) |
| 5 | **Warm the cache at load** (prefill the static prefix before the user speaks) | First request after app open skips the 1,000 to 1,500 token prefix | Yes: `completion({ ..., kvCache: key, prefill: true })` ("evaluate the prompt without generating an answer. Requires an enabled KV cache") [code: `INF/schemas/completion-stream.js` `completionParamsSchema.prefill`] | Depends on #1 (ephemeral) |
| 6 | **Thermal and battery adaptation** (shrink thinking budget and reply caps first; drop threads only at a safe point) | Keeps latency stable after a few minutes of use instead of collapsing under throttling. Sustained phone LLM runs throttle | Per request: `generationParams.reasoning_budget` (int, -1 to 2^31-1), `generationParams.predict` [code: `INF/schemas/completion-stream.js:59-65`]. Threads need a reload (#2). No thermal API in QVAC | Hermit native module: Android `PowerManager.getThermalHeadroom` / `addThermalStatusListener`, iOS `ProcessInfo.thermalState`; `expo-battery` `isLowPowerModeEnabledAsync` [web 8, 9] |
| 7 | **Memory-aware load and context** | Avoids OOM kills on 4 GB phones. KV cache is tiny for this model, so context is cheap: about 12 KiB per token, 96 MiB at 8K in f16, plus about 19 MiB of recurrent state [computed from the Qwen3.5-0.8B config, web 5] | Yes: `ctx_size`, `'ubatch-size'` (default 512), `'batch-size'` (default 2048), `fit` (default true), `'fit-target'`, `'fit-ctx'`, `modelFitPolicy: "log" \| "refuse" \| "off"` on `loadModel`, `assessModelFit()`, `getSystemResources({ sample: true })` with `processAvailableBytes` (iOS `os_proc_available_memory`) [code: `INF/schemas/llamacpp-config.js`, `INF/schemas/system-resources.js:128-137`, `SDK/src/client/api/load-model.d.ts`] | Hermit side: tier rules (section 2.6), handle `onTrimMemory` / memory warnings by unloading when backgrounded |
| 8 | **Prefill batch tuning** (`ubatch-size` 128 to 512) | Small to medium on prefill, and lowers the compute buffer on low-RAM phones [uncertain: no phone sweep published] | Yes: `'batch-size'`, `'ubatch-size'` | Calibrate on low tier only |
| 9 | **GPU backends** | On the S26 they lose (OpenCL about 8 tok/s, default GPU about 6, Vulkan broke grammar). For a 0.8B model CPU wins on Android [measured]. On iOS Metal may win on prefill [uncertain] | Yes: `device: "gpu" \| "cpu"`, `backend: Array<"cuda" \| "vulkan" \| "metal" \| "opencl" \| "auto">`, `openclCacheDir` (string, "required on Android for fast GPU startup"). Built-in device default already forces CPU on Pixels [code: `INF/runtime/model-config-utils.js:46-68`] | Android: CPU only; never Vulkan for grammar runs. iOS: calibrate Metal vs CPU with the sanity check |
| 10 | **KV cache quantization** (`cache-type-k`/`cache-type-v` = `q8_0`/`q4_0`) | Not worth it. Saves under 70 MB at 8K on this model [computed]; the addon itself keeps `f16` on CPU because "ARM CPU q8_0 has a quality/throughput cost" [code: `ADDON/README.md:225`]; small Qwen models are more sensitive [web 6] | Yes, but leave unset | None |
| 11 | **Flash attention** | Small either way: only 6 of 24 layers are full attention [web 5]. Addon default is `'on'` [code: `ADDON/README.md:210`] | Yes: `'flash-attn': "on" \| "off" \| "auto"` | One A/B on a low-end phone (open item) |
| 12 | **Speculative decoding** | Not worth it for 0.8B: no smaller draft, and draft overhead loses on consumer hardware in most configs [web 7] | Yes: `spec_type: "none" \| "draft-mtp" \| "draft-dflash"`, `spec_draft_n_max`, `spec_draft_n_min`, `spec_draft_p_min`, `draftModelSrc`. BotPsy GGUF has no MTP head [uncertain] | None |
| 13 | **Quant per tier** (Q8_0 for high tier if more accurate; Q4_0 for low tier only if measurably faster) | Unknown until measured. Q4_K_M already repacks, so Q4_0's usual speed edge shrinks [uncertain]. Q8_0 roughly doubles weight bytes, so decode is slower but may answer better | Tether publishes BotPsy in BF16, Q8_0 and Q4_K_M only (docs/research/botpsy.md:9). Q4_0 would be our own quant from BF16 with an imatrix, pinned and hosted | Eval on the Mac first (accuracy is reproducible there, harness-diagnosis.md:3), phone second (speed) |
| 14 | **SME2 / KleidiAI kernels** | Potentially large on SME2 SoCs (Snapdragon 8 Elite Gen 5, Dimensity 9500, Exynos 2600) [web 10] | No. No KleidiAI symbols in the Android CPU variants [code: strings]. The `armv9.2_*` variants exist, but without KleidiAI ggml has no SME matmul path [uncertain] | Upstream request to Tether: build fabric with `GGML_CPU_KLEIDIAI` and benchmark |

Not useful for us: `parallel` (one user), `cache_ram_mib` (we keep one conversation; it is a write-back tier that ends in files unless entries are ephemeral), `'kv-offload'`, `split-mode`, MoE keys, `rpc-servers`.

**Update 2026-11-24 (row 2): Android's cpusets.** Row 2's "neutral on the S26" was wrong for an app on screen. On the Galaxy S26 Ultra the app ran in the "foreground" cpuset, cores 0-5, although all 8 were online ("top-app" is 0-7, "background" and "system-background" 0-1,4-5), and `availableProcessors()` still counted 8. Eight model threads spin-waited on 6 cores: 0.2 tok/s and 9.3 s to the first token. A sweep with the dev eval screen in that cpuset gave 6 threads 31 to 43 tok/s, 5 threads 37 to 42 with the first token in 0.3 s, 4 threads 31 and 2 threads 21. The plan now counts the cores this process may use (`Cpus_allowed_list` in `/proc/self/status`), keeps one of them for the interface, caps at 5, and the engine loads again at a safe point when the set changes (`threadPlan` and `threadsReload` in `packages/model/src/runtime.ts`, `apps/mobile/src/engine-slot.ts`).

## 2. Design for Hermit

### 2.1 What QVAC exposes, exactly (for the implementer)

Load time, `loadModel({ modelSrc, modelType: "llamacpp-completion", modelConfig, modelFitPolicy? })`, schema `llmConfigBaseSchema` in `INF/schemas/llamacpp-config.js`:

| Key | Type | Default | Use in Hermit |
|---|---|---|---|
| `device` | `"gpu" \| "cpu"` (string) | `"gpu"` | `"cpu"` on Android; calibrated on iOS |
| `backend` | `Array<"cuda"\|"vulkan"\|"metal"\|"opencl"\|"auto">` | native order | iOS `["metal"]` when calibrated GPU; never `vulkan` |
| `threads` | int; unset = one per physical core; `<= 0` = every logical CPU | physical cores | calibrated |
| `'threads-batch'` | int | same as `threads` | calibrated (prompt reading can use more cores than decode) |
| `'cpu-mask'`, `'cpu-mask-batch'` | hex string, e.g. `"f0"` | no affinity | Android only, big-core mask |
| `poll`, `pollBatch` | int 0 to 100 | 0 in the addon (`ADDON/README.md:184`) | leave 0 (spinning costs battery and heat) |
| `ctx_size` | number | 1024 in the SDK | 8192 (4096 on the floor tier) |
| `'batch-size'`, `'ubatch-size'` | int | 2048, 512 | 512/512; 256 on low tier if calibration says so |
| `'flash-attn'` | `"on"\|"off"\|"auto"` | `"on"` | leave unless the A/B says otherwise |
| `'cache-type-k'`, `'cache-type-v'` | string (`f16`, `q8_0`, `q4_0`, ...) | `f16` on CPU | leave unset |
| `load_mode` | `"none"\|"mmap"\|"mlock"\|"mmap+mlock"\|"dio"` | `"mmap"` | leave `mmap` (mlock fails silently above `RLIMIT_MEMLOCK` on phones [web 9]) |
| `cache_checkpoints` | int 0 to 1024 | 1 | 4 (prefix plus recent turns; about 20 MB each on Qwen3.5-0.8B per `ADDON/README.md:205`) |
| `cache_checkpoints_max_bytes` | int | 0 (unlimited) | cap per tier (for example 100 MB) |
| `cache_checkpoint_storage` | `"memory"\|"disk"` | `"memory"` | `"memory"`, explicitly (privacy) |
| `reasoning_budget` | int -1 to 2^31-1 | -1 | per request instead |
| `fit`, `'fit-target'`, `'fit-ctx'` | bool, int or `"a,b"` MiB, int | true, 1024, 4096 | defaults; GPU-only relevance |
| `verbosity` | 0 to 3 | 0 | 2 during calibration to read the repack and backend lines, then 0 |
| `tools` | bool | false | true for `native_tools` |

Per request, `completion({...})` (`INF/schemas/completion-stream.js`): `kvCache: boolean | string`, `prefill: boolean`, `generationParams.{temp, top_p, top_k, predict, seed, presence_penalty, frequency_penalty, repeat_penalty, reasoning_budget, tool_choice, parallel_tool_calls}`, `responseFormat`, `requestId` (for `cancel({ requestId })`, `SDK/examples/cancel-by-request-id.js`).

Stats on `final.stats` (`INF/schemas/completion-event.js`): `timeToFirstToken`, `tokensPerSecond`, `promptTokensPerSecond`, `cacheTokens`, `promptTokens`, `generatedTokens`, `backendDevice`. These are exactly what calibration and telemetry need; no extra timing code.

Device facts from QVAC: `getSystemResources({ sample: true })` returns `capabilities.cpu.{physicalCores, logicalCores, performanceCores, efficiencyCores, frequencyHz, name}`, `capabilities.memory.totalBytes`, `capabilities.gpus[]` (with `drivers.vulkan/opencl/metal`), and `sample.memory.{usedBytes, totalBytes, processUsedBytes, processAvailableBytes}`. Each metric is `{ status: "supported", value } | { status: "unavailable" | "unverified" | "failed" }` (`INF/schemas/system-resources.js`). The collector is `bare-cpu-info`; whether `performanceCores` is real on Android SoCs is unknown, so we read sysfs ourselves and use QVAC's value only as a cross-check.

Device defaults: `qvac.config` `deviceDefaults: [{ name, match: { platform, deviceBrand?, deviceModelPrefix?, deviceModelContains? }, defaults: { llm: {...} } }]` (`INF/schemas/config.js:180-211`). Built in: Pixels get `device: "cpu"` (`INF/runtime/model-config-utils.js:46-68`). We do not rely on it, because Hermit passes `device` explicitly and the calibrated plan is per device, not per brand.

Lifecycle: `suspend()`, `resume()`, `state()`, `unloadModel({ modelId })`, `cancel({ requestId })` (`SDK/src/client/api/*.d.ts`).

### 2.2 Types to add

In `packages/model/src/runtime.ts` (new, pure TypeScript, testable on the Mac):

```ts
export type SoCClass = "floor" | "low" | "mid" | "high";

export interface CpuCluster {
  /** CPU indices in this cluster, e.g. [4,5,6,7]. */
  cpus: number[];
  maxFreqKHz: number;
}

export interface DeviceFacts {
  platform: "android" | "ios";
  osVersion: string;
  model: string;               // expo-device modelName / modelId
  soc?: string;                // Android Build.SOC_MODEL (API 31+), iOS model id
  totalRamBytes: number;       // expo-device totalMemory
  isLowRamDevice?: boolean;    // Android ActivityManager.isLowRamDevice()
  clusters: CpuCluster[];      // sorted fastest first; empty on iOS
  logicalCores: number;
  /** Android /proc/cpuinfo Features or getauxval; iOS implied by chip. */
  cpuFeatures: { dotprod: boolean; i8mm: boolean; sve2: boolean; sme2: boolean };
  gpu?: { vendor: string; name: string; metal?: boolean; opencl?: boolean };
  appVersion: string;
  modelFileSha256: string;
}

export interface RuntimePlan {
  key: string;                 // hash of device model + OS build + app version + model sha + QVAC version
  tier: SoCClass;
  device: "cpu" | "gpu";
  backend?: Array<"metal" | "opencl">;
  threads: number;
  threadsBatch: number;
  cpuMask?: string;            // Android only
  cpuMaskBatch?: string;
  ctxSize: number;
  ubatch: number;
  flashAttn: "on" | "off";
  cacheCheckpoints: number;
  cacheCheckpointsMaxBytes: number;
  thinkingBudget: number;      // tokens for the first action (Q30 decision)
  maxReplyTokens: number;
  modelFileId: string;         // which quant this tier loads
  measured?: CalibrationResult;
}

export interface CalibrationCandidate { device: "cpu" | "gpu"; backend?: "metal" | "opencl"; threads: number; threadsBatch: number; cpuMask?: string; ubatch: number }

export interface CalibrationResult {
  candidate: CalibrationCandidate;
  prefillTokPerSec: number;    // stats.promptTokensPerSecond
  decodeTokPerSec: number;     // stats.tokensPerSecond
  ttftMs: number;
  sanityPassed: boolean;       // tool call and schema checks, section 2.3
  thermalAtStart: ThermalLevel;
  at: string;                  // ISO time
}

export type ThermalLevel = "nominal" | "fair" | "serious" | "critical";

export interface RuntimeConditions {
  thermal: ThermalLevel;
  thermalHeadroom?: number;    // Android 0..1+, from getThermalHeadroom
  lowPowerMode: boolean;
  backgrounded: boolean;
  memoryPressure: "none" | "moderate" | "critical";
}

/** What changes per request without a reload. */
export interface RequestBudget { thinkingBudget: number; maxReplyTokens: number }

export function tierFor(f: DeviceFacts): SoCClass;
export function initialPlan(f: DeviceFacts): RuntimePlan;              // rules only, no measurement
export function candidatesFor(f: DeviceFacts, plan: RuntimePlan): CalibrationCandidate[];
export function pickBest(results: CalibrationResult[]): CalibrationCandidate | undefined;
export function budgetFor(plan: RuntimePlan, c: RuntimeConditions): RequestBudget;
export function needsReload(plan: RuntimePlan, c: RuntimeConditions): Partial<RuntimePlan> | undefined;
```

`ModelRuntime` in `profile.ts` keeps its fields and gains `threadsBatch?`, `cpuMask?`, `cpuMaskBatch?`, `ubatch?`, `flashAttn?`, `cacheCheckpoints?`. The profile stays the eval unit (FR-MODEL-05); the `RuntimePlan` overrides only the runtime part per device, never sampling or format, so an eval result still describes what ships.

In `apps/mobile/src/adapters/device.ts`: `deviceFacts(): Promise<DeviceFacts>` and `watchConditions(cb: (c: RuntimeConditions) => void): () => void`, backed by a small native module next to `modules/hermit-notifications` (sysfs cluster read, `Build.SOC_MODEL`, `isLowRamDevice`, `getThermalHeadroom`, thermal and memory listeners; iOS `thermalState`, `didReceiveMemoryWarning`). `expo-device` (already installed) gives `totalMemory` and `modelName`; `expo-battery` gives low power mode.

In `apps/mobile/src/adapters/qvac-engine.ts`: `qvacEngine(modelPath, profile, plan: RuntimePlan)` maps the plan to the keys in 2.1; `calibrate(facts, plan, onProgress): Promise<RuntimePlan>` lives beside it because it needs the engine.

Storage: `runtime-plan.json` in app documents (not secret, no user content): `{ key, plan, results[] }`.

### 2.3 First-run calibration

When: during onboarding, right after the model is verified and while the user is still reading the onboarding screens, so it never blocks a request. Re-run when `plan.key` changes (OS build, app version, model sha, QVAC version), when the user taps "Re-check speed" in settings, or when live telemetry drifts far below the stored numbers on several requests at nominal thermal state.

How (each candidate needs its own load, because llamacpp has no config reload):

1. Build candidates from `DeviceFacts`, at most four loads:
   - Android: `threads = big cluster size` with its `cpuMask`; `threads = big + middle clusters` with that mask; QVAC default (unset, one per physical core, no mask) as the control. On the floor and low tiers add the best of those with `ubatch: 256`.
   - iOS: CPU with `threads = performance cores` (no masks on Apple [web 3]); Metal (`device: "gpu"`, `backend: ["metal"]`).
   - GPU on Android only if a future eval proves it (S26: it lost; Vulkan broke grammar).
2. Per candidate: load; run one prefill-only request of a fixed 512-token prompt (the real tools plus system prefix, so the number is the one users get); then one decode of `predict: 48` at `temp: 0` and a fixed `seed`; read `promptTokensPerSecond`, `tokensPerSecond`, `timeToFirstToken`, `backendDevice` from `final.stats`.
3. Sanity check on the candidate before it can win: (a) a native tool call with `tool_choice: "required"` on a canned request, which must parse to the expected tool name and argument keys; (b) a `responseFormat: json_schema` request that must validate. A backend that breaks grammar (as Vulkan did) fails here and is excluded.
4. Score = time for a typical step, `1200 / prefill + 80 / decode` seconds for a cold step, using `cacheTokens`-aware numbers once the cache is on. Pick the lowest score that passed; record all results.
5. Skip or abort calibration if thermal is `serious` or worse, battery under 20 percent without charger, or low power mode is on; fall back to `initialPlan` and retry later. Note the thermal state with each result so a hot phone does not pick a too-small thread count forever.

### 2.4 Runtime adaptation

Per request, no reload (`budgetFor`):

| Condition | Thinking budget for first action | Reply cap | Other |
|---|---|---|---|
| nominal, not low power | plan value (256 high/mid, 192 low, 128 floor) | plan value | none |
| fair or Android headroom above 0.7 | 75 percent of plan | unchanged | none |
| serious, headroom above 0.85, or low power mode | 50 percent, minimum 64 | 80 tokens | keep the two-stage fallback ready |
| critical | 0 (thinking off) | 60 tokens | tell the user the phone is hot if latency exceeds the PDR-003 bar |

At a safe point (no request running, app idle), `needsReload` may return fewer threads (big cluster minus one, or drop the middle cluster) when `serious` lasts over a few requests, and return the calibrated plan when back to `nominal`. Reload costs about 2 s on the S26 and drops the in-memory cache, so never reload mid-task, and re-warm the prefix after.

Signals: Android `PowerManager.getThermalHeadroom(forecastSeconds)` (API 30; poll no more than once every 10 s, NaN or 0 on first call means unsupported; status can stay `NONE` while headroom is above 0.85, so prefer headroom) and `addThermalStatusListener` [web 8]; iOS `ProcessInfo.thermalState` with `thermalStateDidChangeNotification` and `isLowPowerModeEnabled`; `expo-battery` `isLowPowerModeEnabledAsync()` maps to Power Saver on Android [web 9].

Memory: Android `onTrimMemory(TRIM_MEMORY_UI_HIDDEN / BACKGROUND)` and iOS memory warnings while backgrounded unload the model (2 s to reload is cheaper than an OOM kill that loses the task). In the foreground on `memoryPressure: "critical"`, finish the step, then unload. Check `getSystemResources({ sample: true }).sample.memory.processAvailableBytes` on iOS before load; the `com.apple.developer.kernel.increased-memory-limit` entitlement only helps on some devices [web 9].

### 2.5 Prefix cache, memory only

Goal: the tools plus static system prefix is computed once per app session, and each agent step decodes only what is new. Nothing touches disk.

What QVAC does today (0.23.0): with `kvCache: "<key>"` the SDK maps the key to a path under its cache directory, runs the addon with `cacheKey`, then calls `saveCache(cachePath)` after every turn (`completion-stream.js:300-305`). The addon would keep the conversation in memory and only write when set aside, evicted or unloaded, and with `ephemeral: true` never writes it (`ADDON/index.d.ts:545-556`). Checkpoints for our hybrid model (the recurrent state snapshot a prefix match needs, about 20 MB each) live in RAM with the default `cache_checkpoint_storage: "memory"`.

Plan:

1. `pnpm patch @qvac/inference@0.23.0` in `processModelResponse` / the custom-key path: add `ephemeral: true` to `runOptions` when the request asks for it, and skip `saveCacheFile` and `session.commitTurn` file bookkeeping for ephemeral turns. Gate it behind a request field (for example `kvCacheEphemeral: true`) so the patch is explicit. Add a unit test that no file appears under the SDK cache directory after a cached turn, and keep the test when upstream adopts it.
2. File an upstream request with Tether: expose `ephemeral` on `completion()` and on the SDK cache directory policy ("never persist").
3. One cache key per app session, random (`hermit-<uuid>`), never derived from content. On load: `prefill: true` with `[system]` plus the tool list.
4. Load with `cache_checkpoints: 4`, `cache_checkpoint_storage: "memory"`, `cache_checkpoints_max_bytes` by tier. A new task whose history starts with the same prefix needs the prefix checkpoint to still exist; if the four-slot window evicted it, the addon falls back to a full prefill (correct, only slower). Measure how often that happens (open item 3).
5. On background, unload or session end: the patch makes unload drop the conversation; also call `deleteCache({ kvCacheKey })` defensively.
6. Keep the prefix byte-stable: the same tools in the same order every request; volatile text (`Now:`, profile facts) after the static rules, as `prompt.ts:36-47` already does.

Hybrid model caveat: llama.cpp's server had reported problems reusing prompt cache on Qwen3.5 hybrids, because recurrent state cannot be rolled back and needs checkpoints [web 11]. QVAC's addon implements its own checkpoint scheme for exactly this case (`ADDON/README.md:205`), but `stats.cacheTokens` on the phone is the proof. If it stays near 0 on step 2 of a task, the cache is not working.

### 2.6 Tiers

The model weights (529 MB, memory-mapped) and our harness are the same on every tier; tiers change runtime and budgets. RAM is not the context limiter on this model (KV is 12 KiB per token [computed]); prefill speed is. So context stays 8K wherever RAM allows and tiers mainly change threads, budgets and how much history we keep.

| Tier | Rule (first match wins) | Examples | Plan defaults before calibration |
|---|---|---|---|
| unsupported | RAM under 3 GB, or no ARMv8.2 dotprod (QVAC would pick `armv8.0_1`) | Cortex-A53-only phones | refuse install-time with a clear message, or offer reminders without the model (product decision) |
| floor | RAM 3 to 4 GB, or only Cortex-A55 plus 2 old big cores | Helio G-series, Snapdragon 6xx | ctx 4096, threads = big cluster (2), threadsBatch = big (2), ubatch 256, thinking 128, reply 100, checkpoints 2 |
| low | RAM 4 to 6 GB, dotprod, no i8mm (Cortex-A76/A78 big cores) | Snapdragon 7-series older, Dimensity 700 to 1200 | ctx 8192, threads = big cluster (2 to 4), ubatch 256 or 512 (calibrate), thinking 192, checkpoints 3 |
| mid | RAM 6 to 8 GB with i8mm (Cortex-A710 or newer) | Snapdragon 8 Gen 1 to 2, 7+ Gen 2/3 | ctx 8192, threads = prime plus performance cores, threadsBatch same, thinking 256, checkpoints 4 |
| high | RAM 8 GB or more and a recent flagship (Oryon, X925, SME2) | S26 (SM8850), Snapdragon 8 Elite, Dimensity 9400/9500 | ctx 8192, threads calibrated (6 to 8), thinking 256, checkpoints 4; candidate for a Q8_0 or 2B profile if the eval shows an accuracy win that fits the speed bar |
| iOS | by chip: A14 or older low; A15 to A16 mid; A17 Pro or newer high | | CPU with performance cores (2) vs Metal, calibrated |

Model choice per tier: Q4_K_M everywhere until measurement says otherwise. Q4_0 for the floor tier only if our own imatrix Q4_0 is faster on an A55/A76 phone and keeps accuracy within the parity gate (Q31). Q8_0 for high tier only if it beats Q4_K_M on the 40-case eval at an acceptable decode speed.

### 2.7 Telemetry (local only)

Keep the last 50 `final.stats` per plan in memory and a rolling summary in `runtime-plan.json` (numbers only, no text): decode tok/s, prefill tok/s, TTFT, cacheTokens, thermal level. This drives the "drift" re-calibration trigger and gives us real tier data when a user opts into redacted feedback (Q32).

## 3. Open items that need real phones

1. **Thread sweep on three big.LITTLE phones** (one per tier) plus the S26: decode and prefill for big-only, big plus middle, all cores, with and without `cpu-mask`. Expect big-only to win decode on phones with efficiency cores [web 1, 2].
2. **Does `cpu-mask` work inside the QVAC bare worklet on Android** (cpuset of a foreground app vs background), and does it help or just pin to throttled cores?
3. **Prefix cache with the ephemeral patch:** `cacheTokens` on step 2 of a task and on the first step of a new task; TTFT before and after; RAM cost of `cache_checkpoints` 2 vs 4; confirm no file appears under the SDK cache directory.
4. **Repack confirmation per tier** (verbosity 2 log line `repack tensor ... q4_K_8x8` or `4x8`) and which CPU variant QVAC selects (`armv8.2_1` vs `armv8.6_1` vs `armv9.2_*`).
5. **Q4_K_M vs own Q4_0 (imatrix)** on a floor-tier phone: speed, and accuracy on the Mac eval within the parity gate.
6. **Q8_0 on high tier:** accuracy delta on the 40 cases vs decode speed.
7. **`ubatch-size` 128 / 256 / 512** on floor and low tiers: prefill speed and peak RSS.
8. **`flash-attn` on vs off** on a low-end CPU.
9. **iOS: Metal vs CPU** on an A15 and an A17 Pro, including the grammar sanity check.
10. **Thermal curve:** 10 back-to-back agent tasks on the S26 and a mid phone; record headroom, tok/s and when budgets should step down; check whether a thread reload at `serious` actually helps.
11. **Low RAM behaviour:** 4 GB phone with a few apps open; peak RSS of load plus 8K context plus checkpoints; whether `onTrimMemory` arrives before the kill.
12. **`getSystemResources` accuracy on Android:** is `performanceCores` / `efficiencyCores` supported and correct, compared with sysfs clusters.
13. **Calibration cost:** total wall time of four loads plus benchmarks on a floor phone, to decide whether to cut to three candidates.
14. **SME2:** ask Tether whether fabric can ship KleidiAI; if a build exists, compare on the S26.

## Sources

1. Liquid AI and on-device studies on big.LITTLE thread choice: https://arxiv.org/html/2410.03613v1 ; https://docs.liquid.ai/deployment/on-device/llama-cpp/mobile
2. Snapdragon 8 Elite thread sweep, "8 threads causes 55% tg regression": https://github.com/ggml-org/llama.cpp/discussions/23736 ; llama.cpp `common_cpu_get_num_math()` skips efficiency cores only on x86 Linux, disabled on Android: https://raw.githubusercontent.com/ggml-org/llama.cpp/master/common/common.cpp
3. ggml-cpu affinity: `sched_setaffinity` on Android, not supported on Apple: https://raw.githubusercontent.com/ggml-org/llama.cpp/master/ggml/src/ggml-cpu/ggml-cpu.c ; Android cpusets: https://source.android.com/docs/core/power/performance
4. Arm, Qwen3.5-0.8B Q4_K_M on vivo X300 with and without repack: https://developer.arm.com/ai/models/hugging-face/Arm/qwen3-5-0-8b-q4-k-m-llamacpp-vivo-x300/qwen3.5-0.8b-q4_k_m-gguf ; Q4_K repack PR: https://github.com/ggml-org/llama.cpp/pull/17494 ; Q4_0_x_x removal in favour of runtime repack: https://github.com/ggml-org/llama.cpp/pull/10457
5. Qwen3.5-0.8B config (24 layers, 6 full attention, 2 KV heads, head dim 256): https://huggingface.co/Qwen/Qwen3.5-0.8B/raw/main/config.json
6. KV cache quantization accuracy: https://smcleod.net/2024/12/bringing-k/v-context-quantisation-to-ollama/ ; quantized V requires flash attention: https://github.com/ggml-org/llama.cpp/issues/21450
7. Speculative decoding on consumer hardware: https://arxiv.org/pdf/2607.17283 ; llama.cpp speculative docs: https://huggingface.co/datasets/echodict/llama.cpp/blob/main/docs/speculative.md
8. Android thermal headroom and ADPF: https://developer.android.com/games/optimize/adpf/thermal
9. expo-battery low power mode: https://docs.expo.dev/versions/latest/sdk/battery/ ; iOS increased memory limit: https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.kernel.increased-memory-limit ; mmap vs mlock: https://jacar.es/?p=7984
10. SME2 SoCs: https://m.gsmarena.com/newscomm-69656p4.php ; https://notebookcheck.net/arm-confirms-exynos-2600-will-support-sme2-at-launch.1224328.0.html ; Arm SME2 llama.cpp learning path: https://learn.arm.com/learning-paths/mobile-graphics-and-gaming/performance_llama_cpp_sme2/run_llm/
11. Hybrid model prompt cache reuse in llama.cpp: https://github.com/ggml-org/llama.cpp/issues/22384 ; https://particula.tech/blog/prompt-reprocessing-swa-hybrid-models-kv-cache
12. How other apps tune: PocketPal threads and tiers: https://raw.githubusercontent.com/a-ghorbani/pocketpal-ai/main/src/utils/deviceCapabilities.ts and https://github.com/a-ghorbani/pocketpal-ai ; LiteRT-LM (Google AI Edge Gallery) CPU vs GPU on S26 Ultra: https://developers.google.com/edge/litert-lm/overview ; MLC per-model `estimated_vram_bytes`: https://llm.mlc.ai/docs/deploy/android.html ; Apple Foundation Models availability API: https://developer.apple.com/documentation/foundationmodels/systemlanguagemodel

### How other apps do it (short)

- **PocketPal AI** (llama.rn): threads = all cores if 4 or fewer, else `floor(cores * 0.8)` (8 cores gives 6, which includes little cores); "high end" means 5.5 GB RAM and 6 cores or more; Android GPU only with Adreno plus i8mm plus dotprod; a manual benchmark that posts to a public leaderboard [12]. Hermit does better by masking to big cores and calibrating automatically.
- **Google AI Edge Gallery / LiteRT-LM:** per-model CPU vs GPU choice; on the S26 Ultra GPU prefill is about 7x CPU for Gemma E2B, decode similar [12]. Different runtime; QVAC's mobile GPU paths are slower than CPU for our 0.8B model.
- **MLC Chat:** each model ships `estimated_vram_bytes`; the app checks it against the device before load [12]. QVAC's equivalent is `assessModelFit()` and `modelFitPolicy`.
- **Apple Foundation Models:** only an availability check (`deviceNotEligible`, `appleIntelligenceNotEnabled`, `modelNotReady`), no tuning exposed [12].
