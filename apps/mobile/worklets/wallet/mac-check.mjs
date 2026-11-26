// Mac check for the wallet worklet (SL-17, SL-38). Run it from build.mjs's scratch dir (it has the pinned node_modules)
// with the Bare runtime that react-native-bare-kit 0.16.0 embeds, Bare 1.33.4 (`npm pack bare-runtime-darwin-arm64@1.33.4`,
// unpack, chmod +x package/bin/bare), not Node:
//   bare mac-check.mjs                    drives handler.mjs directly
//   bare mac-check.mjs <bundle>           drives a bundle packed for the Mac (bare-pack --host darwin-arm64
//                                         --offload-addons) through a stand-in for BareKit.IPC
// Prints one JSON line: runtime, the BIP-39 vector's address, create, reveal and restore round trips with bare-crypto,
// balances, the signed test authorization and the refusals. Keys are throwaway constants; no phrase is printed.
/* global Bare */
const bundlePath = Bare.argv[2]

const responses = new Map()
let deliver = null
const fakeIPC = {
  on (event, cb) {
    if (event === 'data') deliver = cb
  },
  write (bytes) {
    for (const line of Buffer.from(bytes).toString('utf8').split('\n')) {
      if (line) {
        const res = JSON.parse(line)
        responses.get(res.id)?.(res)
      }
    }
  }
}

let send
if (bundlePath) {
  globalThis.BareKit = { IPC: fakeIPC }
  await import(bundlePath.startsWith('/') ? 'file://' + bundlePath : new URL(bundlePath, 'file://' + Bare.argv[1]).href)
  send = (bytes) => deliver(bytes)
} else {
  const { default: WalletManagerEvm, WalletAccountReadOnlyEvm } = await import('@tetherto/wdk-wallet-evm')
  const { default: bip39 } = await import('bip39', { with: { imports: 'bare-node-runtime/imports' } })
  const { default: crypto } = await import('bare-crypto')
  const { createWalletHandler, createLineSplitter } = await import('./handler.mjs')
  const handle = createWalletHandler({ WalletManagerEvm, WalletAccountReadOnlyEvm, crypto, wordlist: bip39.wordlists.english, mnemonicToSeed: (p) => bip39.mnemonicToSeedSync(p) })
  const split = createLineSplitter()
  send = (bytes) => {
    for (const line of split(bytes)) handle(line).then((r) => fakeIPC.write(Buffer.from(JSON.stringify(r) + '\n')))
  }
}

let nextId = 1
function call (method, params) {
  const id = nextId++
  return new Promise((resolve) => {
    responses.set(id, resolve)
    const bytes = Buffer.from(JSON.stringify(params === undefined ? { id, method } : { id, method, params }) + '\n')
    // Split every request mid-way (inside the ₮ when there is one) to prove the framing.
    const cut = bytes.indexOf(0xe2) > 0 ? bytes.indexOf(0xe2) + 1 : bytes.length >> 1
    send(bytes.subarray(0, cut))
    send(bytes.subarray(cut))
  })
}

const KEY = 'ab'.repeat(32)
const ABOUT = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const USDT0 = '0x78Cf24370174180738C5B8E352B6D14c83a6c9A9'

// The well-known address of the BIP-39 test phrase at m/44'/60'/0'/0/0: proves WDK gets the right seed bytes.
const vector = await call('restore', { id: 'vector', key: KEY, phrase: ABOUT })

const t0 = Date.now()
const created = await call('create', { id: 'mac-check', key: KEY, words: 12 })
const tCreate = Date.now() - t0
const revealed = await call('reveal', { id: 'mac-check', key: KEY, sealed: created.result.sealed })
const restored = await call('restore', { id: 'again', key: 'cd'.repeat(32), phrase: revealed.result.words.join(' ') })
const t1 = Date.now()
const opened = await call('open', { id: 'mac-check', key: KEY, sealed: created.result.sealed })
const tOpen = Date.now() - t1
const t2 = Date.now()
const balance = await call('balance', { address: opened.result.address })
const tBalance = Date.now() - t2
const typedData = {
  domain: { name: 'USD₮0', version: '1', chainId: 2201, verifyingContract: USDT0 },
  primaryType: 'TransferWithAuthorization',
  message: {
    from: opened.result.address,
    to: '0x209693Bc6afc0C5328bA36FaF03C514EF312287C',
    value: '10000',
    validAfter: '0',
    validBefore: '1800000000',
    nonce: '0x' + '00'.repeat(31) + '2a'
  }
}
const t3 = Date.now()
const signed = await call('signTransferWithAuthorization', { domain: typedData.domain, message: typedData.message })
const tSign = Date.now() - t3
const refusals = {
  otherChain: (await call('signTransferWithAuthorization', { domain: { ...typedData.domain, chainId: 988 }, message: typedData.message })).error?.code,
  otherPayer: (await call('signTransferWithAuthorization', { domain: typedData.domain, message: { ...typedData.message, from: '0x209693Bc6afc0C5328bA36FaF03C514EF312287C' } })).error?.code,
  extraField: (await call('signTransferWithAuthorization', { domain: typedData.domain, message: { ...typedData.message, extra: '1' } })).error?.code,
  exportSeed: (await call('getMnemonic')).error?.code,
  prototypeKey: (await call('constructor')).error?.code,
  wrongKey: (await call('reveal', { id: 'mac-check', key: 'cd'.repeat(32), sealed: created.result.sealed })).error?.code,
  badChecksum: (await call('restore', { id: 'x', key: KEY, phrase: ABOUT.replace(/about$/, 'abandon') })).error?.code
}
await call('close')

console.log(JSON.stringify({
  runtime: 'bare ' + Bare.version,
  mode: bundlePath ? 'bundle' : 'source',
  vectorAddress: vector.result?.address ?? vector.error,
  vectorOk: vector.result?.address === '0x9858EfFD232B4033E47d90003D41EC34EcaEda94',
  createdKeys: Object.keys(created.result ?? {}).sort(),
  revealedWords: revealed.result?.words.length,
  revealMatches: revealed.result?.address === created.result?.address,
  restoreMatches: restored.result?.address === created.result?.address,
  openMatches: opened.result?.address === created.result?.address,
  path: opened.result?.path,
  balance: balance.ok ? balance.result : balance.error,
  ms: { create: tCreate, open: tOpen, balance: tBalance, sign: tSign },
  address: opened.result?.address,
  signature: signed.result?.signature ?? signed.error,
  refusals
}))
