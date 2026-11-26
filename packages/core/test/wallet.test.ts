import { describe, expect, test } from "vitest";
import { webcrypto } from "node:crypto";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { BIP39_ENGLISH } from "../src/bip39-english.ts";
import {
  checkRecoveryPhrase, CREATE_WORD_COUNT, entropyToWords, parseWalletRecord, serializeWalletRecord, splitPhrase, WALLET_KEY, WALLET_NETWORK,
  WALLET_RECORD_KEY, walletIdHash, wordCheckMatches, wordCheckPositions, wordsToEntropy, type WalletRecord,
} from "../src/wallet.ts";
import { SECRET_KEYS } from "../src/erase.ts";
import { VAULT_KEY } from "../src/vault.ts";

const random = (n: number) => webcrypto.getRandomValues(new Uint8Array(n));

/** Published BIP-39 vectors (trezor/python-mnemonic vectors.json, English): entropy and its words. */
const VECTORS: Array<[string, string]> = [
  ["00000000000000000000000000000000", "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"],
  ["7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f", "legal winner thank year wave sausage worth useful legal winner thank yellow"],
  ["80808080808080808080808080808080", "letter advice cage absurd amount doctor acoustic avoid letter advice cage above"],
  ["ffffffffffffffffffffffffffffffff", "zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong"],
  ["0000000000000000000000000000000000000000000000000000000000000000", "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art"],
  ["ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff", "zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo vote"],
];

const record = (over: Partial<WalletRecord> = {}): WalletRecord => ({
  v: 1,
  id: "w1",
  address: "0x9858EfFD232B4033E47d90003D41EC34EcaEda94",
  path: WALLET_NETWORK.path,
  chainId: WALLET_NETWORK.chainId,
  sealed: "ab".repeat(12 + 16 + 16),
  words: 12,
  source: "created",
  createdAt: 1_000,
  ...over,
});

describe("the BIP-39 English wordlist", () => {
  test("is the published list: 2048 words whose SHA-256 the BIP gives", () => {
    expect(BIP39_ENGLISH).toHaveLength(2048);
    expect(new Set(BIP39_ENGLISH).size).toBe(2048);
    expect(bytesToHex(sha256(utf8ToBytes(BIP39_ENGLISH.join("\n") + "\n")))).toBe("2f5eed53a4727b4bf8880d8f3f199efc90e58503646d9ff8eff3a2ed3b24dbda");
  });
});

describe("recovery words (US-PAY-01, US-PAY-02)", () => {
  test("entropy and words agree with the published vectors, both ways", () => {
    for (const [hex, phrase] of VECTORS) {
      expect(entropyToWords(hexToBytes(hex)).join(" ")).toBe(phrase);
      expect(bytesToHex(wordsToEntropy(phrase.split(" "))!)).toBe(hex);
    }
  });

  test("a phrase is read the way people type it: any case, extra spaces and line breaks", () => {
    expect(splitPhrase("  Legal winner\tTHANK\n year  ")).toEqual(["legal", "winner", "thank", "year"]);
    const r = checkRecoveryPhrase(" Abandon abandon abandon abandon abandon abandon\nabandon abandon abandon abandon abandon ABOUT ");
    expect(r).toEqual({ ok: true, words: VECTORS[0]![1].split(" ") });
  });

  test("only 12 or 24 words are accepted", () => {
    expect(checkRecoveryPhrase("")).toEqual({ ok: false, problem: "word_count", count: 0 });
    expect(checkRecoveryPhrase("abandon ".repeat(11))).toEqual({ ok: false, problem: "word_count", count: 11 });
    // 15, 18 and 21 are valid BIP-39 lengths, but Hermit makes and restores 12 or 24 (US-PAY-01).
    expect(checkRecoveryPhrase("abandon ".repeat(14) + "address")).toEqual({ ok: false, problem: "word_count", count: 15 });
  });

  test("words outside the English list are named by position, before any checksum", () => {
    const words = VECTORS[0]![1].split(" ");
    words[2] = "abandono";
    words[7] = "zoológico";
    expect(checkRecoveryPhrase(words.join(" "))).toEqual({ ok: false, problem: "unknown_words", positions: [2, 7] });
  });

  test("a wrong checksum is refused: one word swapped, or two words in the wrong order", () => {
    const words = VECTORS[1]![1].split(" ");
    expect(checkRecoveryPhrase([...words.slice(0, 11), "zoo"].join(" "))).toEqual({ ok: false, problem: "checksum" });
    const swapped = [...words];
    [swapped[0], swapped[1]] = [swapped[1]!, swapped[0]!];
    expect(checkRecoveryPhrase(swapped.join(" "))).toEqual({ ok: false, problem: "checksum" });
    expect(wordsToEntropy(swapped)).toBeUndefined();
  });

  test("Hermit creates 12 words (128 bits) and refuses entropy of any other size", () => {
    expect(CREATE_WORD_COUNT).toBe(12);
    expect(entropyToWords(random(16))).toHaveLength(12);
    expect(entropyToWords(random(32))).toHaveLength(24);
    expect(() => entropyToWords(random(20))).toThrow(RangeError);
  });
});

