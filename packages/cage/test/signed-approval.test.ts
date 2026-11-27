import { describe, expect, test } from "vitest";
import { p256 } from "@noble/curves/nist.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { nodeSql } from "@hermit/sql-node";
import { APPROVAL_KEY_ENROLL_DOMAIN, migrate, money, SIGNED_APPROVAL_DOMAIN, type ApprovalKeyState, type SignedApprovalTerms } from "@hermit/core";
import {
  buildSignedApproval, createNonceStore, createSignedApprovals, enrollmentMessage, memoryNonceStore, publicKeyFromSpki, signedApprovalHash,
  signedApprovalMessage, spkiFromPublicKey, verifyEnrollment, verifySignedApproval, SIGNED_APPROVAL_MAX_TTL_MS,
} from "../src/signed-approval.ts";

// A software P-256 key stands in for the Keystore key: same curve, same SHA256withECDSA, same DER signatures.
const sk = p256.utils.randomSecretKey(new Uint8Array(48).fill(7));
const pub = p256.getPublicKey(sk, false);
const spki = spkiFromPublicKey(pub);
const otherSk = p256.utils.randomSecretKey(new Uint8Array(48).fill(9));
const otherSpki = spkiFromPublicKey(p256.getPublicKey(otherSk, false));
/** What the native module does: SHA256withECDSA over the UTF-8 message, DER encoded, any S (Keystore isn't low-S). */
const keystoreSign = (message: string, key = sk) => bytesToHex(p256.sign(utf8ToBytes(message), key, { prehash: true, format: "der", lowS: false }));

const NOW = 1_800_000_000_000;
const NONCE = "ab".repeat(32);
const RECIPIENT = "0x1111111111111111111111111111111111111111";
const spendTerms = (over: Partial<SignedApprovalTerms> = {}): SignedApprovalTerms => ({ amount: money(5_000_000n, "USDT", "stable-testnet"), recipient: RECIPIENT, ...over });
const base = { risk: "spend" as const, skill: "pay", requestId: "req-1", argsHash: "c".repeat(64), nonce: NONCE, now: NOW, expiresAt: NOW + 120_000 };
const expected = (terms = spendTerms()) => ({ risk: "spend" as const, skill: "pay", requestId: "req-1", argsHash: "c".repeat(64), terms });

const built = (terms = spendTerms()) => {
  const r = buildSignedApproval({ ...base, terms });
  if (!r.ok) throw new Error(r.reason);
  return r.request;
};

