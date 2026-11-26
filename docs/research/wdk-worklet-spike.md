# WDK in the worklet with bare-kit 0.16 (SL-17)

Date: 2026-11-17. Slice: SL-17 (W2, tier T1). Assumption under test: ASM-08 (WDK runs in the same worklet once its bare-kit dependency moves from 0.14.5 to 0.16 or later). Dependency: DEP-07 (a WDK release compatible with bare-kit 0.16 or later, owner Tether). It unblocks W5 (SL-38 to SL-41). Background: `docs/research/wdk.md` (2026-11-08) and `docs/research/x402-spike.md` (SL-18).

## Verdict

1. **DEP-07 is still open.** Tether has not shipped a WDK release for react-native-bare-kit 0.16 or later. Its React Native host, `@tetherto/wdk-react-native-core`, is unchanged since 1.0.0-beta.24 (2026-11-04). Issue #140 has been open with no reply since 2026-11-03. Tether's roadmap moves the Kotlin and Swift cores to bare-stow first, and its maintainers wrote on 2026-11-08 that React Native "is out of this roadmap". The host also caps `expo-crypto` below 57, while Hermit runs Expo SDK 58.
2. **Hermit doesn't need that release.** The wallet module itself, `@tetherto/wdk-wallet-evm` 1.0.0-beta.26, runs on Bare 1.33.4, the runtime that react-native-bare-kit 0.16.0 embeds, once three transitive packages are pinned. On a Mac, inside Bare 1.33.4, it:
   - creates a wallet from a mnemonic generated at runtime;
   - derives the EVM address at `m/44'/60'/0'/0/0`;
   - reads USD₮0 and native balances from Stable testnet over the public RPC;
   - signs an EIP-3009 `TransferWithAuthorization` that `packages/payments` recovers to the same address.

   Hermit runs it in its own wallet worklet, packed with bare-pack, with its addons linked into react-native-bare-kit next to QVAC's. That replaces the automatic linking bare-kit 0.16 removed, which was the cause of Tether's `CANNOT_LOAD ... libbare-type` error.
3. **Go for W5, on one condition: a phone session.** The phone must start the wallet worklet next to QVAC's in the same APK, load its 27 linked addons, and pass the dev screen's checks (see "Phone checks"). If the phone fails, the fallback is Q109's third option: sign with `packages/payments`' own key code in Hermes. That works today, but it drops WDK.

ASM-08 stays **Unverified** until the phone run, and its evidence column in the PRD now records the Mac result. DEP-07's row in the PRD says it is still open and that SL-17 works around it.

## Evidence (sources, read 2026-11-17)

### npm releases

From `npm view` on the npm registry, release dates in UTC:

| Package | Latest | Date | Note |
| :---- | :---- | :---- | :---- |
| `@tetherto/wdk-react-native-core` | 1.0.0-beta.24 | 2026-11-04 | peers `react-native-bare-kit >=0.14.5`, `expo-crypto >=55 <57`; deps `@tetherto/pear-wrk-wdk` 1.0.0-beta.15 |
| `@tetherto/wdk-worklet-bundler` | 1.0.0-beta.17 | 2026-11-02 | still bare-pack 2 and bare-link 3 |
| `@tetherto/pear-wrk-wdk` | 1.0.0-beta.18 | 2026-11-13 | mnemonic whitespace fix only |
| `@tetherto/wdk` | 1.0.0-beta.23 | 2026-11-12 | |
| `@tetherto/wdk-wallet-evm` | 1.0.0-beta.26 | 2026-11-09 | used here; ships a `bare` export (`bare.js`) that loads `bare-node-runtime` |
| `react-native-bare-kit` | 0.17.1 (0.16.0 is what Hermit pins) | 2026-11-03 (0.16.0: 2026-10-09) | 0.16.0 embeds Bare Kit 2.5.x with **Bare 1.33.4** (`strings libbare-kit.so`; bare-kit v2.5.4 notes "Update Bare to v1.33.4") |
| `bare-kit` (native) | v3.1.0 | 2026-11-11 | "Update Bare to v1.37.1"; v3.0.0 (2026-10-30) has Bare 1.33.5 |
| `bare-stow` | 0.3.9 | 2026-11-13 | |
| `bare-pack` | 3.2.0 | 2026-11-16 | Hermit's lockfile has 3.1.0 |

