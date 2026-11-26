// Wallet worklet entry (SL-17, SL-38). Packed with bare-pack (by the Expo config plugin at prebuild, or build.mjs as
// the fallback) and started by the app's wallet adapter in its own react-native-bare-kit Worklet, next to QVAC's.
// Newline-delimited JSON over IPC. The CSPRNG and AES-256-GCM are bare-crypto's (BoringSSL in the addon).
/* global BareKit */
import WalletManagerEvm, { WalletAccountReadOnlyEvm } from '@tetherto/wdk-wallet-evm'
// bip39 (and the @noble/hashes it uses) expect Node's built-ins: load it through the same import map WDK's own Bare
// entry uses, so `node:crypto` resolves to bare-crypto.
import bip39 from 'bip39' with { imports: 'bare-node-runtime/imports' }
import crypto from 'bare-crypto'
import { createLineSplitter, createWalletHandler } from './handler.mjs'

const handle = createWalletHandler({
  WalletManagerEvm,
  WalletAccountReadOnlyEvm,
  crypto,
  wordlist: bip39.wordlists.english,
  mnemonicToSeed: (phrase) => bip39.mnemonicToSeedSync(phrase)
})
const split = createLineSplitter()
const { IPC } = BareKit

IPC.on('data', (chunk) => {
  for (const line of split(chunk)) {
    handle(line).then((response) => IPC.write(Buffer.from(JSON.stringify(response) + '\n')))
  }
})
