// The wallet worklet's request handler (SL-17 spike, SL-38; docs/research/wdk-worklet-spike.md).
// Runs inside Bare: in react-native-bare-kit on the phone, and under the Bare CLI on the Mac; its tests run it under
// Node with Node's crypto (handler.test.mjs). Stable testnet only, USD₮0 only.
//
// Eleven fixed methods (eight from SL-38, three from SL-40 to pay a person), each with exact parameters; anything else is refused. The seed is made here from the
// CSPRNG (`crypto.randomBytes`), sealed here under the wallet key the app unwrapped from the Keystore (AES-256-GCM,
// bound to the wallet id), and never returned, logged or written: the app gets the sealed blob and the public address.
// The one exception is `reveal`, which the backup screen calls behind a fresh fingerprint and which returns the words.
// No method returns a key. The app checks every answer and every signature again on its side (packages/payments).

export const STABLE_TESTNET = Object.freeze({
  chainId: 2201,
  rpc: 'https://rpc.testnet.stable.xyz',
  usdt0: '0x78Cf24370174180738C5B8E352B6D14c83a6c9A9',
  name: 'USD₮0',
  version: '1',
  path: "m/44'/60'/0'/0/0"
})

export const METHODS = Object.freeze([
  'create', 'restore', 'open', 'reveal', 'address', 'balance', 'signTransferWithAuthorization', 'close',
  // SL-40: paying a person.
  'quoteTransfer', 'sendTransferWithAuthorization', 'transferReceipt'
])

/** `transferWithAuthorization(address,address,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32)` (EIP-3009). */
export const TRANSFER_WITH_AUTHORIZATION_SELECTOR = '0xe3ee160e'

/** The ABI-encoded call for a signed authorization; the same bytes packages/payments encodes (checked in the tests). */
export function transferWithAuthorizationCalldata (m, signature) {
  const word = (hex) => hex.toLowerCase().padStart(64, '0')
  const v = parseInt(signature.slice(130), 16)
  if (v !== 27 && v !== 28) throw new Refusal('bad_input', 'Unexpected recovery id.')
  return TRANSFER_WITH_AUTHORIZATION_SELECTOR + [
    word(m.from.slice(2)), word(m.to.slice(2)), word(BigInt(m.value).toString(16)), word(BigInt(m.validAfter).toString(16)),
    word(BigInt(m.validBefore).toString(16)), word(m.nonce.slice(2)), word(v.toString(16)), word(signature.slice(2, 66)), word(signature.slice(66, 130))
  ].join('')
}

const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' }
  ]
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/
const UINT = /^(0|[1-9][0-9]{0,77})$/
const BYTES32 = /^0x[0-9a-fA-F]{64}$/
const KEY_HEX = /^[0-9a-f]{64}$/
const WALLET_ID = /^[A-Za-z0-9-]{1,64}$/
const SEALED_HEX = /^[0-9a-f]+$/

class Refusal extends Error {
  constructor (code, message) {
    super(message)
    this.code = code
  }
}

function sameAddress (a, b) {
  return typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase()
}

function exactKeys (obj, keys) {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return false
  const got = Object.keys(obj).sort()
  const want = [...keys].sort()
  return got.length === want.length && got.every((k, i) => k === want[i])
}

function params (p, keys) {
  if (!exactKeys(p, keys)) throw new Refusal('bad_input', `Expected exactly { ${keys.join(', ')} }.`)
  return p
}

function checkTypedData (p, network, address) {
  const { domain, message } = params(p, ['domain', 'message'])
  if (!exactKeys(domain, ['name', 'version', 'chainId', 'verifyingContract'])) throw new Refusal('bad_input', 'Unexpected domain fields.')
  if (domain.chainId !== network.chainId) throw new Refusal('unsupported_network', 'Only Stable testnet is signed here.')
  if (!sameAddress(domain.verifyingContract, network.usdt0) || domain.name !== network.name || domain.version !== network.version) {
    throw new Refusal('unsupported_asset', 'Only USD₮0 on Stable testnet is signed here.')
  }
  if (!exactKeys(message, ['from', 'to', 'value', 'validAfter', 'validBefore', 'nonce'])) throw new Refusal('bad_input', 'Unexpected message fields.')
  if (!sameAddress(message.from, address)) throw new Refusal('wrong_payer', 'The authorization is not from this wallet.')
  if (!ADDRESS.test(message.to)) throw new Refusal('bad_input', 'The payee is not an address.')
  for (const k of ['value', 'validAfter', 'validBefore']) {
    if (typeof message[k] !== 'string' || !UINT.test(message[k])) throw new Refusal('bad_input', `${k} must be a decimal string.`)
  }
  if (typeof message.nonce !== 'string' || !BYTES32.test(message.nonce)) throw new Refusal('bad_input', 'nonce must be 32 bytes of hex.')
  return { domain, message }
}

