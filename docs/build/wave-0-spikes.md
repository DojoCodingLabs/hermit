# Wave 0 spikes

Four checks that settle the risky native questions before Wave 1. Each has a pass/fail gate. Record results at the bottom of this file.

## Prerequisites

- **Disk:** at least 15 GB free. Check with `df -h /`. QVAC alone is about 4 GB of packages, each model is 1-3 GB, and Gradle caches take several GB.
- **Phone:** the Galaxy S26 Ultra over USB with USB debugging on. `adb devices` must show it as `device`.
- **Toolchain** (installed 2026-11-08): JDK 17 (`JAVA_HOME`) and Android command-line tools (`ANDROID_HOME`). Gradle downloads the SDK platforms and NDK on the first build.
- **Branch:** run each spike on its own branch off `master`. Spikes are throwaway until they pass; keeping their code is a separate decision.

## S1: QVAC runs a model on the phone

**Question:** does `@qvac/sdk` 0.23 with `react-native-bare-kit@~0.16.0` build on Expo SDK 58 / RN 0.88, and stream tokens from Qwen3.5-2B on the S26 Ultra?

```sh
cd apps/mobile
npx expo install expo-dev-client expo-file-system expo-device expo-build-properties
pnpm add @qvac/sdk@0.23.0 react-native-bare-kit@~0.16.0 bare-rpc
# app.json plugins: ["@qvac/sdk/expo-plugin", {"installMissingPrebuilds": false}]
# qvac.config.json: plugins [llamacpp-completion], requireSecureTransport true, requireHttpChecksum true,
#                   cacheDirectory outside backed-up folders
npx expo run:android --device
```

- **Model source:** a Hugging Face HTTPS URL with a pinned SHA-256 (Q15). Never a `registry://` constant.
- **Screen:** a throwaway screen calls `loadModel` and then `completion`, and shows tokens per second for prefill and decode.
- **Pass:**
  - the app builds and installs;
  - the model loads from the pinned URL;
  - decode reaches at least 10 tok/s on OpenCL;
  - output is coherent in Spanish and English.
- **If it fails:** retry on Expo SDK 57, then on SDK 54 (QVAC's CI baseline). Record which one works.

## S2: Encrypted SQLite with search

**Question:** does op-sqlite 19 build with SQLCipher, FTS5 and sqlite-vec all enabled?

- **Setup:** in `apps/mobile/package.json`, add `"op-sqlite": {"sqlcipher": true, "fts5": true, "sqliteVec": true, "performanceMode": true}`.
- **Pass:** on the device, with a 32-byte random key,
  - `PRAGMA cipher_version` returns a row;
  - an FTS5 `MATCH` over Spanish text with accents works using `remove_diacritics 2`;
  - a `vec0` KNN query returns the nearest row.
- **If it fails:** use expo-sqlite with `useSQLCipher` and `withSQLiteVecExtension`.

## S3: QVAC bundling under pnpm

**Question:** does the QVAC worklet bundle (bare-pack) resolve under pnpm's default isolated linker?

- **Pass:** S1's build succeeds with no hoisting changes.
- **If it fails:** set `nodeLinker: hoisted` in `pnpm-workspace.yaml`, re-run S1, and record the change in AGENTS.md.

## S4: The eval runs a real model on the Mac

**Question:** can `@hermit/eval` grade the first-win cases with the same model on QVAC desktop?

- **Build:** add `packages/eval/src/qvac-model.ts`, implementing `ModelPort` with `@qvac/sdk` on Node:
  - `pick` uses `responseFormat: json_schema` with an enum of skill ids plus `respond` and `ask_user`;
  - `fill` uses that skill's `args` schema.
- **Run:** `pnpm --filter @hermit/eval eval --model qvac`.
- **Pass:** all 8 cases run end to end, with time per case recorded. The 85% bar applies from Wave 1, once the full case set exists.

## Results

| Spike | Date | Result | Notes |
|---|---|---|---|
| S1 | | | |
| S2 | | | |
| S3 | | | |
| S4 | | | |
