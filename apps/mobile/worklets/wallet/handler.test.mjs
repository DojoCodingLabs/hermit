// SL-38: the wallet worklet's handler under Node, with Node's crypto standing in for bare-crypto and a fake WDK that
// records the seed it was given. The real WDK runs in mac-check.mjs under Bare.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { BIP39_ENGLISH } from '../../../../packages/core/src/bip39-english.ts'
import { createWalletHandler, METHODS, transferWithAuthorizationCalldata } from './handler.mjs'

const ABOUT = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
/** The BIP-39 seed of ABOUT with an empty passphrase (trezor vectors use "TREZOR"; this is the empty-passphrase one). */
const ABOUT_SEED = '5eb00bbddcf069084889a8ab9155568165f5c453ccb85e70811aaed6f6da5fc19a5ac40b389cd370d086206dec8aa6c43daea6690f20ad3d8d48b2d2ce9e38e4'
const KEY = 'ab'.repeat(32)
const OTHER_KEY = 'cd'.repeat(32)

function setup ({ random = crypto.randomBytes } = {}) {
  const seeds = []
  const disposed = []
  const reads = []
  const sent = []
  const quotes = []
  const receipts = new Map()
  class FakeWallet {
    constructor (seed, config) {
      assert.ok(seed instanceof Uint8Array, 'WDK gets the seed as bytes, never the phrase')
      assert.equal(config.provider, 'https://rpc.testnet.stable.xyz')
      this.seedHex = Buffer.from(seed).toString('hex')
      seeds.push(this.seedHex)
    }

    async getAccount (i) {
      const addr = '0x' + crypto.createHash('sha256').update(this.seedHex).digest('hex').slice(0, 40)
      return {
        path: `m/44'/60'/0'/0/${i}`,
        getAddress: async () => addr,
        signTypedData: async () => '0x' + '11'.repeat(65),
        sendTransaction: async (tx) => { sent.push(tx); return { hash: '0x' + 'ab'.repeat(32), fee: 1n } },
        getTransactionReceipt: async (hash) => receipts.get(hash) ?? null,
        dispose: () => disposed.push('account')
      }
    }

    dispose () { disposed.push('wallet') }
  }
  class FakeReadOnly {
    constructor (address, config) {
      reads.push([address, config.provider])
    }

    async getTokenBalance () { return 1500000n }
    async quoteTransfer (opts) { quotes.push(opts); return { fee: 21000000000000n } }
    async getBalance () { return 1500000000000000000n }
  }
  const handle = createWalletHandler({
    WalletManagerEvm: FakeWallet,
    WalletAccountReadOnlyEvm: FakeReadOnly,
    crypto: { ...crypto, randomBytes: random, createHash: crypto.createHash, createCipheriv: crypto.createCipheriv, createDecipheriv: crypto.createDecipheriv },
    wordlist: [...BIP39_ENGLISH],
    mnemonicToSeed: (phrase) => crypto.pbkdf2Sync(Buffer.from(phrase.normalize('NFKD')), Buffer.from('mnemonic'), 2048, 64, 'sha512')
  })
  let n = 0
  const call = async (method, params) => handle(JSON.stringify(params === undefined ? { id: ++n, method } : { id: ++n, method, params }))
  return { handle, call, seeds, disposed, reads, sent, quotes, receipts }
}

test('only the fixed methods (eight from SL-38, three from SL-40) exist; anything else, inherited names included, is unknown', async () => {
  const w = setup()
  assert.deepEqual([...METHODS].sort(), ['address', 'balance', 'close', 'create', 'open', 'quoteTransfer', 'restore', 'reveal', 'sendTransferWithAuthorization', 'signTransferWithAuthorization', 'transferReceipt'])
  for (const m of ['getMnemonic', 'exportSeed', 'privateKey', 'constructor', '__proto__', 'toString', 'hasOwnProperty', '', 42, null]) {
    assert.equal((await w.call(m)).error.code, 'unknown_method', String(m))
  }
  assert.equal((await w.handle('not json')).error.code, 'failed')
  assert.equal((await w.handle('[1]')).error.code, 'bad_request')
  assert.equal((await w.handle('{"method":"close"}')).error.code, 'bad_request')
  assert.equal((await w.handle('{"id":1,"method":"close","extra":1}')).error.code, 'bad_request')
})