describe("the word check (US-PAY-01: the user confirms three of them)", () => {
  test("three distinct positions, in order, inside the phrase", () => {
    for (let i = 0; i < 200; i++) {
      const p = wordCheckPositions(12, random);
      expect(p).toHaveLength(3);
      expect(new Set(p).size).toBe(3);
      expect([...p].sort((a, b) => a - b)).toEqual(p);
      for (const x of p) expect(x >= 0 && x < 12).toBe(true);
    }
  });

  test("every position comes up: the draw is not stuck on a few words", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 400; i++) for (const x of wordCheckPositions(24, random)) seen.add(x);
    expect(seen.size).toBe(24);
  });

  test("answers match ignoring case and spaces; a wrong or missing word fails", () => {
    const words = VECTORS[1]![1].split(" ");
    expect(wordCheckMatches(words, [0, 5, 11], [" Legal", "SAUSAGE ", "yellow"])).toBe(true);
    expect(wordCheckMatches(words, [0, 5, 11], ["legal", "sausage", "thank"])).toBe(false);
    expect(wordCheckMatches(words, [0, 5, 11], ["legal", "sausage"])).toBe(false);
    expect(wordCheckMatches(words, [], [])).toBe(false);
  });
});

describe("the wallet record (one wallet per device)", () => {
  test("round-trips, and holds only the sealed seed, the public address and dates", () => {
    const r = record({ backedUpAt: 2_000 });
    expect(parseWalletRecord(serializeWalletRecord(r))).toEqual(r);
    expect(Object.keys(JSON.parse(serializeWalletRecord(r))).sort()).toEqual(["address", "backedUpAt", "chainId", "createdAt", "id", "path", "sealed", "source", "v", "words"]);
  });

  test("anything malformed or for another network reads as no record", () => {
    for (const bad of [
      "",
      "{",
      "null",
      JSON.stringify({ ...record(), v: 2 }),
      JSON.stringify({ ...record(), chainId: 1 }),
      JSON.stringify({ ...record(), chainId: 988 }),
      JSON.stringify({ ...record(), address: "0x123" }),
      JSON.stringify({ ...record(), sealed: "zz" }),
      JSON.stringify({ ...record(), sealed: "" }),
      JSON.stringify({ ...record(), words: 15 }),
      JSON.stringify({ ...record(), path: "m/44'/60'/0'/0/1" }),
      JSON.stringify({ ...record(), source: "imported" }),
      JSON.stringify({ ...record(), phrase: "abandon" }),
    ]) {
      expect(parseWalletRecord(bad), bad).toBeUndefined();
    }
  });

  test("the network is Stable testnet and the asset USD₮ only (PDR-027)", () => {
    expect(WALLET_NETWORK).toMatchObject({ network: "eip155:2201", chainId: 2201, asset: "USDT", testnet: true, token: "0x78Cf24370174180738C5B8E352B6D14c83a6c9A9", path: "m/44'/60'/0'/0/0" });
  });

  test("its key has its own Keystore service, apart from the vault's, and Delete everything knows the record", () => {
    expect(WALLET_KEY.service).not.toBe(VAULT_KEY.service);
    expect(WALLET_KEY.key).not.toBe(VAULT_KEY.key);
    expect(Object.values(SECRET_KEYS)).toContain(WALLET_RECORD_KEY);
    expect(Object.values(SECRET_KEYS)).not.toContain(WALLET_KEY.key);
  });

  test("the signed log names a wallet by a hash of its id only", () => {
    expect(walletIdHash("w1")).toMatch(/^[0-9a-f]{64}$/);
    expect(walletIdHash("w1")).not.toBe(walletIdHash("w2"));
    expect(walletIdHash("w1")).not.toContain("w1");
  });
});
