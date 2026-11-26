# Hermit: platform enablers and tooling research

Date: 2026-11-08. Scope: Android-first alpha, Expo/React Native + TypeScript, QVAC (llama.cpp in a Bare worklet via `react-native-bare-kit`), Apple M5 Mac with 16 GB RAM and no Xcode, Android SDK or JDK installed yet.

How I checked: `npm view` against the registry on 2026-11-08, packed tarballs (`expo@58.0.23` `bundledNativeModules.json`, `react-native@0.88.1` `gradle/libs.versions.toml`), source read through `gh api` (expo/expo), shallow clones in `(local clone) ` (op-sqlite, react-native-keychain; read only, no scripts run), official docs, and web search. Each claim notes whether it was verified at the source or comes from secondary reporting.

---

## 1. Expo

**Current versions (npm, 2026-11-08)**

| Package | Version | Notes |
|---|---|---|
| `expo` (latest) | 58.0.23 | SDK 58 was announced on 2026-10-15. Older SDK lines: sdk-57 57.0.32, sdk-56 56.0.24. |
| `react-native` | 0.88.1 | Pinned by SDK 58 (`bundledNativeModules.json`). 0.89.0-rc.0 is `next`. |
| `react` | 19.3.0 | Pinned by SDK 58. |
| `expo-router` | 58.0.30 | Expo Router now uses the SDK version number. |
| `expo-dev-client` | 58.0.18 | |
| `react-native-bare-kit` | 0.17.1 | `@qvac/sdk` 0.23.0 peer-depends on `react-native-bare-kit >=0.16`, `expo-file-system`, `expo-device` and `expo-build-properties`. |

**SDK 58 platform floor** (Expo versions page plus RN 0.88 gradle catalog): minSdk 24 (Android 7), compileSdk 37, targetSdk 36, build-tools 37.0.0, AGP 9.2.1, Kotlin 2.2, NDK 27.1, iOS 16.4 minimum, Xcode 26.4 or later, Node 22.13+, 24.3+ or 26+ (odd-numbered releases unsupported). The local Node is v24.4.1, which is fine.

**New Architecture.** It is the only architecture now. RN 0.82 removed the opt-out (`newArchEnabled=false` does nothing), and Expo SDK 55 and later run only on the New Architecture. Any library we pick must support the New Architecture (TurboModules, Fabric, Nitro or JSI). op-sqlite, react-native-quick-crypto 1.x (Nitro), react-native-webview 14 and react-native-keychain 11 all do.

**Expo Router (SDK 58).** Native tabs, toolbars, loaders and middleware are now stable. The navigation core was reworked and most of the forked React Navigation API was removed: `withLayoutContext` is replaced by `integrateWithRouter`, and `expo-router/react-navigation` imports may break. For a phone-first chat-centric app, use file-based routes with native tabs. We don't need server output; that default only matters for web.

**Dev clients, prebuild and config plugins.** Expo Go is ruled out: op-sqlite, the Bare worklet, the NotificationListenerService and SQLCipher are all custom native code. The workflow is:
- `expo-dev-client` plus Continuous Native Generation (`npx expo prebuild`).
- `android/` and `ios/` stay gitignored and are generated.
- All native customization goes through config plugins and local Expo Modules (`modules/` in the app, created with `npx create-expo-module --local`).

**EAS Build vs local builds.**
- **Fully local, no Expo account:** `npx expo run:android` (debug dev client to a USB device), or `npx expo prebuild && cd android && ./gradlew assembleRelease` for a release APK. Only Android Studio (SDK) and JDK 17 are needed. This suits an Apache-2.0 open-source project because contributors can build without accounts, and it keeps an F-Droid or reproducible-builds path open.
- **`eas build --platform android --local`:** runs the EAS build pipeline on this Mac. Supported on macOS and Linux, but it requires being logged in to Expo.
- **EAS cloud Free plan (expo.dev/pricing, 2026-11):** up to 15 Android and 15 iOS builds per month, low-priority queue (peak waits can exceed 90 minutes), 45-minute timeout. Useful later for iOS builds, since there is no Xcode here.
- SDK 58 Android release builds enable R8 by default (secondary source). Keep-rules may be needed for the Bare and JNI code.

Recommendation: Expo SDK 58 (RN 0.88, React 19.3, New Architecture only) + Expo Router 58 + expo-dev-client with CNG and local Expo Modules. Build Android locally (`expo run:android` / Gradle) as the default path. Use EAS cloud Free only for occasional iOS or CI builds.

---

## 2. Android notification reading and reply (WhatsApp quick reply)

**Library survey (npm and GitHub, 2026-11-08).** No maintained React Native or Expo library both reads notifications and replies via RemoteInput.