test('every method takes exactly its parameters and refuses extra ones', async () => {
  const w = setup()
  const cases = [
    ['create', { id: 'w1', key: KEY, words: 12, phrase: ABOUT }],
    ['create', { id: 'w1', key: KEY }],
    ['restore', { id: 'w1', key: KEY, phrase: ABOUT, words: 12 }],
    ['open', { id: 'w1', key: KEY }],
    ['reveal', { id: 'w1', key: KEY, sealed: 'ab', export: true }],
    ['address', { all: true }],
    ['balance', {}],
    ['balance', { address: '0x' + '1'.repeat(40), token: '0x' + '2'.repeat(40) }],
    ['close', { force: true }],
    ['create', [1, 2]]
  ]
  for (const [m, p] of cases) assert.equal((await w.call(m, p)).error.code, 'bad_input', `${m} ${JSON.stringify(p)}`)
})

test('create draws the entropy from the CSPRNG, seals it and returns no words and no key', async () => {
  const draws = []
  const w = setup({ random: (n) => { draws.push(n); return crypto.randomBytes(n) } })
  const r = await w.call('create', { id: 'w1', key: KEY, words: 12 })
  assert.equal(r.ok, true)
  assert.deepEqual(Object.keys(r.result).sort(), ['address', 'chainId', 'path', 'sealed', 'words'])
  assert.equal(r.result.chainId, 2201)
  assert.equal(r.result.path, "m/44'/60'/0'/0/0")
  assert.equal(r.result.words, 12)
  // 16 bytes of entropy, then the 12-byte nonce: both from the injected CSPRNG.
  assert.deepEqual(draws, [16, 12])
  assert.match(r.result.sealed, /^[0-9a-f]{88}$/)
  // The values only: "address" is a field name and also a BIP-39 word.
  const text = JSON.stringify(Object.values(r.result))
  for (const word of BIP39_ENGLISH) assert.ok(!new RegExp(`\\b${word}\\b`).test(text), `a word (${word}) left the worklet`)
  assert.ok(!text.includes(KEY))
  // The wallet built to read the address is disposed at once: nothing stays open.
  assert.deepEqual(w.disposed, ['account', 'wallet'])
  assert.equal((await w.call('address')).error.code, 'not_open')
  // Two wallets never share a seed.
  const again = await w.call('create', { id: 'w2', key: KEY, words: 24 })
  assert.equal(again.result.words, 24)
  assert.notEqual(w.seeds[0], w.seeds[1])
})

test('reveal returns the same words a restore of them seals again, and the same address', async () => {
  const w = setup()
  const made = (await w.call('create', { id: 'w1', key: KEY, words: 12 })).result
  const shown = (await w.call('reveal', { id: 'w1', key: KEY, sealed: made.sealed })).result
  assert.equal(shown.words.length, 12)
  assert.equal(shown.address, made.address)
  const restored = (await w.call('restore', { id: 'w9', key: OTHER_KEY, phrase: shown.words.join(' ') })).result
  assert.equal(restored.address, made.address)
  assert.notEqual(restored.sealed, made.sealed)
})

test('restore derives the BIP-39 seed WDK gets, as bytes', async () => {
  const w = setup()
  const r = await w.call('restore', { id: 'w1', key: KEY, phrase: ABOUT })
  assert.equal(r.ok, true)
  assert.equal(w.seeds[0], ABOUT_SEED)
})

test('restore refuses a bad checksum, an unknown word, another count or casing, before any wallet is built', async () => {
  const w = setup()
  for (const phrase of [
    ABOUT.replace(/about$/, 'abandon'),
    ABOUT.replace(/about$/, 'abaut'),
    ABOUT.split(' ').slice(0, 11).join(' '),
    ABOUT.toUpperCase(),
    ABOUT.replace(' ', '  ')
  ]) {
    const r = await w.call('restore', { id: 'w1', key: KEY, phrase })
    assert.equal(r.error.code, 'bad_phrase', phrase)
    assert.ok(!JSON.stringify(r).includes('abandon'), 'the refusal never echoes the words')
  }
  assert.deepEqual(w.seeds, [])
})