describe("the canonical, domain-separated approval payload", () => {
  test("binds the skill, the args hash, the amount in USD₮ base units, the recipient, a nonce and the expiry", () => {
    const { payload, message } = built();
    expect(payload).toEqual({
      domain: SIGNED_APPROVAL_DOMAIN, v: 1, risk: "spend", skill: "pay", requestId: "req-1", argsHash: "c".repeat(64), nonce: NONCE,
      issuedAt: NOW, expiresAt: NOW + 120_000, amount: { value: "5000000", asset: "USDT", network: "stable-testnet" }, recipient: RECIPIENT,
    });
    // The domain is its own first line, then canonical JSON: key order can never change what is signed.
    expect(message.startsWith(`${SIGNED_APPROVAL_DOMAIN}\n{`)).toBe(true);
    expect(message).toBe(signedApprovalMessage(payload));
    expect(signedApprovalHash(message)).toMatch(/^[0-9a-f]{64}$/);
  });

  test("a non-USD₮ asset is refused before anything is asked (PDR-027)", () => {
    expect(buildSignedApproval({ ...base, terms: spendTerms({ amount: money(5_000_000n, "USDC", "base-sepolia") }) })).toEqual({ ok: false, reason: "not_usdt" });
    expect(buildSignedApproval({ ...base, terms: spendTerms({ amount: money(1n, "ETH", "sepolia") }) })).toEqual({ ok: false, reason: "not_usdt" });
  });

  test("a payment needs a positive amount and a recipient; a password needs its site", () => {
    expect(buildSignedApproval({ ...base, terms: { recipient: RECIPIENT } })).toEqual({ ok: false, reason: "no_amount" });
    expect(buildSignedApproval({ ...base, terms: spendTerms({ amount: money(0n, "USDT", "stable-testnet") }) })).toEqual({ ok: false, reason: "no_amount" });
    expect(buildSignedApproval({ ...base, terms: { amount: money(1n, "USDT", "stable-testnet") } })).toEqual({ ok: false, reason: "no_recipient" });
    expect(buildSignedApproval({ ...base, risk: "credential", terms: {} })).toEqual({ ok: false, reason: "no_origin" });
    const cred = buildSignedApproval({ ...base, risk: "credential", skill: "fill_password", terms: { origin: "https://bank.example" } });
    expect(cred.ok && cred.request.payload).toMatchObject({ risk: "credential", origin: "https://bank.example" });
    expect(cred.ok && "amount" in cred.request.payload).toBe(false);
  });

  test("a recipient, site or network with hidden characters (bidi overrides, newlines, zero-width) is refused", () => {
    for (const recipient of ["0x1111‮2222", "0x1111⁦2222⁩", "0x1111\nAmount: 1", "0x11​11", " "]) {
      expect(buildSignedApproval({ ...base, terms: spendTerms({ recipient }) })).toEqual({ ok: false, reason: "bad_text" });
    }
    expect(buildSignedApproval({ ...base, risk: "credential", terms: { origin: "https://bank.example‮" } })).toEqual({ ok: false, reason: "bad_text" });
    expect(buildSignedApproval({ ...base, terms: spendTerms({ amount: money(1n, "USDT", "stable testnet") }) })).toEqual({ ok: false, reason: "bad_text" });
  });

  test("an amount of 1000 USD₮ is signed as exactly 1000000000 base units", () => {
    expect(built(spendTerms({ amount: money(1_000_000_000n, "USDT", "stable-testnet") })).message).toContain('"value":"1000000000"');
  });

  test("the expiry is the sheet's, never longer than the 2 minute product rule", () => {
    expect(buildSignedApproval({ ...base, terms: spendTerms(), expiresAt: NOW + SIGNED_APPROVAL_MAX_TTL_MS + 1 })).toEqual({ ok: false, reason: "bad_expiry" });
    expect(buildSignedApproval({ ...base, terms: spendTerms(), expiresAt: NOW })).toEqual({ ok: false, reason: "bad_expiry" });
  });
});

