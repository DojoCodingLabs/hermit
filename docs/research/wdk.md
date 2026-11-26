# Tether WDK and wdk-starter-react-native: fork or depend?

Research date: 2026-11-08. Sources were cloned read-only (no `npm install`, no scripts run) into a local clone:

| Repo | HEAD date | Notes |
|---|---|---|
| `tetherto/wdk-starter-react-native` | 2026-11-02 (`caa182e`, dependabot #77) | the starter |
| `tetherto/wdk` | 2026-10-23 (v1.0.0-beta.22) | core, contains the policy engine |
| `tetherto/wdk-react-native-core` | 2026-11-04 (v1.0.0-beta.24) | RN hooks plus worklet lifecycle (there is no `wdk-react-native-provider` repo under tetherto; `@spacesops/wdk-react-native-provider` is a third-party package) |
| `tetherto/pear-wrk-wdk` | 2026-10-22 (v1.0.0-beta.17) | the code that runs inside the Bare worklet, plus the HRPC schema |
| `tetherto/wdk-react-native-secure-storage` | 2026-09-20 | **deprecated**, now inlined into core |
| `tetherto/wdk-worklet-bundler` | 2026-11-02 (v1.0.0-beta.17) | builds the worklet bundle |
| `tetherto/wdk-mcp-toolkit`, `wdk-agent-skills`, `wdk-examples` | Oct to Nov 2026 | agent material |
| `holepunchto/react-native-bare-kit` | 2026-11-03 (0.17.1) | |

## Summary

- The starter is a well-documented **reference wallet UI** under Apache-2.0. It is labelled alpha. It covers BTC, USD₮ on Sepolia and Polygon, and USD₮0 on Arbitrum. It is not an app shell suited to an agent product. Of `src/`'s ~7.9k LOC, ~4.9k is wallet screens, components and theme, and ~3.0k is WDK glue, of which ~1.3k is cloud backup plus the password vault.
- **The master branch is in an inconsistent state right now.** Dependabot moved `expo` to 58.0.22 (#76) and `expo-router` to 58.0.29 (#77). The other `expo-*` modules are still on 55.x and `react-native` is still 0.83.6. Meanwhile `docs/ENVIRONMENT.md` says "Expo SDK **55** (not 56)" and that core is pinned to beta.10, when the actual pin is beta.17. If we forked today we would inherit a likely-broken baseline and stale docs.
- **The default build breaks the privacy promise.** It ships Google Sign-In with a published demo OAuth client, iCloud CloudKit JS loaded in a WebView from Apple's CDN, and an encrypted seed uploaded to Drive or iCloud. It also sends calls to CoinGecko, to the Tether-hosted Indexer (the Activity tab sends every address plus an API key), to public RPCs and Pimlico, and to Spark/Lightspark operators baked into the worklet bundle. It has no Sentry or analytics.
- **bare-kit:** the starter pins 0.14.5. Latest is 0.17.1. QVAC needs >=0.16. **Bumping is not a version-string change.** 0.16 removed automatic addon linking. 0.17 ("Rework using Bare Kit v3") stops bundling Bare Kit itself, so the app has to link it with `bare-stow`. Tether's own issue `wdk-react-native-core#140` (open, 2026-11-03) reports that WDK RN **fails on 0.16** with `AddonError: CANNOT_LOAD ... libbare-type` and **ships no Bare libraries on 0.17**. Migration is unsolved upstream.
- **Two worklets (WDK plus QVAC):** this is technically allowed, since each library calls `new Worklet()` and bare-kit's docs talk about "all of the worklets of the application". The blocker is native addon linking. QVAC's Expo plugin **deletes and re-links** react-native-bare-kit's addon dirs with only its own worker's addons (`qvac/packages/sdk/src/expo/plugins/link-addons.ts`: `fsp.rm(out)`, "replacing what the platform had"). That would drop WDK's addons. We found no official example that runs WDK and QVAC together.
- **Agent and payments:** WDK core now has a real **transaction policy engine** (`registerPolicy`, ALLOW/DENY, deny-by-default for unknown write methods, `simulate`). It lives in `@tetherto/wdk` inside the worklet and is **not exposed** through `pear-wrk-wdk` HRPC or `wdk-react-native-core`. There is **no Tether x402 package**: the docs use the third-party `@x402/*` packages with a WDK EVM account, Node only, USD₮0 on Plasma/Stable, and the example **signs automatically with no approval or limit**. The official MCP server **auto-confirms all writes when elicitation is off** (`wdk-mcp-toolkit/src/server.js:276-279`).
- **Recommendation: do not fork. Start a clean Expo app.** Add `@tetherto/wdk-react-native-core` plus `wdk-worklet-bundler` later, behind our cage, in the payments milestone. Use the starter only as reading material: `src/wdk/networks.ts`, `src/wdk/useSend.ts`, `docs/TROUBLESHOOTING.md`.

## Verified / refuted claims

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| 1a | Starter license is Apache-2.0 | **Verified** | `wdk-starter-react-native/LICENSE`; every `@tetherto/*` package is Apache-2.0 (`npm view`) |
| 1b | Last update | **Verified: 2026-11-02**, dependabot only. Last human PR is #73 (2026-10-20) | `git log`; `gh api .../commits` |
| 1c | Expo SDK version | **Mixed.** README and ENVIRONMENT say SDK 55, but `package.json` has `expo ^58.0.22` and `expo-router ^58.0.29` (lock: 58.0.22 / 58.0.29) while other expo modules are `~55.x` | `package.json`, `package-lock.json`, commits #76 and #77 |
| 1d | React Native version | **Verified: 0.83.6**, React 19.2.0 | `package.json` |
| 1e | New Architecture | **On.** It is mandatory on RN >= 0.82; there is no `newArchEnabled:false` anywhere. It uses `react-native-nitro-modules` and reanimated 4, which need New Arch | `app.json`, `package.json` |
| 1f | Package manager | **npm**, and it must be >= 11.10.1 (npm/cli#8726 lockfile bug). Uses `package-lock.json` and `overrides` | `README.md`, `docs/ENVIRONMENT.md` |
| 2a | USD₮, USD₮0, BTC send/receive | **Verified, with caveats.** BTC goes through Trezor Blockbook (testnet by default). USDT is on Sepolia (Candide test token) and Polygon mainnet. USDT0 is on Arbitrum mainnet (`0xFd08...cbb9`). EVM sends use `wdk-wallet-evm-7702-gasless` and **need a Pimlico/Candide bundler key**. Spark/Lightning is bundled but not surfaced. Tron is on hold | `src/wdk/networks.ts:153-281`, `wdk.config.js`, `.env.example` |
| 2b | Encrypted key storage | **Verified, but the mechanism has changed under it.** The seed is encrypted in the worklet; `encryptionKey` and `encryptedSeed` live in the Keychain/Keystore. Pinned core beta.17 uses `wdk-react-native-secure-storage` (`react-native-keychain` plus `expo-local-authentication`, `WHEN_UNLOCKED_THIS_DEVICE_ONLY`, biometric/passcode ACL). Latest core beta.24 **inlined storage and removed device-auth gating "by design"**, so the app now owns biometrics. The starter adds an **app password** in `expo-secure-store` using a recoverable envelope: the vault key and the ciphertext sit in the same Keychain, with scrypt N=2^4. There are no lockout or rate limits | `docs/SECURITY.md`; `src/wdk/passwordVault.ts`; `wdk-react-native-core/src/storage/secureStorage.ts:15-27`; `wdk-react-native-core/docs/security.md` |
| 2c | QR scanner | **Refuted.** No camera dependency. The "Scan" buttons call `comingSoon('Scan')`. The app only *renders* QR codes (`react-native-qrcode-svg`) | `src/app/(app)/(tabs)/wallet.tsx:122`, `src/app/send/amount.tsx:19` |
| 2d | react-native-webview present | **Verified (13.16.0).** It is used only for CloudKit JS sign-in in cloud backup | `src/wdk/cloud-backup/CloudKitAuthWebView.tsx`, `cloudkitAuthHtml.ts` |
| 3a | Starter pins `react-native-bare-kit` 0.14.5 | **Verified** (exact pin, lock 0.14.5) | `package.json` |
| 3b | WDK core accepts >=0.14.5 | **Verified** (peer `react-native-bare-kit: >=0.14.5` in beta.17 and beta.24) | `npm view @tetherto/wdk-react-native-core peerDependencies` |
| 3c | Latest bare-kit is 0.17.x | **Verified: 0.17.1** (2026-11-03). QVAC `@qvac/sdk` 0.23.0 peer is `>=0.16.0` | `npm view` |
| 3d | Bumping to >=0.16 is plausible | **Not today without work.** 0.16 "Remove automatic addon linking" (#65). 0.17 "Rework using Bare Kit v3" (#67): Bare Kit is no longer bundled, so the app must link it via `bare-stow`/`expo-bare-kit`. Tether reports WDK breaks on both (open issue below). The bundler's `--link-addons` exists but is off by default for HRPC/RN. Tether's own roadmap moves to bare-stow (`wdk-worklet-bundler#84`) | `tetherto/wdk-react-native-core#140`; bare-kit commit log; `wdk-worklet-bundler/README.md:143,298` |
| 4a | Google sign-in | **Verified (privacy leak).** `@react-native-google-signin/google-signin` is in plugins. `.env.example` ships Tether's **published demo** client ID for web and iOS. Scope `drive.appdata` | `app.json` plugins, `.env.example`, `src/wdk/cloud-backup/*` |
| 4b | Cloud backup | **Verified (privacy leak).** `@tetherto/wdk-backup-cloud` uploads the mnemonic encrypted with the app password to Google Drive appData or iCloud (CloudKit Web Services via WebView). It is optional in onboarding ("manually" skips it), but the code, entitlements (`iCloud.io.tether.wdkshowcase`) and providers are always in the app | `docs/CLOUD_BACKUP.md`, `src/app/(onboarding)/cloud-backup.tsx`, `app.json` entitlements |
| 4c | Tether hosted Indexer sees addresses (for balances) | **Partly refuted.** Balances come straight from chain RPCs via the worklet (`useBalancesForWallet`). The Indexer (`https://wdk-api.tether.io`, API key required) is used for the **Activity/tx history**, and it is sent every BTC and EVM address of the active account | `src/wdk/indexer.ts:35`, `src/wdk/hooks/useWalletData.ts:73,242` |
| 4d | Sentry or other telemetry | **Refuted.** No Sentry, PostHog, Firebase, Amplitude or Segment in the lockfile or the 12 MB worklet bundle. Note: Spark SDK code sets `User-Agent`/`X-Client-Env` headers to its operators, and EAS build config is present | lockfile scan; `.wdk-bundle/wdk-worklet.bundle.js` grep |
| 5 | Worklet / RPC / seed flow | **Verified**, see Architecture | `wdk-react-native-core/src/services/workletLifecycleService.ts:84-140`, `pear-wrk-wdk/schema.json` |
| 6 | Two bare worklets can coexist | **Plausible in principle, unproven in practice.** Both WDK and QVAC call `new Worklet()` independently. The conflict is addon linking (QVAC wipes bare-kit's addon dirs). No example or issue shows both together | `qvac/packages/sdk/src/client/rpc/expo-rpc-client.ts:75`, `qvac/packages/sdk/src/expo/plugins/link-addons.ts` |
| 7a | x402 package in WDK | **Refuted (no `@tetherto` x402 package).** The docs page `docs.wdk.tether.io/ai/x402/` uses third-party `@x402/fetch,evm,core` 2.26 with `@tetherto/wdk-wallet-evm`, a Semantic-hosted facilitator, and USD₮0 on Plasma (`eip155:9745`) and Stable (`eip155:988`). Node only, not RN. Strict-TS signer mismatch is reported in `wdk-wallet-evm#132` | WebFetch of the docs; `npm search`; GH issue |
| 7b | Spending-limit / policy primitives | **Verified, in core only.** `@tetherto/wdk` `registerPolicy` / `simulate` / `PolicyViolationError`, deny-by-default for write methods. **Not reachable from RN**: no policy method in the `pear-wrk-wdk` HRPC schema, and nothing in `wdk-react-native-core/src`. Conditions are JS functions, so they would have to be compiled into a custom worklet. Templates are "coming later". Community: `@flashyfinancial/wdk-policy-guard`, `@observer-protocol/wdk-op-policy` | `wdk/src/policy/*`, `wdk/README.md:60-172` |
| 7c | Official agent examples auto-approve transfers | **Partly verified.** `wdk-mcp-toolkit` asks for confirmation via MCP elicitation by default, but **auto-accepts** when elicitation is disabled (`WDK_MCP_ELICITATION=false`). The x402 docs example signs with no prompt. `wdk-agent-skills/skills/wdk/SKILL.md:173-230` tells agents to require human confirmation (prompt-level only) | cited files |

## Architecture of the starter

```
Expo Router screens (src/app/**)  ~4.9k LOC of wallet UI, theme, components
  -> src/wdk/hooks/useWalletData.ts, useWalletActions.ts, useSend.ts, indexer.ts, pricing.ts
  -> @tetherto/wdk-react-native-core (WdkAppProvider, useWalletManager, useAccount, useBalancesForWallet)
       WorkletLifecycleService.startWorklet():  new Worklet(); worklet.start('wdk-worklet.bundle', bundle)
       HRPC over worklet.IPC (hyperschema binary RPC from @tetherto/pear-wrk-wdk)
  -> Bare worklet (.wdk-bundle/wdk-worklet.bundle.js, 12 MB, generated by `postinstall: wdk-worklet-bundler generate` from wdk.config.js)
       @tetherto/pear-wrk-wdk handlers: workletStart, initializeWDK, generateEntropyAndEncrypt,
       getMnemonicFromEntropy, getSeedAndEntropyFromMnemonic, registerWallet, registerProtocol,
       callMethod, callModule, resetWdkWallets, dispose, log, moduleEvent
       @tetherto/wdk + wallet modules (btc, spark, evm-7702-gasless x3), preload spark-frost-bare-addon
```

- **Worker:** a single Bare worklet started from the RN JS thread. The bundle is checked in (`.wdk-bundle/`) and regenerated on `postinstall`. Native addons are auto-linked by bare-kit 0.14.5. That is the step 0.16+ removed.
- **RPC:** `callMethod` is generic: the UI can call any account method by name (`AccountService` validates against a whitelist). Any cage we build must sit **in front of** this call, or inside the worklet. Otherwise any JS on the RN side can request a transfer.
- **Seed lifecycle:** create/import goes through `generateEntropyAndEncrypt` / `getSeedAndEntropyFromMnemonic` in the worklet. That returns `encryptionKey`, `encryptedSeed` and `encryptedEntropy`, which RN stores in the Keychain via `react-native-keychain`. On unlock, RN reads all three from the Keychain and passes key plus ciphertext over IPC to `initializeWDK`, and the worklet decrypts in memory. So the **RN JS thread does handle the decryption key**: the worklet gives thread isolation, not a secure enclave. `getMnemonic()` returns the plaintext mnemonic to RN (used for seed reveal). Core zeroes buffers and caches no secrets (`wdk-react-native-core/docs/security.md`).
- **Unlock UX:** `src/app/unlock.tsx` checks the app password (`passwordVault.ts`) and then calls `wm.unlock('primary')`. `AutoLockOnBackground.tsx` locks on background. The wallet ID is a fixed constant, `'primary'` (`src/wdk/walletIdentity.ts`). Account list is kept in memory only, plus on-chain discovery of indices 1 to 5 (`AccountDiscovery.tsx`).
- **Dead or extra code:** `src/data/**` (the docs call it dead), `src/wdk/cloud-backup/**`, `src/wdk/cloudBackupEncryption.ts`, `modules/cloud-backup/`, onboarding screens `cloud-*.tsx`, `.github/workflows` with EAS publish.

## Network endpoints

App-side (`src/`, `app.json`, `.env.example` defaults):

| Endpoint | Purpose | Data exposed |
|---|---|---|
| `https://tbtc1.trezor.io/api` (default), `https://btc1.trezor.io/api` (fallback in `networks.ts:420`) | BTC Blockbook balances, UTXOs, broadcast | all BTC addresses/xpub-derived addrs, IP |
| `https://ethereum-sepolia-rpc.publicnode.com` | Sepolia RPC | EVM address, IP |
| `https://arb1.arbitrum.io/rpc` | Arbitrum RPC | EVM address, IP |
| `https://polygon.drpc.org` | Polygon RPC | EVM address, IP |
| `https://api.pimlico.io/v2/{sepolia,arbitrum,polygon}/rpc?apikey=` | 7702 bundler/paymaster | UserOps, address, API key |
| `https://wdk-api.tether.io` | WDK Indexer (Activity) | every address of the active account, API key |
| `https://api.coingecko.com/api/v3` (or `pro-api`) | USD prices | asset symbols, IP |
| Google Sign-In / `https://www.googleapis.com/auth/drive.appdata` | cloud backup | Google identity, encrypted seed blob |
| `https://cdn.apple-cloudkit.com/ck/2/cloudkit.js`, `https://api.apple-cloudkit.com/database/1/` | iCloud backup via WebView (remote JS loaded at runtime) | Apple ID session, encrypted seed blob |
| `https://wdk-starter-react-native.app/cloudkit-callback` | CloudKit redirect (intercepted, not loaded) | none |
| explorers `mempool.space`, `sepolia.etherscan.io`, `arbiscan.io`, `polygonscan.com` | user-tapped links only | tx hash |

Inside the worklet bundle (string literals that look like runtime endpoints, mostly Spark and EVM-AA defaults):
`https://0.spark.lightspark.com`, `https://2.spark.flashnet.xyz`, `https://spark-operator.breez.technology` (Spark signing operators), `https://api.lightspark.com` (Spark SSP), `https://api.sparkscan.io`, `https://mempool.space/api`, `https://api.candide.dev/public/v3/11155111`, `https://api.candide.dev/api/v3/`, `https://api.tenderly.co/api/v1/account/` (simulation, opt-in), `https://gasstation.polygon.technology/`, `https://ethereum-sepolia.publicnode.com`, `https://btc1.trezor.io/api`. Build and dev only: EAS (`expo.dev`), `registry.npmjs.org`.

**Telemetry / crash reporting: none found.**

## Fork-vs-depend recommendation

**Start a clean Expo app (Hermit's own shell, cage and QVAC first). Add WDK as a dependency in the payments milestone. Do not fork the starter.**

Reasons:
1. **Most of the starter is code we would delete.** About 4.9k of ~7.9k LOC is wallet-shaped UI (`src/app/**`, `src/components/**`, `src/theme/**`) that does not fit a chat/agent-first UX. Of the 3.0k in `src/wdk/**`, cloud backup (`cloud-backup/**`, `cloudBackupEncryption.ts`), `passwordVault.ts` (a weaker model than our cage) and the dead `src/data/**` all go. That leaves roughly `networks.ts`, `useSend.ts`, `useWalletData.ts` and `hooks/AccountDiscovery*.tsx` worth adapting (~1k LOC), and those are easier to copy with attribution than to inherit.
2. **The rename and strip cost is real.** Bundle IDs `io.tether.wdk.starter.reactnative`, the CloudKit entitlement `iCloud.io.tether.wdkshowcase`, the Google plugin and demo client ID, `expo-secure-store configureAndroidBackup`, `modules/cloud-backup/withModularHeaders.js`, EAS workflows with `REPLACE_WITH_*`, the orange splash, `.env.example` defaults pointing at Pimlico, Trezor and drpc. Every one of these is a privacy or branding item to audit.
3. **Upstream drift is high and the base is moving.** Master currently mixes Expo 58 core with SDK 55 modules and RN 0.83.6, and its docs contradict its manifest. Core went beta.17 to beta.24 in weeks, inlined secure storage and dropped biometric gating. The whole RN worklet path has to migrate to bare-stow for bare-kit 0.17 (`wdk-react-native-core#140`, `wdk-worklet-bundler#84`). A fork would freeze us on 0.14.5, which **blocks QVAC (>=0.16)**. A dependency lets us adopt the bare-stow release when it lands.
4. **The first milestone may not need payments.** Shipping QVAC plus the cage without WDK avoids the bare-kit conflict entirely at first. When payments arrive, we add `@tetherto/wdk-react-native-core`, `@tetherto/wdk-worklet-bundler` and the needed `wdk-wallet-*` modules, plus one combined addon-linking step.
5. **The cage has to own approval and policy anyway.** WDK's policy engine is core-only and does not reach RN. Official agent paths can auto-approve. Hermit should either (a) build a custom worklet entry that calls `wdk.registerPolicy` with rules derived from our signed policy file, or (b) gate every `callMethod`/`useSend` call in RN behind the cage plus biometric approval. We should do both: defence in depth.

Concrete plan for when we add WDK:
- Use one react-native-bare-kit (>=0.17) and one linking step that runs `bare-link`/`bare-stow` over **both** entry points: `.wdk-bundle` entry and QVAC worker. Do not let QVAC's `linkAddons` (which `rm`s the target dirs) run on its own. Watch for duplicate addon libs (QVAC `warnOverwritten`) such as `bare-type` and `sodium-native` with diverging versions.
- Pin `@tetherto/wdk-react-native-core` exactly. Check its `expo-crypto >=55 <57` peer against our Expo SDK before choosing an SDK.
- Do not use: `@tetherto/wdk-backup-cloud`, Google Sign-In, CloudKit WebView, the Indexer (derive history from our own RPC or skip it), or default CoinGecko calls (make pricing opt-in).
- Keep Spark out of `wdk.config.js` unless needed. It brings third-party operators and a native addon.
- For x402: USD₮0 EIP-3009 signing through `@x402/evm` with a WDK EVM account, gated by the cage. Accept that there is no RN example and the networks are limited to Plasma and Stable today.

## Risks

- **bare-kit migration (high):** WDK on RN is only known-good on 0.14.5. 0.16 crashes and 0.17 needs bare-stow linking. There is no Tether timeline. This is the critical path for running WDK and QVAC in one app.
- **Two-worklet memory and lifecycle (medium):** two Bare runtimes, plus an LLM, on a phone. Background suspension is handled per worklet. This is untested together.
- **Pre-1.0 churn (high):** every `@tetherto/wdk*` package is `1.0.0-beta.x`. Secure-storage semantics changed between betas (biometric ACL removed). The starter README says "Do not use with real funds".
- **Key exposure on the RN thread (medium):** the encryption key and encrypted seed cross IPC from RN, and `getMnemonic()` returns plaintext to JS. Our vault and cage design must assume the RN JS context is trusted, or move the key handling.
- **Policy bypass (medium):** core policies don't apply to accounts built directly or to protocols registered via `wdk.registerProtocol` (README:103). The default client in the x402 docs auto-signs.
- **Third-party infrastructure leaks (medium):** gasless EVM needs a bundler and paymaster (Pimlico/Candide) that see every UserOp. BTC needs a Blockbook server. Self-hosting or rotating these is a product decision for "Tells no one".
- **Expo SDK alignment (medium):** core's `expo-crypto` peer caps at <57. QVAC wants `expo-file-system >=19`. The starter's own Expo 55/58 mix shows how fragile this is.