/**
 * BIP-39 over an injected English wordlist and SHA-256, so the words are made from entropy this file drew itself and
 * a restored phrase is checked here too. The app checks the same rules (packages/core/src/wallet.ts); both pass the
 * published vectors.
 */
export function createBip39 ({ wordlist, sha256 }) {
  if (!Array.isArray(wordlist) || wordlist.length !== 2048) throw new Error('The BIP-39 wordlist must have 2048 words.')
  const index = new Map(wordlist.map((w, i) => [w, i]))
  const toWords = (entropy) => {
    if (entropy.length !== 16 && entropy.length !== 32) throw new Refusal('bad_input', 'Entropy is 16 or 32 bytes.')
    let bits = ''
    for (const b of entropy) bits += b.toString(2).padStart(8, '0')
    bits += sha256(entropy)[0].toString(2).padStart(8, '0').slice(0, entropy.length / 4)
    const words = []
    for (let i = 0; i < bits.length; i += 11) words.push(wordlist[parseInt(bits.slice(i, i + 11), 2)])
    return words
  }
  const toEntropy = (words) => {
    if (words.length !== 12 && words.length !== 24) return null
    let bits = ''
    for (const w of words) {
      const i = index.get(w)
      if (i === undefined) return null
      bits += i.toString(2).padStart(11, '0')
    }
    const entropy = new Uint8Array((bits.length - words.length / 3) / 8)
    for (let i = 0; i < entropy.length; i++) entropy[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2)
    const again = toWords(entropy)
    if (!again.every((w, i) => w === words[i])) {
      entropy.fill(0)
      return null
    }
    return entropy
  }
  return { toWords, toEntropy }
}

/**
 * Returns `handle(line) -> response object`. Everything platform-specific is injected so the phone, the Mac check and
 * the Node tests run the same code:
 * - `WalletManagerEvm`, `WalletAccountReadOnlyEvm`: Tether WDK.
 * - `crypto`: `randomBytes`, `createHash`, `createCipheriv`, `createDecipheriv` (bare-crypto on the phone, node:crypto in tests).
 * - `wordlist`: the BIP-39 English list; `mnemonicToSeed(phrase) -> Uint8Array(64)`: BIP-39's PBKDF2 (the `bip39` package).
 */