describe("verifySignedApproval", () => {
  const verify = (over: Partial<Parameters<typeof verifySignedApproval>[0]> = {}) => {
    const { message } = built();
    return verifySignedApproval({ message, signature: keystoreSign(message), publicKey: publicKeyFromSpki(spki)!, expected: expected(), now: NOW + 1_000, ...over });
  };

  test("accepts the Keystore key's signature over exactly the payload it was asked for", () => {
    expect(verify()).toMatchObject({ ok: true, payload: { nonce: NONCE } });
  });

  test("accepts either S half: Android Keystore doesn't normalize to low S", () => {
    const { message } = built();
    const sig = p256.Signature.fromBytes(hexToBytes(keystoreSign(message)), "der");
    const n = p256.Point.CURVE().n;
    for (const s of [sig.s, n - sig.s]) {
      expect(verify({ signature: bytesToHex(new p256.Signature(sig.r, s).toBytes("der")) })).toMatchObject({ ok: true });
    }
  });

  test("a tampered amount fails: the signature no longer matches, and the payload no longer matches the call", () => {
    const { message } = built();
    const tampered = message.replace('"value":"5000000"', '"value":"9000000"');
    expect(verify({ message: tampered, signature: keystoreSign(message) })).toEqual({ ok: false, reason: "mismatch" });
    // Even signed by the right key, a payload for another amount is not this call's approval.
    const other = built(spendTerms({ amount: money(9_000_000n, "USDT", "stable-testnet") })).message;
    expect(verify({ message: other, signature: keystoreSign(other) })).toEqual({ ok: false, reason: "mismatch" });
    // And a signature over the other amount never verifies this one.
    expect(verify({ signature: keystoreSign(other) })).toEqual({ ok: false, reason: "bad_signature" });
  });

  test("a swapped recipient fails", () => {
    const swapped = built(spendTerms({ recipient: "0x2222222222222222222222222222222222222222" })).message;
    expect(verify({ message: swapped, signature: keystoreSign(swapped) })).toEqual({ ok: false, reason: "mismatch" });
  });

  test("another args hash, skill, request or risk fails", () => {
    expect(verify({ expected: { ...expected(), argsHash: "d".repeat(64) } })).toEqual({ ok: false, reason: "mismatch" });
    expect(verify({ expected: { ...expected(), skill: "pay_other" } })).toEqual({ ok: false, reason: "mismatch" });
    expect(verify({ expected: { ...expected(), requestId: "req-2" } })).toEqual({ ok: false, reason: "mismatch" });
    expect(verify({ expected: { ...expected(), risk: "credential" } })).toEqual({ ok: false, reason: "mismatch" });
  });

  test("an expired approval fails, at the expiry and after", () => {
    expect(verify({ now: NOW + 120_000 })).toEqual({ ok: false, reason: "expired" });
    expect(verify({ now: NOW + 600_000 })).toEqual({ ok: false, reason: "expired" });
  });

  test("an approval issued in the future (a clock set ahead to stretch it) fails", () => {
    expect(verify({ now: NOW - 60_000 })).toEqual({ ok: false, reason: "not_yet_valid" });
  });

  test("a signature by any other key fails", () => {
    const { message } = built();
    expect(verify({ signature: keystoreSign(message, otherSk) })).toEqual({ ok: false, reason: "bad_signature" });
    expect(verify({ publicKey: publicKeyFromSpki(otherSpki)! })).toEqual({ ok: false, reason: "bad_signature" });
  });

  test("no signature (the JS proof path) and garbage signatures fail", () => {
    expect(verify({ signature: undefined })).toEqual({ ok: false, reason: "no_signature" });
    expect(verify({ signature: "" })).toEqual({ ok: false, reason: "no_signature" });
    expect(verify({ signature: "zz" })).toEqual({ ok: false, reason: "bad_signature" });
    expect(verify({ signature: "30".repeat(40) })).toEqual({ ok: false, reason: "bad_signature" });
  });

  test("a non-USD₮ payload fails even when it is signed and expected", () => {
    const payload = { ...built().payload, amount: { value: "5000000", asset: "USDC", network: "base-sepolia" } };
    const message = `${SIGNED_APPROVAL_DOMAIN}\n${JSON.stringify(payload)}`;
    const usdc = { ...expected(), terms: spendTerms({ amount: money(5_000_000n, "USDC", "base-sepolia") }) };
    expect(verify({ message, signature: keystoreSign(message), expected: usdc })).toMatchObject({ ok: false });
  });

  test("another domain, extra fields or a non-canonical encoding fail", () => {
    const { payload, message } = built();
    const wrongDomain = message.replace(`${SIGNED_APPROVAL_DOMAIN}\n`, "hermit.other.v1\n");
    expect(verify({ message: wrongDomain, signature: keystoreSign(wrongDomain) })).toEqual({ ok: false, reason: "malformed" });
    const extra = signedApprovalMessage({ ...payload, note: "x" } as typeof payload);
    expect(verify({ message: extra, signature: keystoreSign(extra) })).toEqual({ ok: false, reason: "malformed" });
    const spaced = `${SIGNED_APPROVAL_DOMAIN}\n${JSON.stringify(payload, null, 1)}`;
    expect(verify({ message: spaced, signature: keystoreSign(spaced) })).toEqual({ ok: false, reason: "malformed" });
    expect(verify({ message: "not json", signature: keystoreSign("not json") })).toEqual({ ok: false, reason: "malformed" });
  });
});

describe("public keys", () => {
  test("SPKI round trip; anything that isn't an uncompressed P-256 key is refused", () => {
    expect(publicKeyFromSpki(spki)).toEqual(pub);
    expect(publicKeyFromSpki(spki.slice(2))).toBeUndefined();
    expect(publicKeyFromSpki("zz")).toBeUndefined();
    expect(publicKeyFromSpki(spki.replace(/.{2}$/, "00"))).toBeUndefined(); // not on the curve
  });
});