test('a sealed seed opens only with its key and its wallet id', async () => {
  const w = setup()
  const made = (await w.call('create', { id: 'w1', key: KEY, words: 12 })).result
  assert.equal((await w.call('reveal', { id: 'w1', key: OTHER_KEY, sealed: made.sealed })).error.code, 'unseal_failed')
  assert.equal((await w.call('reveal', { id: 'w2', key: KEY, sealed: made.sealed })).error.code, 'unseal_failed')
  const flipped = made.sealed.slice(0, 40) + (made.sealed[40] === '0' ? '1' : '0') + made.sealed.slice(41)
  assert.equal((await w.call('reveal', { id: 'w1', key: KEY, sealed: flipped })).error.code, 'unseal_failed')
  assert.equal((await w.call('reveal', { id: 'w1', key: KEY, sealed: 'ab' })).error.code, 'bad_input')
  assert.equal((await w.call('create', { id: 'w1', key: KEY.toUpperCase(), words: 12 })).error.code, 'bad_input')
  assert.equal((await w.call('create', { id: 'w 1', key: KEY, words: 12 })).error.code, 'bad_input')
})

test('open keeps the account for signing until close; balance reads a public address with no key', async () => {
  const w = setup()
  const made = (await w.call('create', { id: 'w1', key: KEY, words: 12 })).result
  const opened = (await w.call('open', { id: 'w1', key: KEY, sealed: made.sealed })).result
  assert.deepEqual(opened, { address: made.address, path: "m/44'/60'/0'/0/0", chainId: 2201 })
  assert.equal((await w.call('address')).result.address, made.address)
  const bal = (await w.call('balance', { address: made.address })).result
  assert.deepEqual(bal, { usdt0: '1500000', native: '1500000000000000000' })
  assert.deepEqual(w.reads, [[made.address, 'https://rpc.testnet.stable.xyz']])
  assert.equal((await w.call('close')).result.closed, true)
  assert.equal((await w.call('address')).error.code, 'not_open')
})

test('signing stays Stable testnet USD₮0 only, from this wallet only', async () => {
  const w = setup()
  const made = (await w.call('create', { id: 'w1', key: KEY, words: 12 })).result
  await w.call('open', { id: 'w1', key: KEY, sealed: made.sealed })
  const domain = { name: 'USD₮0', version: '1', chainId: 2201, verifyingContract: '0x78Cf24370174180738C5B8E352B6D14c83a6c9A9' }
  const message = { from: made.address, to: '0x' + '2'.repeat(40), value: '1', validAfter: '0', validBefore: '9', nonce: '0x' + '00'.repeat(32) }
  assert.equal((await w.call('signTransferWithAuthorization', { domain, message })).ok, true)
  assert.equal((await w.call('signTransferWithAuthorization', { domain: { ...domain, chainId: 988 }, message })).error.code, 'unsupported_network')
  assert.equal((await w.call('signTransferWithAuthorization', { domain: { ...domain, name: 'USDC' }, message })).error.code, 'unsupported_asset')
  assert.equal((await w.call('signTransferWithAuthorization', { domain, message: { ...message, from: '0x' + '3'.repeat(40) } })).error.code, 'wrong_payer')
})

// SL-40: paying a person. A fee estimate with no key, then submitting one signed USD₮0 authorization from this wallet.
const DOMAIN = { name: 'USD₮0', version: '1', chainId: 2201, verifyingContract: '0x78Cf24370174180738C5B8E352B6D14c83a6c9A9' }
const SIG = '0x' + '11'.repeat(32) + '22'.repeat(32) + '1b'
const later = () => String(Math.floor(Date.now() / 1000) + 300)

test('the fee quote is for a public address, a USD₮0 transfer, with no key', async () => {
  const w = setup()
  const r = await w.call('quoteTransfer', { from: '0x' + '1'.repeat(40), to: '0x' + '2'.repeat(40), value: '5000000' })
  assert.deepEqual(r.result, { fee: '21000000000000' })
  assert.deepEqual(w.quotes, [{ token: DOMAIN.verifyingContract, recipient: '0x' + '2'.repeat(40), amount: 5000000n }])
  assert.equal((await w.call('quoteTransfer', { from: '0x' + '1'.repeat(40), to: '0x' + '2'.repeat(40), value: '0' })).error.code, 'bad_input')
  assert.equal((await w.call('quoteTransfer', { from: 'me', to: '0x' + '2'.repeat(40), value: '1' })).error.code, 'bad_input')
})