### GitHub

From `gh` on 2026-11-17:

- `tetherto/wdk-react-native-core#140`, "Adopt bare-stow (react-native-bare-kit 0.17+)", opened 2026-11-03, still open with no comments. Its report:
  - 0.14.5 works;
  - on 0.16.0 the worklet aborts with `AddonError: CANNOT_LOAD: Cannot load addon 'linked:libbare-type.1.4.0.so'`;
  - on 0.17.0 the APK carries no Bare libraries at all.
- `tetherto/wdk-worklet-bundler#84`, "Roadmap v2: wdk-core-kotlin and wdk-core-swift on bare-stow", open, last updated 2026-11-12:
  - the body says `wdk-react-native-core` "will move to bare-stow after the cores ship, in the next roadmap";
  - a maintainer comment from 2026-11-08 says "RN. Agree it's out of this roadmap."
- The latest commits in `wdk-react-native-core`, `wdk-worklet-bundler` and `wdk-starter-react-native` are releases from 2026-11-02 to 2026-11-04 and dependabot bumps. None of them touches bare-kit.
- A web search for a WDK release targeting bare-kit 0.16 or bare-stow found only the WDK docs. Those state the `>=0.14.5` peer and nothing newer ([React Native Core docs](https://docs.wdk.tether.io/start-building/react-native-quickstart), [Worklet Bundler docs](https://docs.wdk.tether.io/tools/worklet-bundler)).

### Why bare-kit 0.16 broke WDK, measured

1. **No automatic addon linking.** The react-native-bare-kit 0.16.0 README says: "Native addons used by the worklet are not linked automatically. Applications must link them... such as by using bare-link". QVAC's Expo plugin does this for its own worker only, and deletes the folder first (`link-addons.js`: `fsp.rm(out)`). A WDK bundle on 0.16 therefore finds none of its addons. That is the `CANNOT_LOAD` in #140.
2. **New engine floors (new finding).** On 2026-11-12, `bare-type` 1.5.0 and 1.6.0, `bare-realm` 2.1.0 and 2.1.1 raised `engines.bare` to `>=1.37.0`, and `bare-module` 7.5.x needs `>=1.35.0`. `bare-node-runtime` 1.5.5, which every WDK wallet module depends on, accepts all of these. A fresh install today therefore fails on Bare 1.33.4:

   ```
   Uncaught ModuleResolveError: UNSUPPORTED_ENGINE: Package not compatible with engine 'bare' 1.33.4,
   requires range '>=1.35.0' defined by "engines" in '.../node_modules/bare-module/package.json'
   ```

   Pinning `bare-module` 7.4.0, `bare-realm` 2.0.2 and `bare-type` 1.4.0 (the same `bare-type` QVAC uses) with npm `overrides` fixes it. It also breaks any app on react-native-bare-kit 0.17.1 that links Bare Kit 3.0.x (Bare 1.33.5). Only Bare Kit 3.1.0 (Bare 1.37.1) accepts the newest packages.

## What was built

| Piece | Where | Notes |
| :---- | :---- | :---- |
| Wallet worklet | `apps/mobile/worklets/wallet/` (`handler.mjs`, `index.mjs`) | A standalone npm project with its own `package-lock.json` and exact pins plus three overrides. It is not a pnpm workspace package, so no root install is needed. Newline JSON over `BareKit.IPC`. Five methods: `open`, `address`, `balance`, `signTransferWithAuthorization`, `close`. Stable testnet only (chain 2201, USD₮0 `0x78Cf...c9A9`, domain `USD₮0` version `1`). The worklet fixes the struct, refuses any other chain, token, payer or extra field, and has no generic call and no method that returns the seed or a key. For the spike, `open` makes a random wallet held in memory; SL-38 replaces it with the Keystore-wrapped seed. |
| Build and link | `build.mjs`, `link.mjs` | Copies the folder to a scratch directory in the OS temp dir, so 320 MB of `node_modules` stay out of the repository and out of Metro, then runs `npm ci --ignore-scripts`. Packs with bare-pack under the Bare runtime (`--linked`, Android arm64 and x64) into `dist/wallet.bundle.cjs`, which is gitignored. Reads the bundle header's `addons` list and links exactly those 27 addons into `react-native-bare-kit/android/src/main/addons` without deleting QVAC's. Run it after `expo prebuild` and `scripts/qvac-bundle.mjs` (Q111). |
| Mac check | `mac-check.mjs` | Under Bare 1.33.4, drives the handler (or a Mac-packed bundle) through a stand-in for `BareKit.IPC`. Every request is split mid-character to prove the framing. |
| App-side client | `packages/payments/src/wallet-ipc.ts` | Pure TypeScript with no network, 18 tests. Line splitter (fatal UTF-8, 64 KiB line cap), client matched by request id, `fail()` when the worklet stops, `openWallet`, `readBalance` (bigint), and `workletSigner`. `workletSigner` is the `TypedDataSigner` that `payWithX402` takes. It refuses an authorization from another payer before sending, normalizes `v`, and recovers every signature: anything not from the wallet's address is `signer_mismatch`. |
| Fixture | `packages/payments/test/fixtures.ts` `WDK_BARE_SIGNATURE` | A real WDK signature made inside Bare 1.33.4, recovered by Hermit's noble-based EIP-712 code. Only the public address and the signature are kept. |
| Dev screen | `apps/mobile/src/app/wallet-debug.tsx` (`hermit://wallet-debug`), adapter `apps/mobile/src/adapters/wallet-worklet.ts` | `__DEV__` only, copy `HM-DEV-02.*` in en and es-419, a row in the UI states doc. Starts the worklet, opens the wallet, reads balances, signs and verifies, sends the three refusal cases raw, shows timings. The bundle is loaded with an optional `require` inside try/catch (Metro's `allowOptionalDependencies` is on in Expo 58), so a build without it still works and the screen says how to make it. `@hermit/payments` is now an app dependency; its importer entry in `pnpm-lock.yaml` was added by hand. |

## Mac runs (2026-11-17)

Bare 1.33.4 is `bare-runtime-darwin-arm64@1.33.4`, the same Bare version as react-native-bare-kit 0.16.0.

| Run | Runtime | Result |
| :---- | :---- | :---- |
| Latest deps, no pins | Bare 1.38.0 | Works: address, balances, signature |
| Latest deps, no pins | **Bare 1.33.4** | **Fails**: `UNSUPPORTED_ENGINE` (`bare-module` needs `>=1.35.0`) |
| Three pins (`bare-module` 7.4.0, `bare-realm` 2.0.2, `bare-type` 1.4.0) | **Bare 1.33.4** | **Works**, from source through the worklet handler: `open` 71 to 344 ms, `balance` 0.9 to 1.6 s (two RPC reads over the network), `sign` 6 to 11 ms |
| Refusals through the handler | Bare 1.33.4 | other chain `unsupported_network`, other payer `wrong_payer`, extra field `bad_input`, `getMnemonic` `unknown_method`, `constructor` `unknown_method` |
| Balance read of a funded holder (`0x9335...e1a7`, from recent USD₮0 `Transfer` logs) | Bare 1.33.4 | USD₮0 `2867047917` (6 decimals), native `2867047917729459646391` (18 decimals). The same money, as SL-18 found: gas on Stable is USD₮0 |
| Signature check | Node, `packages/payments` | `recoverTypedDataSigner` returns the WDK address; changing the amount by one base unit changes the recovered address. The signer is a plain EOA (`SeedSignerEvm` on ethers 6.17.0), so the token's `ecrecover` accepts it and no ERC-1271 is needed. `v` comes back as 27 or 28 |
| Packed bundle (darwin, offloaded addons) | Bare 1.38.0 | Works end to end through the IPC stand-in |
| Packed bundle (darwin, offloaded addons) | Bare 1.33.4 | Fails to find the offloaded `bare-thread` addon (`ADDON_NOT_FOUND`, candidates named `bare-thread@1.4.0.bare` inside the bundle path). This is a quirk of Mac-only offloading in that Bare version. The phone uses linked addons instead, so the phone run must prove that path |
| Android bundle | bare-pack 3.1.0 under Bare 1.38.0 | `wallet.bundle.cjs` 3.66 MB (585 files), 27 `linked:` addons. Linked into a real react-native-bare-kit 0.16.0 package: 54 `.so` files (27 each for arm64-v8a and x86_64), 25 MB per ABI before APK compression |

### Wallet addons against QVAC's (the app lockfile)

The same version as QVAC's in 15 of 27: `bare-abort`, `bare-fs`, `bare-hrtime`, `bare-module-lexer`, `bare-os`, `bare-performance`, `bare-pipe`, `bare-signals`, `bare-stdio`, `bare-structured-clone`, `bare-tcp`, `bare-tty`, `bare-type` 1.4.0, `bare-zlib`, `sodium-native` 5.2.1.

Different or new in 12:

| Addon | Wallet | QVAC |
| :---- | :---- | :---- |
| bare-buffer | 3.7.3 | 3.7.1 |
| bare-crypto | 1.16.0 | 1.15.4 |
| bare-dns | 2.3.3 | 2.3.2 |
| bare-inspect | 3.1.11 | 3.1.10 |
| bare-module | 7.4.0 | 6.4.0 |
| bare-path | 3.1.3 | 3.1.2 |
| bare-tls | 4.1.0 | 3.2.1 |
| bare-type-stripper | 0.1.6 | 0.1.7 |
| bare-url | 2.5.8 | 2.5.6 |
| bare-broadcast-channel | new | none |
| bare-channel | new | none |
| bare-thread | new | none |

Linked file names carry the version (`libbare-tls.4.1.0.so`), so both copies coexist. The extra files are 23 MB per ABI, mostly `bare-tls` (16.5 MB) and `bare-crypto` (7.2 MB). Q110 asks whether to pin them to QVAC's versions.

### Network and privacy

The packed bundle names one runtime endpoint: `https://rpc.testnet.stable.xyz`, the provider the worklet passes in. Every other URL in it is a comment or documentation link. There is no indexer, price feed, bundler or telemetry. The RPC sees the wallet address and the phone's IP, as with SL-18's balance check.

## Problems found on the build Mac

- **Node segfaults inside `bare-module-lexer` 1.7.0's Node addon.** It happens on Node 22.17.1 and 24.4.1 on macOS 26. Calling the lexer once reproduces it, both in the scratch install and in an existing Hermit workspace's `node_modules`. bare-pack and bare-link both load it under Node, so they exit with 139 and no message. Running them under the Bare runtime, which loads the `.bare` build of the same lexer, works. `build.mjs` does that.
- **Watch QVAC's bundle step.** QVAC's Expo plugin and `scripts/qvac-bundle.mjs` also run bare-pack in Node. If an `expo prebuild` on a Mac dies silently in QVAC's bundle step, this lexer crash is the likely cause.
- **bare-link has no `--defer` flag.** Linking from the source entry stops at `ws`'s optional `bufferutil` and `utf-8-validate`. `link.mjs` links from the packed bundle's `addons` list instead.
- **bare-pack's `--preset` reads `process`, which fails under Bare.** `build.mjs` passes `--linked` and `--host` explicitly instead.

## Risks

- **Two worklets in one process (medium, phone).** QVAC's and the wallet's run side by side. The open questions are memory and suspend and resume per worklet, and two versions of the same addon library loaded at once (Q110).
- **Prebuild order (medium).** Any `expo prebuild` wipes the wallet's addons until `build.mjs` runs again (Q111). The symptom is `CANNOT_LOAD` when the worklet starts.
- **Pin drift (medium).** The three overrides hold only while WDK's `bare-node-runtime` range allows them, and while Hermit stays on bare-kit 0.16. Moving to react-native-bare-kit 0.17 with Bare Kit 3.1.0 would allow dropping them, but 0.17 needs bare-stow linking for QVAC as well.
- **Pre-1.0 WDK (medium).** Every `@tetherto/wdk*` package is a beta. `wdk-wallet-evm` went from beta.24 to beta.26 in three weeks. Keep the exact pin and the fixture test.
- **Policy engine (low for now).** WDK's `registerPolicy` is still not reachable from React Native. The worklet exposes no generic call, so the cage (SL-37's signed approvals) is the only gate, and the worklet's own checks are defence in depth.
- **Seed in JavaScript memory (medium, W5).** The spike's random phrase is a JavaScript string, which can't be zeroed. SL-38 should pass the seed as bytes and dispose the wallet when the app locks, as `pear-wrk-wdk` beta.17 does (secrets as buffers, zeroed on dispose).

## Phone checks (need the S26 Ultra; no CI APK build while GitHub Actions is off)

On the build machine, in order (since SL-38, see below; the manual `build.mjs` step is gone):
1. `pnpm install --offline --frozen-lockfile` (picks up the `@hermit/payments` app dependency).
2. `expo prebuild`: QVAC's plugin links its worker's addons, then the wallet plugin packs the wallet bundle and adds its addons. If `node scripts/qvac-bundle.mjs` is run on its own afterwards, it empties the folder again: run `node apps/mobile/worklets/wallet/build.mjs` (the fallback) after it.
3. `npx expo run:android --device` with Metro started with `--clear` (a stale Metro watcher once served old code to the phone).

Then on the phone, open `hermit://wallet-debug`:

1. **Start the wallet worklet.** It starts, `open` returns an address and `m/44'/60'/0'/0/0`, and nothing in logcat (`bare` tag) says `CANNOT_LOAD` or `UNSUPPORTED_ENGINE`. This proves the linked addons and Bare 1.33.4 on the device.
2. **Balances.** USD₮0 and native balances read 0 for the fresh wallet, and "Read the balance again" works.
3. **Sign a test authorization.** It shows "Signed in the worklet and verified here". The three refusals read `unsupported_network`, `wrong_payer` and `bad_input`, never "SIGNED".
4. **Both worklets together.** Load the model and chat once while the wallet worklet runs, then start the wallet with the model loaded. Record free memory and any crash. This also covers Q110: two versions of `bare-tls`, `bare-crypto` and others in one process.
5. **Lifecycle.** Background the app for a minute and come back. The wallet still answers (or fails cleanly with `worklet_stopped`), and Stop then Start works again.
6. **Timings.** Record start, open, balance and sign times from the screen, to compare with the Mac runs (open 71 to 344 ms, sign 6 to 11 ms).
7. **APK size.** Record it against the last W2 APK. Expect up to about 25 MB more uncompressed native code per ABI.
8. **Hermes checks** for the app-side client: `TextDecoder` in fatal mode on Hermes (also an SL-18 item) and `Uint8Array` writes on `worklet.IPC`.

If check 1 fails with `CANNOT_LOAD`, re-run `build.mjs` (something emptied the addon folder after the prebuild). If it still fails, record the exact library name and stop. That is Q109's decision point.

## Next for W5

- **SL-38** turns `open` into the Keystore-wrapped seed (create, back up, restore). It replaces the spike's random wallet, moves the link step into an Expo config plugin (Q111), and keeps the five-method surface.
- **SL-41** uses `workletSigner` as the `signer` port of `payWithX402`, behind the cage's `spend` approval.

## Install hygiene

Every install was in `/tmp/hermit-sl17` and deleted after the runs. There was no root `pnpm install`. The repository tests ran against `node_modules` symlinked from an existing workspace, and the symlinks were removed before committing.

## SL-38: create, back up and restore (2026-11-17)

Owner decisions: Q109 (build on this worklet behind an adapter boundary while Dojo's fork of `wdk-react-native-core` goes upstream), Q110 (the wallet ships its own addon versions, pinned to QVAC's only on a clash), Q111 (an Expo config plugin after QVAC's).

### What changed in the worklet

- **Eight fixed methods** (`METHODS` in `handler.mjs`), each with an exact set of parameters; any other method, an inherited name (`constructor`, `__proto__`), an extra request field or an extra parameter is refused:
  - `create { id, key, words }`: draws 16 (or 32) bytes of entropy from the CSPRNG (`bare-crypto`'s `randomBytes`, BoringSSL), makes the BIP-39 words from it with Hermit's own code over the English list, derives the BIP-39 seed (the `bip39` package's PBKDF2) and gives WDK the seed as bytes, never the phrase; returns only the sealed entropy and the address.
  - `restore { id, key, phrase }`: 12 or 24 lowercase English words with a valid checksum, or `bad_phrase` with no words in the error; sealed the same way.
  - `open { id, key, sealed }` (for SL-41's signing), `reveal { id, key, sealed }` (the backup screen only: the words and the address they derive), `address`, `balance { address }` (a public address through WDK's read-only account, no key), `signTransferWithAuthorization` (unchanged), `close`.
- **Sealing.** AES-256-GCM (`bare-crypto`), sealed = iv(12) ‖ ciphertext ‖ tag(16), with the wallet id as additional data, so a blob moved to another wallet id or opened with another key fails (`unseal_failed`). The key arrives as hex from the Keystore-wrapped wallet key and is zeroed after each call, as are the entropy and the seed.
- **Errors carry no input.** Only a refusal's own message goes back; anything else (a provider error) becomes "The wallet could not do that."
- **New direct dependencies** of the worklet, already in its lockfile at these versions: `bip39` 3.1.0, `bare-crypto` 1.16.0, `bare-node-runtime` 1.5.5 (`bip39` is loaded through WDK's own Bare import map so `node:crypto` resolves to `bare-crypto`). The bundle still names the same 27 addons.

### Mac run under Bare 1.33.4 (bare-kit 0.16.0's runtime), real WDK and bare-crypto

`bare mac-check.mjs` from the scratch install:

| Check | Result |
| :---- | :---- |
| The BIP-39 test phrase ("abandon" x11 "about") at `m/44'/60'/0'/0/0` | `0x9858EfFD232B4033E47d90003D41EC34EcaEda94`, the well-known address: WDK gets the right seed bytes |
| `create` answer | only `address`, `chainId`, `path`, `sealed`, `words` |
| `reveal` then `restore` of the revealed words under another key, then `open` | all derive the created address |
| Timings | create 15 ms, open 13 ms, balance 0.8 s (network), sign 6 ms |
| Refusals | other chain `unsupported_network`, other payer `wrong_payer`, extra field `bad_input`, `getMnemonic` and `constructor` `unknown_method`, wrong key `unseal_failed`, bad checksum `bad_phrase` |
| Android pack (bare-pack 3.1.0 under Bare 1.38.0) | 3.67 MB bundle, the same 27 `linked:` addons as before |

### The Expo config plugin (Q111)

`apps/mobile/plugins/with-wallet-worklet.js`, listed in `app.json`. Expo runs a `withDangerousMod` action before the mods registered earlier, so a plain dangerous mod listed after QVAC's would run first and QVAC's `fsp.rm` would wipe it. The plugin is a base mod that runs the rest of the chain first and then `build.mjs`, which puts it after every other dangerous mod wherever it sits in the list (tested both ways in `plugins/wallet-worklet.test.mjs` with Expo's own mod code). It then checks the union: every file in the addon folder before its step is still there after it, or the prebuild fails, and it prints the libraries that now ship in two versions (Q110). `{ "skip": true }` or `HERMIT_SKIP_WALLET_WORKLET=1` leaves the wallet out of a build. The upstream bundler's own link step (in the fork) also empties the folder first, so if Hermit moves to the fork, its link must stay off and this plugin must keep running last.

### Phone checks for SL-38 (no APK can be built here)

1. `expo prebuild` prints "Hermit wallet: linked N addon files next to the M already there" (the wallet's 12 own or other-version addons per ABI; the 15 it shares with QVAC are already there) and the two-version list; the model still loads afterwards.
2. HM-PAY-01 from the chat menu: Create a wallet asks for a fingerprint (a strong biometric; the PIN must not be offered), then HM-PAY-02's backup flow. Show the words asks for a fingerprint again.
3. Screenshots and the Recents preview of HM-PAY-02 are black (FLAG_SECURE); long-pressing a word copies nothing; the keyboard on the check and restore fields shows no suggestions and Gboard's clipboard and history stay empty.
4. A wrong word in the check returns to the intro; the right three mark the wallet backed up; Back up never shows the words again.
5. `adb logcat` during create, reveal and restore: no word and no key hex in any line (`bare`, `ReactNativeJS` tags).
6. Restore on a second install (or after Delete everything) with the words from step 2: the preview shows the same address, the balance reads (0 for a fresh wallet), Use this wallet saves it; Not my wallet leaves nothing.
7. Enroll a new fingerprint in Android settings: HM-PAY-01 shows lost; restoring from the words brings it back.
8. Background Hermit on HM-PAY-02 while the words show: coming back shows the intro, not the words. The app lock does the same.
9. Delete everything with a wallet: the warning names the balance (or "an amount Hermit can't check right now" in airplane mode); afterwards HM-PAY-01 shows none and the old words restore the same address.
10. HM-SET-02 lists `rpc.testnet.stable.xyz` once a balance was read.
11. The SL-17 checks above (both worklets in one process, lifecycle, APK size, Hermes `TextDecoder`) still apply.