describe("nonces", () => {
  for (const [name, make] of [["memory", async () => memoryNonceStore()], ["sqlite", async () => {
    const db = nodeSql();
    await migrate(db);
    return createNonceStore(db);
  }]] as const) {
    test(`${name}: a nonce is accepted once; a replay is refused`, async () => {
      const store = await make();
      expect(await store.consume(NONCE, NOW + 1_000, NOW)).toBe(true);
      expect(await store.consume(NONCE, NOW + 1_000, NOW + 10)).toBe(false);
      expect(await store.consume("cd".repeat(32), NOW + 1_000, NOW)).toBe(true);
    });

    test(`${name}: a malformed nonce is never accepted`, async () => {
      const store = await make();
      expect(await store.consume("short", NOW + 1_000, NOW)).toBe(false);
    });
  }

  test("sqlite: used nonces survive a restart (a new store over the same database)", async () => {
    const db = nodeSql();
    await migrate(db);
    expect(await createNonceStore(db).consume(NONCE, NOW + 1_000, NOW)).toBe(true);
    expect(await createNonceStore(db).consume(NONCE, NOW + 1_000, NOW + 5)).toBe(false);
  });
});

describe("enrollment proof", () => {
  test("a fresh signature by the new key over its challenge proves it; any other does not", () => {
    const message = enrollmentMessage("ef".repeat(32), NOW);
    expect(message.startsWith(`${APPROVAL_KEY_ENROLL_DOMAIN}\n`)).toBe(true);
    expect(verifyEnrollment(message, keystoreSign(message), spki)).toBe(true);
    expect(verifyEnrollment(message, keystoreSign(message, otherSk), spki)).toBe(false);
    expect(verifyEnrollment(message, keystoreSign(message), "00")).toBe(false);
    // An enrollment signature is never an approval.
    expect(verifySignedApproval({ message, signature: keystoreSign(message), publicKey: pub, expected: expected(), now: NOW })).toEqual({ ok: false, reason: "malformed" });
  });
});

describe("an iPhone's Secure Enclave key (iOS module)", () => {
  // A known vector, made once on a Mac with a throwaway software P-256 SecKey and the calls the iOS module makes:
  // SecKeyCopyExternalRepresentation (X9.63, 0x04 X Y) behind the SPKI header (ApprovalKeyFormat.spki), and
  // SecKeyCreateSignature(.ecdsaSignatureMessageX962SHA256), which is SHA256withECDSA in DER, as on Android.
  const IOS_SPKI = "3059301306072a8648ce3d020106082a8648ce3d03010703420004f4c4b0fa0e50f6d9c585110cde10f5c640e702c7362cc7494524ce9e83e95fd5e483629a03cb510982694e34212fb9ed36c47327d6f47782e24896f72dcbb533";
  const IOS_ENROLL_SIG = "3045022100fefc6ce44df7f06f1a7ced461c1859db6c0f835a8b81fbb53ca6659012ef873102201954ff1284f24f52ca3af01663729975e13ceb1e5d8396d0fd16f2c80e42bc06";
  const IOS_SPEND_SIG = "3045022100ff44e09dc9f46e5a388dea7dc0d3cd579dd946662422f521360fa5379faa12fa02206716c1cdd70b32094f97221840caff99c74520adce47bcc781782663ba8c57a4";
  const iosTerms = spendTerms({ amount: money(5_000_000n, "USDT", "eip155:2201") });

  test("its public key and its enrollment signature verify as they come from the module, with no conversion in JavaScript", () => {
    const key = publicKeyFromSpki(IOS_SPKI);
    expect(key).toBeDefined();
    expect(spkiFromPublicKey(key!)).toBe(IOS_SPKI);
    expect(verifyEnrollment(enrollmentMessage("cd".repeat(32), NOW), IOS_ENROLL_SIG, IOS_SPKI)).toBe(true);
    expect(verifyEnrollment(enrollmentMessage("ef".repeat(32), NOW), IOS_ENROLL_SIG, IOS_SPKI)).toBe(false);
  });

  test("its signature approves exactly the payment it was made over, and nothing changed from it", () => {
    const { message } = built(iosTerms);
    const publicKey = publicKeyFromSpki(IOS_SPKI)!;
    expect(verifySignedApproval({ message, signature: IOS_SPEND_SIG, publicKey, expected: expected(iosTerms), now: NOW + 1 })).toMatchObject({ ok: true });
    // Another amount: the cage's expected call no longer matches the payload.
    const more = spendTerms({ amount: money(6_000_000n, "USDT", "eip155:2201") });
    expect(verifySignedApproval({ message, signature: IOS_SPEND_SIG, publicKey, expected: expected(more), now: NOW + 1 })).toEqual({ ok: false, reason: "mismatch" });
    // The changed payload itself, offered with the old signature: not the key's signature over it.
    const changed = built(more).message;
    expect(verifySignedApproval({ message: changed, signature: IOS_SPEND_SIG, publicKey, expected: expected(more), now: NOW + 1 })).toEqual({ ok: false, reason: "bad_signature" });
  });
});