| Package | Last publish | Reads notifications | Replies via RemoteInput |
|---|---|---|---|
| `react-native-android-notification-listener` 5.0.1 (leandrosimoes, 161 stars) | 2022-12; repo pushed 2025-07 | yes | no |
| `expo-android-notification-listener-service` 1.1.0 | 2025-01 (2 stars) | yes | no |
| `expo-notification-listener` 0.1.3 | 2026-07 (0 stars) | yes | no |
| `@lund133369/expo-notification-listener` 0.2.1 | 2026-10; repo 404 | yes | no |
| `@honeypathkar/react-native-notification-listener` | 2026-09; payments-focused | yes | no |

`expo-notifications` and Notifee (now unmaintained; `react-native-notify-kit` is the community fork) only handle *our own* notifications, not other apps'. A GitHub code search for `RemoteInput` in the candidate repos returned 0 hits.

**Minimal Expo Module design (Kotlin): `modules/hermit-notifications`**

1. **Config plugin.** Adds `<service android:name=".HermitNotificationListener" android:permission="android.permission.BIND_NOTIFICATION_LISTENER_SERVICE" android:exported="true">` with the `android.service.notification.NotificationListenerService` intent-filter. Optionally adds `<meta-data android:name="android.service.notification.default_filter_types" android:value="conversations">` to scope to messaging.
2. **`HermitNotificationListener : NotificationListenerService`**
   - `onNotificationPosted(sbn)`:
     - Apply the package allowlist (`com.whatsapp`, `com.whatsapp.w4b`, configurable).
     - Extract with `NotificationCompat.MessagingStyle.extractMessagingStyleFromNotification()` (sender, text, conversation title, group flag), falling back to `EXTRA_TITLE` / `EXTRA_TEXT` / `EXTRA_TEXT_LINES`.
     - Skip group-summary notifications (`FLAG_GROUP_SUMMARY`).
   - Find the reply action: iterate `notification.actions` (or `NotificationCompat.getAction`) for an action whose `remoteInputs` is non-empty and `allowFreeFormInput` is true. Prefer `SEMANTIC_ACTION_REPLY`.
   - Cache `{key, conversationId, replyAction (PendingIntent + RemoteInput[]), postedAt}` in an in-memory LRU keyed by conversation. PendingIntents cannot be persisted across process death, so a reply is only possible while the source notification is live.
   - Persist the message (not the PendingIntent) to a small native queue (SharedPreferences, a file, or the app's SQLite file) so nothing is lost when JS isn't running.
   - Emit a module event (`onMessage`) when the JS runtime is alive.
3. **Reply path: `reply(conversationId, text)`**
   - Build a `Bundle` with `remoteInput.resultKey -> text` and call `RemoteInput.addResultsToIntent(remoteInputs, intent, bundle)`.
   - Call `actionIntent.send(context, 0, intent)`.
   - Then call `cancelNotification(key)` or wait for WhatsApp to update it.
   - Return `{ok:false, reason:'stale'}` if the action is no longer cached.
4. **JS API**
   - `isPermissionGranted()`, `openSettings()` (`Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS`), `requestRebind()`.
   - `getPending()`, `reply()`, `markRead()` (fires a `SEMANTIC_ACTION_MARK_AS_READ` action if present).
   - Event `onMessage`.
   - Every `reply()` goes through the policy/cage package (user approval plus an audit-log entry).
5. **Lifecycle.**
   - Handle `onListenerConnected` / `onListenerDisconnected`. Some OEMs (Xiaomi, Oppo, Samsung) kill listeners, so expose `requestRebind`.
   - Dedupe on `sbn.key` + `postTime`, because WhatsApp re-posts updated notifications.

**Platform constraints (verified, but mostly from press, AOSP commits and bug reports rather than official docs)**
- **Android 15+ sensitive notifications.** Notifications classified as OTP/2FA are redacted for untrusted listeners. `RECEIVE_SENSITIVE_NOTIFICATIONS` is a system/role-only permission. Hermit will not see OTPs, and the UI should say so.
- **Restricted settings for sideloaded APKs (Android 13+, expanded in 15).** A sideloaded alpha APK cannot enable notification access until the user taps "Allow restricted settings" in App info, after first hitting the block dialog. The onboarding flow must walk users through this. Play-installed apps are exempt.
- **Background activity launch.** Sending a broadcast or service PendingIntent to WhatsApp is not an activity launch, so the Android 14+ BAL restrictions shouldn't apply. Verify on device.
- **Not available on iOS.** iOS has no equivalent API; the iOS story is Share Sheet, App Intents or Shortcuts only.

**Play Store policy, as of 2026-11**
- **AccessibilityService:** Play's "Permissions and APIs that Access Sensitive Information" page says the Accessibility API "cannot be requested for ... an app that autonomously initiates, plans, and executes actions or decisions" ("Don't use the API to autonomously initiate, plan, and execute actions or decisions"). `isAccessibilityTool=true` is only for apps whose core function serves people with disabilities. Other apps need prominent disclosure and affirmative consent. The 29 Oct 2026 announcement clarified isAccessibilityTool disclosures without changing enforcement. **An AI agent driving other apps through Accessibility is not allowed on Play.**
- **AppFunctions (new):** must not "deceive or manipulate AI agents, bypass security controls, or interfere with other applications". Effective 2027-04-14. This is the sanctioned agent-to-app path going forward.
- **NotificationListenerService:** no Permission Declaration Form exists for it (it isn't on the restricted-permissions list on the policy page). The general User Data, prominent disclosure and core-functionality rules still apply. Auto-replying is not explicitly prohibited, but the Accessibility "autonomous" language shows the direction. Requiring a user tap or approval per reply (or an explicit, scoped standing rule the user created) is the defensible design.
- **WhatsApp's own Terms** prohibit automated or bulk messaging through unauthorized means. Keep replies human-approved, low-volume and in 1:1 chats. Treat this as a product and legal risk, not a technical one.

Recommendation: Build a small local Expo Module (`modules/hermit-notifications`, Kotlin, about 300 LOC) that combines NotificationListenerService, MessagingStyle extraction and RemoteInput reply, with per-reply user approval enforced in the policy layer. Never use AccessibilityService for agent actions. Plan onboarding around "Allow restricted settings" for the sideloaded alpha.

---

## 3. SQLite stack (encryption + FTS5 + vectors)

**op-sqlite 19.0.5** (published 2026-11-05; shallow clone at commit f837927, 2026-11-05)
- Configured through an `"op-sqlite"` key in the **app's** `package.json`:
  `{"sqlcipher": true, "fts5": true, "sqliteVec": true, "performanceMode": true, "tokenizers": [...]}`.
  In a monorepo, Android reads **only** the app package.json (docs/installation.md).
- **The combination is allowed.**
  - `android/build.gradle` reads `sqlcipher`, `fts5` and `sqliteVec` independently. The only hard errors are libsql+turso, and libsql/turso combined with tokenizers.
  - `op-sqlite.podspec` only rejects sqlcipher or sqlite-vec with `iosSqlite` (the system SQLite), and sqlite-vec with libsql or turso.
  - The SQLCipher CMake path compiles the same `OPBridge.cpp`, which auto-registers `sqlite3_vec_init` under `OP_SQLITE_USE_SQLITE_VEC`. FTS5 is a compile flag (`-DSQLITE_ENABLE_FTS5=1`).
  - Conclusion from source: SQLCipher + FTS5 + sqlite-vec is a supported build. I didn't find an explicit test or doc example of all three together, so smoke-test it on a device.
- Other points:
  - JSI, synchronous and async APIs, `executeWithHostObjects`, reactive queries, custom C FTS5 tokenizers.
  - No config plugin needed ("just prebuild"). Not usable in Expo Go.
  - SQLCipher key is passed as `open({name, encryptionKey})`.
- sqlite-vec itself is pre-1.0 (v0.1.9, 2026-03-31, 8.2k stars, last push 2026-05). It's fine for a brute-force KNN over personal-scale data (tens of thousands of chunks).

**expo-sqlite 58.0.15**
- Config plugin options: `enableFTS` (default true, covers FTS3/4/5), `useSQLCipher`, `withSQLiteVecExtension` (bundled; load with `db.loadExtensionAsync(bundledExtensions['sqlite-vec'].libPath, entryPoint)`), and `customBuildFlags`.
- The plugin and podspec set the flags independently with no conflict guard. The docs don't state that all three combine.
- SDK 58 removed libSQL support.
- Gotcha: if SQLCipher isn't actually compiled in, `PRAGMA key` silently does nothing. Assert that `PRAGMA cipher_version` returns a row at startup (same idea for op-sqlite).
- Pro: first-party and versioned with the SDK. Con: slower async bridge, extension loading is dynamic, no custom tokenizers.

**Pick.** op-sqlite has the faster JSI path, sqlite-vec statically linked and auto-registered, and custom tokenizers. Custom tokenizers matter little for Spanish, since FTS5 `unicode61 remove_diacritics 2` handles accents. Single-maintainer risk is offset by very active releases.

Recommendation: Use op-sqlite 19.x with `{"sqlcipher": true, "fts5": true, "sqliteVec": true, "performanceMode": true}` in `apps/mobile/package.json`. Store the SQLCipher key in the Keystore-backed secure store (section 4). Make "open encrypted DB, `PRAGMA cipher_version`, FTS5 MATCH, `vec0` KNN" a day-1 smoke test on a real device. Fallback: expo-sqlite with `useSQLCipher` + `withSQLiteVecExtension`.

---

## 4. Secure storage, biometrics and Ed25519 signing

**Versions:** expo-secure-store 58.0.2, expo-local-authentication 58.0.2, react-native-keychain 11.0.0 (2026-11-06), @noble/ed25519 3.2.0, @noble/curves 2.4.0, react-native-quick-crypto 1.1.9 (Nitro; needs `react-native-nitro-modules` and `react-native-quick-base64`).

**Per-use biometric gating (verified in source)**
- **expo-secure-store (Android):** `AESEncryptor.kt` builds the Keystore AES-GCM key with `.setUserAuthenticationRequired(options.requireAuthentication)` and **no validity duration**. That means auth-per-use: every decrypt needs a BiometricPrompt-authenticated `CryptoObject`.
- **expo-secure-store (iOS):** `requireAuthentication` uses `SecAccessControlCreateWithFlags(..., .biometryCurrentSet)`, so every read prompts and the key is invalidated on biometric re-enrollment.
- **react-native-keychain 11 (Android):** `CipherStorageKeystoreAesGcm.kt` uses `setUserAuthenticationParameters(5, AUTH_BIOMETRIC_STRONG or AUTH_DEVICE_CREDENTIAL)` on API 30+. That's a **5-second validity window** with device-credential fallback, not strict per-use. iOS supports `ACCESS_CONTROL.BIOMETRY_CURRENT_SET`.
- **expo-local-authentication** only shows a prompt and returns a boolean. It is *not* cryptographically bound, so it must never be the sole gate for a secret. Use it for UX checks only.

**Ed25519 for the audit log**
- **Option A: `@noble/curves/ed25519` (or `@noble/ed25519` v3), pure JS, audited.**
  - React Native needs a `crypto.getRandomValues` polyfill (`react-native-get-random-values` or `expo-crypto`) and `ed.hashes.sha512 = sha512` from `@noble/hashes`, per its README.
  - Signing small audit entries in Hermes is fast enough (sub-millisecond to a few milliseconds).
  - Works identically in the pure-TS core packages, in vitest on Node, and in the desktop "Boost" app.
- **Option B: `react-native-quick-crypto` 1.x**, native, Node `crypto` API (`generateKeyPairSync('ed25519')`, `sign`). Faster, but it adds Nitro native deps and ties the core to React Native.
- **Option C: a hardware-backed Ed25519 key in Android Keystore.** AOSP added an Ed25519 KeyPairGenerator via KeyMint (Android 13+), but the commits show reverts, and support depends on the device's KeyMint version. Unreliable on LATAM mid-range devices. Not recommended for the alpha.

**Key handling pattern**
- Generate a 32-byte Ed25519 seed with the CSPRNG.
- Store it in expo-secure-store under `requireAuthentication: false` for the background signer. Unattended audit appends must work without a prompt; the Keystore wrap still protects it at rest.
- Store a separate "unlock/approve" secret with `requireAuthentication: true`, used to gate high-risk actions (per-use biometric).
- The SQLCipher DB key is a random 32 bytes in secure-store, without biometric, so background jobs can open the DB.

Recommendation: Use expo-secure-store + expo-local-authentication, not react-native-keychain: secure-store gives true per-use Keystore auth and is first-party. Use `@noble/curves` (ed25519) + `@noble/hashes` in the pure-TS core for audit-log signing, with the seed in secure-store. Keep react-native-quick-crypto as an optional speed-up only if profiling shows a need.

---

## 5. Web reading and form fill

**Versions:** react-native-webview 14.0.1 (SDK 58 pin), @mozilla/readability 0.6.0 (last release 2025-03, stable), defuddle 0.19.6 (an active Readability alternative), linkedom 0.18.15.

**Option 1: hidden WebView + injected Readability (main path)**
- Render an off-screen or zero-size `<WebView>`.
- Bundle `Readability.js` as a string and inject it with `injectJavaScript` after `onLoadEnd`. It runs `new Readability(document.cloneNode(true)).parse()` and calls `window.ReactNativeWebView.postMessage(JSON.stringify(article))`.
- Handles JS-rendered pages, cookies and consent banners (you can inject click handlers), and real Chrome rendering. Cost: memory (one WebView renderer, roughly 50–100 MB) on 3–4 GB devices while a model is also loaded. Serialize WebView work with inference.

**Option 2: headless `fetch` + DOM parser + Readability or Defuddle in JS (fast path)**
- Uses no WebView memory and runs in background tasks.
- Fails on client-rendered SPAs and bot walls.
- linkedom on Hermes is unverified; run it in vitest first. Could also run inside the Bare worklet.

**Form fill in Android WebView**
- Possible via `injectJavaScript` on the same document. For React or Vue-controlled inputs, set the value with the native setter (`Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el, v)`) and then dispatch `input`/`change` events.
- Limits:
  - Cross-origin iframes (payment widgets, reCAPTCHA) are not scriptable.
  - Many sites detect WebView.
  - Treat every submit as a high-risk action needing approval.

**Google OAuth**
- Still blocked in embedded WebViews (`disallowed_useragent`). This has been policy since 2021, and `android.webkit.WebView` was named explicitly in 2023. Nothing changed in 2026.
- Any Google login must go through Custom Tabs (`expo-web-browser` / `expo-auth-session` with PKCE). The agent cannot read or drive Custom Tab contents, so Google-account sites (Gmail, Drive) must use their APIs via OAuth tokens, not WebView scraping.

Recommendation: The web tool is "fetch + Readability/Defuddle first, fall back to a hidden react-native-webview with injected Readability". Form fill is WebView `injectJavaScript` behind per-submit user approval. All OAuth goes through expo-auth-session/Custom Tabs, never the WebView.

---

## 6. Background execution ("night shift while charging")

**Expo packages (verified in source)**
- **`expo-background-task` 58.0.12, Android.** WorkManager with constraints hard-coded to `setRequiredNetworkType(CONNECTED)`, no charging constraint. Minimum 15 minutes, default `minimumInterval` 12 hours. All JS tasks share one worker. Stops if the user force-stops the app.
- **`expo-background-task`, iOS.** `BGProcessingTaskRequest` with `requiresNetworkConnectivity = true` and **`requiresExternalPower = false`**, both hard-coded. The only option is `minimumInterval`.
- So it can't express "offline + charging + idle". It is also the wrong tool for multi-minute LLM inference: a WorkManager worker gets about 10 minutes per run unless it is promoted to foreground.
- `expo-task-manager` 58.0.13 is the JS task registry underneath.
- The older `expo-background-fetch` 58.0.12 is superseded.

**Android plan (custom module, `modules/hermit-nightshift`)**
- Schedule a `PeriodicWorkRequest` or a chained `OneTimeWorkRequest` with `Constraints(setRequiresCharging(true), setRequiresDeviceIdle(true), setRequiresBatteryNotLow(true))` and no network requirement.
- For long jobs, call `setForeground()` (long-running worker, which shows an ongoing notification) with a foreground-service type declared in the manifest:
  - `dataSync` is capped at **6h per 24h on Android 15+**, with `onTimeout()`.
  - `specialUse` needs a Play Console justification.
  - Watch for vendor killers (dontkillmyapp.com; Xiaomi and Samsung are common in LATAM). Ask for the battery-optimization exemption only with clear disclosure.
- **Open spike:** the worker must reach the JS runtime and Bare worklet. Options:
  - (a) the worker starts a headless JS task that boots the QVAC worklet;
  - (b) run the agent loop entirely inside the Bare worklet so native code can drive it without the RN UI.
  - Option (b) is cleaner if QVAC allows it. Verify with the QVAC research.

**iOS (later)**
- `BGProcessingTask` with `requiresExternalPower = true` runs opportunistically when the phone is idle and charging, typically overnight, for minutes rather than hours, and it can be expired at any time (`expirationHandler`).
- iOS 26 added `BGContinuedProcessingTask` for *user-initiated* work that continues in the background with system progress UI, and it can request `.gpu` resources where supported. It fits "finish this summary I started" but not unattended night shifts.
- Expo's module hard-codes `requiresExternalPower=false`, so this also needs a small custom module or a patch.

Recommendation: Don't rely on expo-background-task for the night shift. Write a local Expo Module that wraps WorkManager with charging, idle and battery-not-low constraints plus a long-running foreground worker (dataSync type, under 6h/day). Later add an iOS BGProcessingTask with `requiresExternalPower=true`. Use expo-background-task only for light periodic chores (index maintenance, cleanup).

---

## 7. Monorepo tooling

**Versions:** pnpm 12.18.0 (latest; 10.x and 11.x lines still tagged), bun 1.4.4, turbo 2.11.10, vitest 5.1.0, jest-expo 58.0.14.

**Expo monorepo facts (docs.expo.dev/guides/monorepos)**
- Metro is configured automatically for monorepos since **SDK 52**. Delete any custom `watchFolders`, `nodeModulesPath`, `extraNodeModules` or `disableHierarchicalLookup` settings.
- **Isolated installs (pnpm default) are supported since SDK 54.** `node-linker=hoisted` (in pnpm-workspace.yaml as `nodeLinker: hoisted`) is now a *fallback* when a native library misbehaves, not a requirement.
- Autolinking module resolution is automatic in monorepos since SDK 55.
- Exactly one `react` and one `react-native` version per monorepo. Pin them with `pnpm.overrides`. Native modules must never be duplicated; check with `pnpm why -r react-native`.

**Gotchas specific to Hermit**
- The op-sqlite config must live in `apps/mobile/package.json` because Android only reads that file.
- Hardcoded `node_modules` paths in Gradle or Podfile scripts can break under isolated linking. Use `require.resolve`.
- pnpm 10+ blocks dependency lifecycle scripts by default. Allow-list the ones we need with `onlyBuiltDependencies` / `allowBuilds`.
- The QVAC Bare bundling (`bare-pack`, worklet bundle) under pnpm symlinks is unverified. Spike it on day 1 and switch to `nodeLinker: hoisted` if it fails.
- Pure-TS packages (agent core, policy/cage, skills) must not import `react-native`. That keeps them testable in Node with vitest and reusable in the desktop "Boost" Node app.

**pnpm vs bun vs npm**
- pnpm is the most battle-tested with Expo and has strict dependency boundaries, which help the cage/policy isolation.
- Bun workspaces are supported by Expo but have fewer RN monorepo reports.
- npm workspaces hoist everything and are fine, but give no boundary enforcement.

**Turborepo.** With one app and three or four packages, `pnpm -r --filter` covers typecheck, test and build. Turborepo pays off once CI caching matters or Boost arrives. Adding it later is cheap: one `turbo.json`.

**Testing**
- vitest 5.x for the pure-TS packages (fast, ESM-native, runs on Node and Bun).
- jest-expo 58 (matching the SDK) for `apps/mobile` component and hook tests, mocking the native modules.
- Real device smoke tests for native modules: Maestro, or a manual checklist for the alpha.

Recommendation: Use pnpm workspaces (`apps/mobile`, `packages/core`, `packages/policy`, `packages/skills`, later `apps/boost`) with the default isolated linker and `nodeLinker: hoisted` as the documented fallback. No custom Metro config. Pin react and react-native via overrides. No Turborepo at the start (add it when CI or Boost needs caching). vitest for the packages, jest-expo for the app.

---

## 8. Evidence on small-model tool calling

**TinyAgent-1.1B (Berkeley SqueezeAI Lab, arXiv 2409.00608, 2024): CONFIRMED with caveats**
- TinyAgent-1.1B + ToolRAG reached **80.06%** success vs GPT-4-Turbo **79.08%** (GPT-3.5-Turbo 65.04%). Base TinyLlama-1.1B scored 12.71%, fine-tuning alone gave 78.89%, and the 7B variant reached 84.95%.
- Caveat: this is the authors' own benchmark (16 macOS-assistant functions, LLMCompiler-style plans), with training data synthesized by GPT-4-Turbo. It shows that **narrow fine-tuning on a closed tool set** lets a 1B model match a frontier model *on that task*, not generally.

**FunctionGemma 270M (Google, released Dec 2025): CONFIRMED**
- Google DeepMind's page reports base **58%** → **85%** after fine-tuning on the Mobile Actions dataset (exact-match task accuracy; Google calls it a +47% relative gain).
- Fine-tuning recipe: HF TRL, then export to `.litertlm`. Exact match understates semantically equivalent calls.

**Best open models of 4B or less for tool calling (Nov 2026; model cards on HF, self-reported)**

| Model | Params | License | Tool-calling evidence | Spanish |
|---|---|---|---|---|
| IBM Granite 4.2 3B (Aug 2026, GGUF available) | 3B dense | Apache 2.0 | **BFCL v4 52.41**, τ³-bench 50.99 (IBM card) | Officially tested (es, pt) |
| Qwen3.5-4B (Feb 2026) | 4B | Apache 2.0 | **BFCL-V4 50.3, TAU2-Bench 79.9** (Qwen card; 9B: 66.1 / 79.1) | 201 languages |
| Qwen3.5-2B / 0.8B | 2B / 0.8B | Apache 2.0 | BFCL-V4 43.6 / 25.3 (secondary: vdf.ai) | 201 languages |
| Gemma 4 E4B / E2B (Mar 2026) | ~4B / ~2B effective | Apache 2.0 | Native function calling; Tau2 42.2% / 24.5% (Google card); no BFCL published | 35+ languages supported, 140+ pre-trained |
| LiquidAI LFM2.5-1.2B-Instruct (Jan 2026) | 1.2B | LFM license (check terms) | Native tool tokens (Pythonic calls); no BFCL v4 found | Spanish listed |
| Salesforce xLAM-2-1b/3b-fc-r (2025) | 1B / 3B | CC-BY-NC (non-commercial) | BFCL v4 ~30 for 1B (secondary) | weak |
| FunctionGemma 270M | 0.27B | Gemma terms | Router or fine-tune base only | limited |

- The official BFCL leaderboard (last refresh reportedly April 2026) doesn't list most of these 2026 small models. All numbers above are vendor-reported and not yet independently reproduced. BFCL v4 is much harder than v3, so don't compare across versions.
- No public Spanish-specific tool-calling benchmark found. Hermit should build its own es-LATAM eval set (WhatsApp-style phrasing, voseo, code-switching) as part of the cage/skills tests.
- Implication for Hermit:
  - Out of the box, a 3–4B model gets about 50% on BFCL v4's hard agentic mix, but closed-tool-set tasks (TinyAgent, FunctionGemma) reach 80–85% after narrow fine-tuning.
  - Design for a **small fixed tool set + ToolRAG-style tool selection + constrained JSON/grammar decoding** (llama.cpp GBNF via QVAC if exposed), and plan a LoRA fine-tune on Hermit's own tools later.

Recommendation: Benchmark Qwen3.5-4B (Q4_K_M) and Granite 4.2 3B as primary candidates, with Gemma 4 E2B or Qwen3.5-2B as the low-RAM tier, on a custom Spanish (es-LATAM) eval of Hermit's tool set. Use grammar-constrained decoding plus tool retrieval. Treat TinyAgent and FunctionGemma as evidence that a narrow fine-tune is the path to 80%+, not as models to ship.

---

## 9. Zero to Android dev build on this Mac (checklist)

Current state: macOS 26.6.2, Homebrew 7.0.12, Node 24.4.1 (OK for SDK 58), no Java runtime, no Android SDK.

1. **JDK 17.** RN 0.88 / AGP 9.2 builds with 17, and Expo docs specify Zulu 17.
   `brew install --cask zulu@17`
   Add `export JAVA_HOME=/Library/Java/JavaVirtualMachines/zulu-17.jdk/Contents/Home` to `~/.zshrc`. Check with `java -version`.
2. **Android Studio** (latest stable, Apple Silicon build): `brew install --cask android-studio`. Run the Setup Wizard with the **Standard** install type and accept all licenses.
3. **SDK Manager** (Settings → Languages & Frameworks → Android SDK):
   - SDK Platforms: **Android SDK Platform 36** (Expo docs) **and 37**. RN 0.88's gradle catalog uses `compileSdk = 37`. Gradle can auto-download missing platforms once licenses are accepted, but installing both up front avoids surprises.
   - SDK Tools: **Build-Tools 37.0.0**, Platform-Tools, Command-line Tools (latest), **NDK 27.1.12297006** (op-sqlite, Bare and QVAC compile C/C++), CMake (the version AGP asks for). The Emulator is optional with a physical device and saves RAM on 16 GB.
4. **Environment** in `~/.zshrc`:
   ```sh
   export ANDROID_HOME=$HOME/Library/Android/sdk
   export PATH=$PATH:$ANDROID_HOME/emulator:$ANDROID_HOME/platform-tools
   ```
   Run `source ~/.zshrc` and check that `adb version` works. If Gradle picks the wrong JDK, set `java.home=...zulu-17.jdk/Contents/Home` in `~/.gradle/gradle.properties`.
5. **Gradle memory on 16 GB.** In `android/gradle.properties` (via a config plugin or `expo-build-properties`), set `org.gradle.jvmargs=-Xmx4g` and limit ABIs during development to `reactNativeArchitectures=arm64-v8a` (most LATAM mid-range phones are arm64). This cuts native build time and RAM a lot.
6. **pnpm:** `corepack enable && corepack prepare pnpm@latest --activate` (or `brew install pnpm`). No Watchman needed (SDK 56+).
7. **Physical device:**
   - Settings → About phone → tap Build number 7 times.
   - Developer options → enable **USB debugging** (and "Install via USB" on Xiaomi).
   - Connect with USB-C and accept the RSA prompt.
   - `adb devices` should show `device`. Optional wireless: `adb pair` / `adb connect` (Android 11+).
8. **Project:**
   - `npx create-expo-app@latest` (SDK 58) inside `apps/mobile`, then `npx expo install expo-dev-client`.
   - Add native deps (`@op-engineering/op-sqlite`, `react-native-bare-kit`, `@qvac/sdk`, and so on) with `npx expo install`.
9. **First build:** `npx expo run:android --device`. This runs prebuild, Gradle, installs the dev client and starts Metro.
   - Later JS-only iterations: `npx expo start --dev-client`.
   - Release APK: `cd android && ./gradlew assembleRelease` (configure a release keystore first).
10. **Sideloaded APK testers:** "Install unknown apps" permission, then "Allow restricted settings" before enabling notification access (section 2).
11. **iOS later.** Needs Xcode 26.4+ (about 40 GB), or use EAS cloud Free (15 iOS builds per month).

Recommendation: Install Zulu 17, Android Studio (Platforms 36+37, Build-Tools 37.0.0, NDK 27.1, CMake), set `ANDROID_HOME`, use a physical arm64 Android device over adb with `reactNativeArchitectures=arm64-v8a`, and build with `npx expo run:android`. No Expo account, EAS or Xcode is needed for the Android alpha.

---

## Open items for follow-up spikes (not decisions)
- op-sqlite with sqlcipher + fts5 + sqliteVec together, on a real device (section 3).
- QVAC/Bare bundling under pnpm isolated linking (section 7).
- Driving the QVAC worklet from a WorkManager worker without the UI (section 6).
- RemoteInput reply against current WhatsApp and WhatsApp Business builds, and behavior on Xiaomi/Samsung (section 2).

## Sources
- Expo SDK 58 changelog: https://expo.dev/changelog/sdk-58
- Expo SDK versions table: https://docs.expo.dev/versions/latest/
- Expo New Architecture guide: https://docs.expo.dev/guides/new-architecture
- React Native 0.82 "A New Era": https://reactnative.dev/blog/2025/10/08/react-native-0.82
- Expo pricing: https://expo.dev/pricing
- EAS local builds: https://docs.expo.dev/build-reference/local-builds
- Expo monorepos guide: https://docs.expo.dev/guides/monorepos/
- Expo environment setup (Android, local, physical device): https://docs.expo.dev/get-started/set-up-your-environment/?platform=android&device=physical&mode=development-build&buildEnv=local
- expo-sqlite docs: https://docs.expo.dev/versions/latest/sdk/sqlite/
- expo-background-task docs: https://docs.expo.dev/versions/latest/sdk/background-task/
- expo/expo source (secure-store `AESEncryptor.kt`, background-task `BackgroundTaskScheduler.{kt,swift}`, sqlite plugin and podspec): https://github.com/expo/expo
- op-sqlite repo and docs (installation.md, android/build.gradle, op-sqlite.podspec): https://github.com/OP-Engineering/op-sqlite
- react-native-keychain (`CipherStorageKeystoreAesGcm.kt`): https://github.com/oblador/react-native-keychain
- sqlite-vec: https://github.com/asg017/sqlite-vec
- @noble/ed25519 README (RN polyfills): https://github.com/paulmillr/noble-ed25519
- Google Play, Permissions and APIs that Access Sensitive Information: https://support.google.com/googleplay/android-developer/answer/16558241?hl=en
- Google Play policy announcement, 29 Oct 2026: https://support.google.com/googleplay/android-developer/answer/18100766?hl=en-GB
- Android 15 restricted settings (Android Authority): https://androidauthority.com/android-15-restricted-settings-sideloading-3481098
- Android 15 Enhanced Confirmation Mode: https://www.androidauthority.com/android-15-enhanced-confirmation-mode-3436697
- Android 15 sensitive notifications: https://www.androidauthority.com/android-15-sensitive-notifications-3416414 ; KDE bug 495146: https://bugs.kde.org/show_bug.cgi?id=495146
- Foreground service timeouts: https://developer.android.com/develop/background-work/services/fgs/timeout
- WWDC25 session 227 (BGContinuedProcessingTask): https://developer.apple.com/videos/play/wwdc2025/227/
- Google OAuth embedded webview block: https://developers.googleblog.com/en/upcoming-security-changes-to-googles-oauth-20-authorization-endpoint-in-embedded-webviews/
- TinyAgent paper: https://arxiv.org/html/2409.00608v3 ; model card: https://huggingface.co/squeeze-ai-lab/TinyAgent-1.1B
- FunctionGemma: https://deepmind.google/models/gemma/functiongemma/ ; https://ai.google.dev/gemma/docs/mobile-actions
- Qwen3.5-4B card: https://huggingface.co/Qwen/Qwen3.5-4B
- Gemma 4 E2B card: https://huggingface.co/google/gemma-4-E2B-it
- Granite 4.2 3B card: https://huggingface.co/ibm-granite/granite-4.2-3b
- LFM2.5-1.2B-Instruct card: https://huggingface.co/LiquidAI/LFM2.5-1.2B-Instruct
- Small-model BFCL v4 roundup (secondary): https://vdf.ai/blog/best-small-language-models/
- BFCL v4 roundup (secondary): https://medium.com/@minhle_0210/5-tiny-language-models-for-tool-calling-part-3-ebcda32c2518