test('send submits exactly transferWithAuthorization to the USD₮0 contract, from this wallet, before it expires', async () => {
  const w = setup()
  const made = (await w.call('create', { id: 'w1', key: KEY, words: 12 })).result
  const message = { from: made.address, to: '0x' + '2'.repeat(40), value: '5000000', validAfter: '0', validBefore: later(), nonce: '0x' + '09'.repeat(32) }
  assert.equal((await w.call('sendTransferWithAuthorization', { domain: DOMAIN, message, signature: SIG })).error.code, 'not_open')
  await w.call('open', { id: 'w1', key: KEY, sealed: made.sealed })
  const r = await w.call('sendTransferWithAuthorization', { domain: DOMAIN, message, signature: SIG })
  assert.deepEqual(r.result, { hash: '0x' + 'ab'.repeat(32) })
  assert.equal(w.sent.length, 1)
  assert.equal(w.sent[0].to, DOMAIN.verifyingContract)
  assert.equal(w.sent[0].value, 0n)
  assert.equal(w.sent[0].data, transferWithAuthorizationCalldata(message, SIG))
})

test('the calldata is byte for byte what packages/payments encodes for the same authorization', () => {
  // Made with transferWithAuthorizationCalldata from packages/payments/src/transfer.ts (its test checks the selector).
  const app = '0xe3ee160e' + [
    '5'.repeat(40), '2'.repeat(40), '4c4b40', '0', '6553f22c', '09'.repeat(32), '1b', '11'.repeat(32), '22'.repeat(32)
  ].map((h) => h.padStart(64, '0')).join('')
  const message = { from: '0x' + '5'.repeat(40), to: '0x' + '2'.repeat(40), value: '5000000', validAfter: '0', validBefore: '1700000300', nonce: '0x' + '09'.repeat(32) }
  assert.equal(transferWithAuthorizationCalldata(message, SIG), app)
})

test('send refuses another chain, another token, another payer, paying itself, zero, an expired or a malformed signature', async () => {
  const w = setup()
  const made = (await w.call('create', { id: 'w1', key: KEY, words: 12 })).result
  await w.call('open', { id: 'w1', key: KEY, sealed: made.sealed })
  const message = { from: made.address, to: '0x' + '2'.repeat(40), value: '5', validAfter: '0', validBefore: later(), nonce: '0x' + '09'.repeat(32) }
  const send = async (over) => (await w.call('sendTransferWithAuthorization', { domain: DOMAIN, message, signature: SIG, ...over })).error?.code
  assert.equal(await send({ domain: { ...DOMAIN, chainId: 988 } }), 'unsupported_network')
  assert.equal(await send({ domain: { ...DOMAIN, verifyingContract: '0x' + '4'.repeat(40) } }), 'unsupported_asset')
  assert.equal(await send({ message: { ...message, from: '0x' + '3'.repeat(40) } }), 'wrong_payer')
  assert.equal(await send({ message: { ...message, to: made.address } }), 'bad_input')
  assert.equal(await send({ message: { ...message, value: '0' } }), 'bad_input')
  assert.equal(await send({ message: { ...message, validBefore: '9' } }), 'expired')
  assert.equal(await send({ signature: '0x1234' }), 'bad_input')
  assert.equal(await send({ signature: SIG.slice(0, -2) + '05' }), 'bad_input')
  assert.equal(await send({ extra: 1 }), 'bad_input')
  assert.equal(w.sent.length, 0)
})

test('the receipt says pending until mined, then success or reverted', async () => {
  const w = setup()
  const made = (await w.call('create', { id: 'w1', key: KEY, words: 12 })).result
  await w.call('open', { id: 'w1', key: KEY, sealed: made.sealed })
  const hash = '0x' + 'ab'.repeat(32)
  assert.deepEqual((await w.call('transferReceipt', { hash })).result, { status: 'pending' })
  w.receipts.set(hash, { status: 1 })
  assert.deepEqual((await w.call('transferReceipt', { hash })).result, { status: 'success' })
  w.receipts.set(hash, { status: 0 })
  assert.deepEqual((await w.call('transferReceipt', { hash })).result, { status: 'reverted' })
  assert.equal((await w.call('transferReceipt', { hash: '0x12' })).error.code, 'bad_input')
})