describe("createSignedApprovals (what the loop calls)", () => {
  const setup = (state: ApprovalKeyState, enrolled: string | null = spki) => {
    let n = 0;
    return createSignedApprovals({
      key: { state: async () => state },
      enrolledKey: async () => enrolled ?? undefined,
      nonces: memoryNonceStore(),
      randomNonce: () => (n++ % 2 ? "cd" : "ab").repeat(32),
      now: () => NOW,
    });
  };
  const ready: ApprovalKeyState = { state: "ready", publicKey: spki, level: "strongbox" };
  const ask = { risk: "spend" as const, skill: "pay", requestId: "req-1", argsHash: "c".repeat(64), terms: spendTerms(), expiresAt: NOW + 120_000 };

  test("prepare, sign, verify once; the same signature again is a replay", async () => {
    const s = setup(ready);
    const prepared = await s.prepare(ask);
    if (!prepared.ok) throw new Error(prepared.reason);
    const signature = keystoreSign(prepared.request.message);
    const first = await s.verify(prepared.request, signature, ask);
    expect(first).toEqual({ ok: true, payloadHash: signedApprovalHash(prepared.request.message) });
    expect(await s.verify(prepared.request, signature, ask)).toEqual({ ok: false, reason: "replayed" });
  });

  test("no key, a lost key, no strong biometric: blocked before the sheet, with the reason", async () => {
    expect(await setup({ state: "none" }, null).prepare(ask)).toEqual({ ok: false, reason: "key_none" });
    expect(await setup({ state: "lost" }).prepare(ask)).toEqual({ ok: false, reason: "key_lost" });
    expect(await setup({ state: "no_biometric" }).prepare(ask)).toEqual({ ok: false, reason: "no_biometric" });
  });

  test("a Keystore key that isn't the enrolled one (swapped, or never enrolled) is lost, not trusted", async () => {
    expect(await setup({ state: "ready", publicKey: otherSpki, level: "tee" }).prepare(ask)).toEqual({ ok: false, reason: "key_lost" });
    expect(await setup(ready, null).prepare(ask)).toEqual({ ok: false, reason: "key_none" });
  });

  test("the key retired between the sheet and the signature: refused at verify", async () => {
    let state: ApprovalKeyState = ready;
    const s = createSignedApprovals({ key: { state: async () => state }, enrolledKey: async () => spki, nonces: memoryNonceStore(), randomNonce: () => NONCE, now: () => NOW });
    const prepared = await s.prepare(ask);
    if (!prepared.ok) throw new Error(prepared.reason);
    state = { state: "lost" };
    expect(await s.verify(prepared.request, keystoreSign(prepared.request.message), ask)).toEqual({ ok: false, reason: "key_lost" });
  });

  test("a bad signature does not burn the nonce", async () => {
    const s = setup(ready);
    const prepared = await s.prepare(ask);
    if (!prepared.ok) throw new Error(prepared.reason);
    expect(await s.verify(prepared.request, keystoreSign(prepared.request.message, otherSk), ask)).toEqual({ ok: false, reason: "bad_signature" });
    expect(await s.verify(prepared.request, keystoreSign(prepared.request.message), ask)).toMatchObject({ ok: true });
  });

  test("a non-USD₮ amount is refused at prepare", async () => {
    expect(await setup(ready).prepare({ ...ask, terms: spendTerms({ amount: money(1n, "USDC", "base-sepolia") }) })).toEqual({ ok: false, reason: "not_usdt" });
  });
});