export function createWalletHandler ({ WalletManagerEvm, WalletAccountReadOnlyEvm, crypto, wordlist, mnemonicToSeed, network = STABLE_TESTNET }) {
  const bip39 = createBip39({ wordlist, sha256: (b) => crypto.createHash('sha256').update(b).digest() })
  let wallet = null
  let account = null
  let address = null

  const aad = (id) => Buffer.from(`hermit.wallet.seed.v1\u0000${id}`, 'utf8')

  function walletId (id) {
    if (typeof id !== 'string' || !WALLET_ID.test(id)) throw new Refusal('bad_input', 'A wallet id is 1 to 64 letters, digits or dashes.')
    return id
  }

  function keyOf (hex) {
    if (typeof hex !== 'string' || !KEY_HEX.test(hex)) throw new Refusal('bad_input', 'The key is 32 bytes of lowercase hex.')
    return Buffer.from(hex, 'hex')
  }

  /** iv(12) ‖ AES-256-GCM(entropy) ‖ tag(16), as lowercase hex. */
  function seal (key, entropy, id) {
    const iv = crypto.randomBytes(12)
    const c = crypto.createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 })
    c.setAAD(aad(id))
    const body = Buffer.concat([c.update(entropy), c.final()])
    return Buffer.concat([iv, body, c.getAuthTag()]).toString('hex')
  }

  function unseal (key, sealed, id) {
    if (typeof sealed !== 'string' || !SEALED_HEX.test(sealed) || (sealed.length !== 2 * (12 + 16 + 16) && sealed.length !== 2 * (12 + 16 + 32))) {
      throw new Refusal('bad_input', 'The sealed seed is malformed.')
    }
    const bytes = Buffer.from(sealed, 'hex')
    try {
      const d = crypto.createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12), { authTagLength: 16 })
      d.setAAD(aad(id))
      d.setAuthTag(bytes.subarray(bytes.length - 16))
      return new Uint8Array(Buffer.concat([d.update(bytes.subarray(12, bytes.length - 16)), d.final()]))
    } catch {
      // Wrong key, another wallet's blob, or a changed byte: nothing opens.
      throw new Refusal('unseal_failed', 'The sealed seed does not open with this key.')
    }
  }

  /** Builds the WDK wallet from the entropy's BIP-39 seed (bytes, not the phrase); zeroes the seed it made. */
  async function derive (entropy) {
    const seed = mnemonicToSeed(bip39.toWords(entropy).join(' '))
    try {
      const w = new WalletManagerEvm(new Uint8Array(seed), { provider: network.rpc })
      const a = await w.getAccount(0)
      const addr = await a.getAddress()
      if (a.path !== network.path) throw new Refusal('failed', 'Unexpected derivation path.')
      return { w, a, addr }
    } finally {
      seed.fill(0)
    }
  }

  function dispose (w, a) {
    try { a?.dispose() } catch {}
    try { w?.dispose() } catch {}
  }

  async function sealNew (id, key, entropy) {
    const { w, a, addr } = await derive(entropy)
    dispose(w, a)
    return { sealed: seal(key, entropy, id), address: addr, path: network.path, chainId: network.chainId, words: entropy.length === 16 ? 12 : 24 }
  }

  function needOpen () {
    if (!account) throw new Refusal('not_open', 'Open the wallet first.')
  }

  const methods = {
    // US-PAY-01: a new seed from the CSPRNG. Only the sealed blob and the address leave.
    async create (p) {
      const { id, key: hex, words } = params(p, ['id', 'key', 'words'])
      walletId(id)
      if (words !== 12 && words !== 24) throw new Refusal('bad_input', 'A new wallet has 12 or 24 words.')
      const key = keyOf(hex)
      const entropy = crypto.randomBytes(words === 12 ? 16 : 32)
      try {
        return await sealNew(id, key, entropy)
      } finally {
        entropy.fill(0)
        key.fill(0)
      }
    },
    // US-PAY-02: the user's words, checked (12 or 24 English words, BIP-39 checksum), sealed like a new seed.
    async restore (p) {
      const { id, key: hex, phrase } = params(p, ['id', 'key', 'phrase'])
      walletId(id)
      if (typeof phrase !== 'string' || phrase.length > 300) throw new Refusal('bad_input', 'The phrase is a string.')
      const words = phrase.split(' ')
      const entropy = bip39.toEntropy(words)
      if (!entropy) throw new Refusal('bad_phrase', 'Not a valid 12 or 24 word English recovery phrase.')
      const key = keyOf(hex)
      try {
        return await sealNew(id, key, entropy)
      } finally {
        entropy.fill(0)
        key.fill(0)
      }
    },
    // SL-41: unseals and keeps the account for signing, until `close`.
    async open (p) {
      const { id, key: hex, sealed } = params(p, ['id', 'key', 'sealed'])
      walletId(id)
      const key = keyOf(hex)
      let entropy = null
      try {
        entropy = unseal(key, sealed, id)
        await methods.close()
        const { w, a, addr } = await derive(entropy)
        wallet = w
        account = a
        address = addr
        return { address, path: network.path, chainId: network.chainId }
      } finally {
        entropy?.fill(0)
        key.fill(0)
      }
    },
    // The backup screen only (HM-PAY-02), behind a fresh fingerprint: the words and the address they derive.
    async reveal (p) {
      const { id, key: hex, sealed } = params(p, ['id', 'key', 'sealed'])
      walletId(id)
      const key = keyOf(hex)
      let entropy = null
      try {
        entropy = unseal(key, sealed, id)
        const { w, a, addr } = await derive(entropy)
        dispose(w, a)
        return { words: bip39.toWords(entropy), address: addr }
      } finally {
        entropy?.fill(0)
        key.fill(0)
      }
    },
    async address (p) {
      params(p, [])
      needOpen()
      return { address, path: network.path, chainId: network.chainId }
    },
    // A public address's balances, read with no key: HM-PAY-01 and the restore preview never unseal anything.
    async balance (p) {
      const { address: who } = params(p, ['address'])
      if (typeof who !== 'string' || !ADDRESS.test(who)) throw new Refusal('bad_input', 'Not an address.')
      const ro = new WalletAccountReadOnlyEvm(who, { provider: network.rpc })
      const [usdt0, native] = await Promise.all([ro.getTokenBalance(network.usdt0), ro.getBalance()])
      return { usdt0: String(usdt0), native: String(native) }
    },
    async signTransferWithAuthorization (p) {
      needOpen()
      const { domain, message } = checkTypedData(p, network, address)
      const signature = await account.signTypedData({ domain, types: TRANSFER_WITH_AUTHORIZATION_TYPES, message })
      return { signature }
    },
    // SL-40: HM-APPR-02's fee estimate, for a public address with no key: a USD₮0 transfer of the same value.
    async quoteTransfer (p) {
      const { from, to, value } = params(p, ['from', 'to', 'value'])
      if (!ADDRESS.test(from) || !ADDRESS.test(to)) throw new Refusal('bad_input', 'Not an address.')
      if (typeof value !== 'string' || !UINT.test(value) || value === '0') throw new Refusal('bad_input', 'value must be a positive decimal string.')
      const ro = new WalletAccountReadOnlyEvm(from, { provider: network.rpc })
      const { fee } = await ro.quoteTransfer({ token: network.usdt0, recipient: to, amount: BigInt(value) })
      return { fee: String(fee) }
    },
    // SL-40: submits a signed USD₮0 authorization from this wallet, to the USD₮0 contract only, and nothing else. The
    // app recovered the signature already; the struct, the payer, the chain and the expiry are checked again here.
    async sendTransferWithAuthorization (p) {
      needOpen()
      const { signature, ...typed } = params(p, ['domain', 'message', 'signature'])
      const { message } = checkTypedData(typed, network, address)
      if (typeof signature !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(signature)) throw new Refusal('bad_input', 'A signature is 65 bytes of hex.')
      if (message.value === '0' || sameAddress(message.to, address)) throw new Refusal('bad_input', 'Not a payment to someone else.')
      if (Number(message.validBefore) <= Math.floor(Date.now() / 1000)) throw new Refusal('expired', 'The authorization has expired.')
      const data = transferWithAuthorizationCalldata(message, signature)
      const { hash } = await account.sendTransaction({ to: network.usdt0, value: 0n, data })
      if (typeof hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Refusal('failed', 'No transaction hash.')
      return { hash }
    },
    // SL-40: how a submitted transaction ended. Pending until it is mined.
    async transferReceipt (p) {
      needOpen()
      const { hash } = params(p, ['hash'])
      if (typeof hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Refusal('bad_input', 'Not a transaction hash.')
      const receipt = await account.getTransactionReceipt(hash)
      if (!receipt) return { status: 'pending' }
      return { status: receipt.status === 1 || receipt.status === 1n ? 'success' : 'reverted' }
    },
    async close (p = {}) {
      params(p, [])
      dispose(wallet, account)
      wallet = account = address = null
      return { closed: true }
    }
  }

  return async function handle (line) {
    let id = null
    try {
      const req = JSON.parse(line)
      if (req === null || typeof req !== 'object' || Array.isArray(req) || !Number.isSafeInteger(req.id)) throw new Refusal('bad_request', 'A request needs an integer id.')
      id = req.id
      if (Object.keys(req).some((k) => k !== 'id' && k !== 'method' && k !== 'params')) throw new Refusal('bad_request', 'Unexpected request fields.')
      const method = typeof req.method === 'string' && METHODS.includes(req.method) ? methods[req.method] : null
      if (!method) throw new Refusal('unknown_method', 'Unknown method.')
      return { id, ok: true, result: await method(req.params ?? {}) }
    } catch (err) {
      const code = err instanceof Refusal ? err.code : 'failed'
      // Only a Refusal's own message goes back. Anything else (a provider error) is reduced to its code, so nothing
      // that passed through here, a phrase included, can ride back in an error text.
      const message = err instanceof Refusal ? err.message : 'The wallet could not do that.'
      return { id, ok: false, error: { code, message } }
    }
  }
}

/** Splits a byte stream into newline-terminated UTF-8 lines; keeps a partial line (or a split ₮) for the next chunk. */
export function createLineSplitter () {
  let pending = Buffer.alloc(0)
  return function split (chunk) {
    pending = pending.length === 0 ? Buffer.from(chunk) : Buffer.concat([pending, Buffer.from(chunk)])
    const lines = []
    let nl
    while ((nl = pending.indexOf(0x0a)) !== -1) {
      const line = pending.subarray(0, nl).toString('utf8')
      pending = pending.subarray(nl + 1)
      if (line.length > 0) lines.push(line)
    }
    return lines
  }
}