describe("a login's signed payload (SL-36, FR-VAULT-04)", () => {
  const ITEM = "d".repeat(64);
  const CHROME = "android://8P1sW0EPJcslw7UzRsiXL64w-O50Ed-RBICtay1g24M@com.android.chrome";
  const loginTerms = (over: Partial<SignedApprovalTerms> = {}): SignedApprovalTerms => ({ origin: "https://bank.example", item: ITEM, requester: CHROME, ...over });
  const loginBase = { ...base, risk: "credential" as const, skill: "fill_login" };
  const loginExpected = (terms = loginTerms()) => ({ risk: "credential" as const, skill: "fill_login", requestId: "req-1", argsHash: "c".repeat(64), terms });
  const loginBuilt = (terms = loginTerms()) => {
    const r = buildSignedApproval({ ...loginBase, terms });
    if (!r.ok) throw new Error(r.reason);
    return r.request;
  };

  test("binds the item's id hash, the exact origin and the requester's verified identity", () => {
    const { payload, message } = loginBuilt();
    expect(payload).toMatchObject({ risk: "credential", skill: "fill_login", origin: "https://bank.example", item: ITEM, requester: CHROME });
    expect(verifySignedApproval({ message, signature: keystoreSign(message), publicKey: pub, expected: loginExpected(), now: NOW + 1 }).ok).toBe(true);
  });

  test("another item, origin or requester fails, even with a valid signature over its own payload", () => {
    const { message } = loginBuilt();
    const sig = keystoreSign(message);
    const others = [
      loginTerms({ item: "e".repeat(64) }),
      loginTerms({ origin: "https://bank.example.evil.net" }),
      loginTerms({ requester: "android://evilTestCertDigest_000000000000000000000000@com.android.chrome" }),
      { origin: "https://bank.example", requester: CHROME },
      { origin: "https://bank.example", item: ITEM },
    ];
    for (const terms of others) {
      expect(verifySignedApproval({ message, signature: sig, publicKey: pub, expected: loginExpected(terms), now: NOW + 1 })).toEqual({ ok: false, reason: "mismatch" });
    }
  });

  test("an item that isn't a hash, or a requester with hidden characters, is refused before anything is asked", () => {
    expect(buildSignedApproval({ ...loginBase, terms: loginTerms({ item: "item-1" }) })).toEqual({ ok: false, reason: "bad_text" });
    expect(buildSignedApproval({ ...loginBase, terms: loginTerms({ requester: "android://x@com.android.chrome‮" }) })).toEqual({ ok: false, reason: "bad_text" });
  });

  test("the exact bytes the native prompt reads (ApprovalTextTest.kt builds the same message)", () => {
    const r = buildSignedApproval({ ...loginBase, requestId: "r", now: 1, expiresAt: 2, terms: loginTerms() });
    expect(r.ok && r.request.message).toBe(
      `hermit.approval.v1\n{"argsHash":"${"c".repeat(64)}","domain":"hermit.approval.v1","expiresAt":2,"issuedAt":1,"item":"${ITEM}","nonce":"${NONCE}",` +
        `"origin":"https://bank.example","requestId":"r","requester":"${CHROME}","risk":"credential","skill":"fill_login","v":1}`,
    );
  });

  test("a payment never carries an item or a requester", () => {
    expect(buildSignedApproval({ ...base, terms: spendTerms({ item: ITEM }) })).toEqual({ ok: false, reason: "bad_text" });
    expect(buildSignedApproval({ ...base, terms: spendTerms({ requester: CHROME }) })).toEqual({ ok: false, reason: "bad_text" });
  });

  test("a payload whose item isn't a hash doesn't parse, even when signed", () => {
    const { payload } = loginBuilt();
    const bad = signedApprovalMessage({ ...payload, item: "item-1" });
    expect(verifySignedApproval({ message: bad, signature: keystoreSign(bad), publicKey: pub, expected: loginExpected(loginTerms({ item: "item-1" })), now: NOW + 1 })).toEqual({ ok: false, reason: "malformed" });
  });
});
