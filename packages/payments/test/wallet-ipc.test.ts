import { describe, expect, test } from "vitest";
import {
  createLineSplitter,
  createWalletClient,
  localKeySigner,
  createInWorklet,
  openWallet,
  readBalance,
  restoreInWorklet,
  revealWords,
  WALLET_METHODS,
  recoverTypedDataSigner,
  workletSigner,
  WalletIpcError,
  type TransferWithAuthorizationTypedData,
} from "../src/index.ts";
import { MERCHANT, USDT0_TOKEN, WDK_BARE_SIGNATURE } from "./fixtures.ts";

const enc = new TextEncoder();

/** A stand-in for the wallet worklet: answers each request line with `answer(request)`, possibly out of order. */
function fakeWorklet(answer: (req: { id: number; method: string; params?: unknown }) => unknown) {
  const sent: { id: number; method: string; params?: unknown }[] = [];
  const split = createLineSplitter();
  const client = createWalletClient({
    write(bytes) {
      for (const line of split(bytes)) {
        const req = JSON.parse(line);
        sent.push(req);
        queueMicrotask(async () => {
          const res = await answer(req);
          if (res !== undefined) client.receive(enc.encode(JSON.stringify(res) + "\n"));
        });
      }
    },
  });
  return { client, sent };
}

const typedData = (from: string): TransferWithAuthorizationTypedData => ({
  domain: { name: "USD₮0", version: "1", chainId: 2201, verifyingContract: USDT0_TOKEN },
  primaryType: "TransferWithAuthorization",
  message: { from, to: MERCHANT, value: "10000", validAfter: "0", validBefore: "1800000000", nonce: "0x" + "00".repeat(31) + "2a" },
});

describe("line framing", () => {
  test("a ₮ split across two chunks comes out whole", () => {
    const split = createLineSplitter();
    const bytes = enc.encode('{"name":"USD₮0"}\n');
    const cut = bytes.indexOf(0xe2) + 1;
    expect(split(bytes.subarray(0, cut))).toEqual([]);
    expect(split(bytes.subarray(cut))).toEqual(['{"name":"USD₮0"}']);
  });

  test("several lines in one chunk, empty lines dropped, a trailing partial kept", () => {
    const split = createLineSplitter();
    expect(split(enc.encode("a\n\nb\nc"))).toEqual(["a", "b"]);
    expect(split(enc.encode("d\n"))).toEqual(["cd"]);
  });

  test("a line that never ends is refused once it passes the limit", () => {
    const split = createLineSplitter(16);
    expect(() => split(enc.encode("x".repeat(17)))).toThrow(WalletIpcError);
  });
});

describe("the wallet client", () => {
  test("requests are newline JSON with increasing ids", async () => {
    const { client, sent } = fakeWorklet((req) => ({ id: req.id, ok: true, result: {} }));
    await client.call("address");
    await client.call("balance");
    expect(sent.map((r) => [r.id, r.method])).toEqual([
      [1, "address"],
      [2, "balance"],
    ]);
  });

  test("responses are matched by id even out of order", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((r) => (release = r));
    const { client } = fakeWorklet(async (req) => {
      if (req.method === "balance") await gate;
      return { id: req.id, ok: true, result: { method: req.method } };
    });
    const slow = client.call("balance");
    const fast = await client.call("address");
    release!();
    expect(fast).toEqual({ method: "address" });
    expect(await slow).toEqual({ method: "balance" });
  });

  test("an error response rejects with the worklet's code", async () => {
    const { client } = fakeWorklet((req) => ({ id: req.id, ok: false, error: { code: "not_open", message: "Open the wallet first." } }));
    await expect(client.call("balance")).rejects.toMatchObject({ name: "WalletIpcError", code: "not_open" });
  });

  test("lines that are not responses to a pending call are ignored", async () => {
    const { client } = fakeWorklet(() => undefined);
    const pending = client.call("address");
    client.receive(enc.encode('not json\n{"id":99,"ok":true,"result":{}}\n{"id":1}\n'));
    client.receive(enc.encode('{"id":1,"ok":true,"result":{"address":"x"}}\n'));
    expect(await pending).toEqual({ address: "x" });
  });

  test("fail() rejects every pending call, and later calls too", async () => {
    const { client } = fakeWorklet(() => undefined);
    const a = client.call("open");
    const b = client.call("balance");
    client.fail("worklet_stopped");
    await expect(a).rejects.toMatchObject({ code: "worklet_stopped" });
    await expect(b).rejects.toMatchObject({ code: "worklet_stopped" });
    await expect(client.call("address")).rejects.toMatchObject({ code: "worklet_stopped" });
  });

  test("only the worklet's fixed methods can be called", async () => {
    const { client } = fakeWorklet((req) => ({ id: req.id, ok: true, result: {} }));
    // @ts-expect-error not a wallet method
    await expect(client.call("getMnemonic")).rejects.toMatchObject({ code: "unknown_method" });
  });
});

const ADDR = "0x9858effd232b4033e47d90003d41ec34ecaeda94";
const CHECKSUMMED = "0x9858EfFD232B4033E47d90003D41EC34EcaEda94";
const KEY = new Uint8Array(32).fill(3);
const SEALED_12 = "ab".repeat(12 + 16 + 16);
const ABOUT = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about".split(" ");
const made = (over: Record<string, unknown> = {}) => ({ sealed: SEALED_12, address: ADDR, path: "m/44'/60'/0'/0/0", chainId: 2201, words: 12, ...over });

describe("the fixed request types (SL-38)", () => {
  test("eight methods from SL-38 and three from SL-40, and none of them returns a key; only reveal returns words", () => {
    expect([...WALLET_METHODS].sort()).toEqual([
      "address", "balance", "close", "create", "open", "quoteTransfer", "restore", "reveal", "sendTransferWithAuthorization",
      "signTransferWithAuthorization", "transferReceipt",
    ]);
  });
});

describe("create and restore (US-PAY-01, US-PAY-02)", () => {
  test("create sends the wallet id, the key as hex and the word count, and gets back only the sealed seed and the address", async () => {
    const { client, sent } = fakeWorklet((req) => ({ id: req.id, ok: true, result: made() }));
    expect(await createInWorklet(client, { id: "w1", key: KEY, words: 12 })).toEqual({ sealed: SEALED_12, address: CHECKSUMMED, path: "m/44'/60'/0'/0/0", chainId: 2201, words: 12 });
    expect(sent[0]).toEqual({ id: 1, method: "create", params: { id: "w1", key: "03".repeat(32), words: 12 } });
  });

  test("a create answer for another chain, another path, a bad blob or with extra fields is refused", async () => {
    for (const bad of [made({ chainId: 1 }), made({ path: "m/44'/60'/0'/0/1" }), made({ sealed: "ab" }), made({ sealed: "AB".repeat(44) }), made({ words: 24 }), made({ phrase: ABOUT.join(" ") }), made({ address: "0x12" })]) {
      const { client } = fakeWorklet((req) => ({ id: req.id, ok: true, result: bad }));
      await expect(createInWorklet(client, { id: "w1", key: KEY, words: 12 }), JSON.stringify(bad)).rejects.toMatchObject({ code: "bad_response" });
    }
  });

  test("a key that is not 32 bytes is never sent", async () => {
    const { client, sent } = fakeWorklet((req) => ({ id: req.id, ok: true, result: made() }));
    await expect(createInWorklet(client, { id: "w1", key: new Uint8Array(16), words: 12 })).rejects.toMatchObject({ code: "bad_input" });
    expect(sent).toEqual([]);
  });

  test("restore sends the words joined by single spaces and checks the answer the same way", async () => {
    const { client, sent } = fakeWorklet((req) => ({ id: req.id, ok: true, result: made() }));
    expect((await restoreInWorklet(client, { id: "w2", key: KEY, words: ABOUT })).address).toBe(CHECKSUMMED);
    expect(sent[0]).toEqual({ id: 1, method: "restore", params: { id: "w2", key: "03".repeat(32), phrase: ABOUT.join(" ") } });
  });

  test("a restore whose word count differs from what was typed is refused", async () => {
    const { client } = fakeWorklet((req) => ({ id: req.id, ok: true, result: made({ words: 24, sealed: "ab".repeat(12 + 16 + 32) }) }));
    await expect(restoreInWorklet(client, { id: "w2", key: KEY, words: ABOUT })).rejects.toMatchObject({ code: "bad_response" });
  });
});

describe("reveal (the backup screen only)", () => {
  test("returns the words and the address they derive", async () => {
    const { client, sent } = fakeWorklet((req) => ({ id: req.id, ok: true, result: { words: ABOUT, address: ADDR } }));
    expect(await revealWords(client, { id: "w1", key: KEY, sealed: SEALED_12 })).toEqual({ words: ABOUT, address: CHECKSUMMED });
    expect(sent[0]).toEqual({ id: 1, method: "reveal", params: { id: "w1", key: "03".repeat(32), sealed: SEALED_12 } });
  });

  test("words that are not a valid English phrase are refused, so the screen never shows a wrong backup", async () => {
    for (const words of [ABOUT.slice(0, 11), [...ABOUT.slice(0, 11), "zoo"], [...ABOUT.slice(0, 11), "ABOUT"], [...ABOUT.slice(0, 11), 7]]) {
      const { client } = fakeWorklet((req) => ({ id: req.id, ok: true, result: { words, address: ADDR } }));
      await expect(revealWords(client, { id: "w1", key: KEY, sealed: SEALED_12 })).rejects.toMatchObject({ code: "bad_response" });
    }
  });
});

describe("open and balance", () => {
  test("open unseals in the worklet and returns the checksummed address, path and chain", async () => {
    const { client, sent } = fakeWorklet((req) => ({
      id: req.id,
      ok: true,
      result: { address: "0x94f297358d675b1185f1ffe4d7ac0b454ddefdaa", path: "m/44'/60'/0'/0/0", chainId: 2201 },
    }));
    expect(await openWallet(client, { id: "w1", key: KEY, sealed: SEALED_12 })).toEqual({ address: "0x94F297358D675B1185F1FFE4D7aC0B454DdeFDaA", path: "m/44'/60'/0'/0/0", chainId: 2201 });
    expect(sent[0]!.params).toEqual({ id: "w1", key: "03".repeat(32), sealed: SEALED_12 });
  });

  test("open refuses a worklet that answers with something that is not an address, or another chain", async () => {
    for (const result of [{ address: "0x12", path: "m/44'/60'/0'/0/0", chainId: 2201 }, { address: ADDR, path: "m/44'/60'/0'/0/0", chainId: 988 }]) {
      const { client } = fakeWorklet((req) => ({ id: req.id, ok: true, result }));
      await expect(openWallet(client, { id: "w1", key: KEY, sealed: SEALED_12 })).rejects.toMatchObject({ code: "bad_response" });
    }
  });

  test("the balance is read for a public address: no key, no seed", async () => {
    const { client, sent } = fakeWorklet((req) => ({ id: req.id, ok: true, result: { usdt0: "494673", native: "494673046875000000" } }));
    expect(await readBalance(client, CHECKSUMMED)).toEqual({ usdt0: 494673n, native: 494673046875000000n });
    expect(sent[0]).toEqual({ id: 1, method: "balance", params: { address: CHECKSUMMED } });
  });

  test("a balance that is not a whole decimal is refused", async () => {
    const { client } = fakeWorklet((req) => ({ id: req.id, ok: true, result: { usdt0: "1.5", native: "0" } }));
    await expect(readBalance(client, CHECKSUMMED)).rejects.toMatchObject({ code: "bad_response" });
  });

  test("a balance for something that is not an address is never asked", async () => {
    const { client, sent } = fakeWorklet((req) => ({ id: req.id, ok: true, result: { usdt0: "0", native: "0" } }));
    await expect(readBalance(client, "0x12")).rejects.toMatchObject({ code: "bad_input" });
    expect(sent).toEqual([]);
  });
});

describe("the worklet signer", () => {
  const key = new Uint8Array(32).fill(7);
  const local = localKeySigner(key);

  test("sends only domain and message, and returns a signature that recovers to the wallet", async () => {
    const { client, sent } = fakeWorklet(async (req) => {
      const p = req.params as Omit<TransferWithAuthorizationTypedData, "primaryType">;
      const signature = await local.signTypedData({ ...p, primaryType: "TransferWithAuthorization" });
      return { id: req.id, ok: true, result: { signature } };
    });
    const signer = workletSigner(client, local.address);
    const td = typedData(local.address);
    const sig = await signer.signTypedData(td);
    expect(signer.address).toBe(local.address);
    expect(recoverTypedDataSigner(td, sig)).toBe(local.address);
    expect(sent[0]).toEqual({ id: 1, method: "signTransferWithAuthorization", params: { domain: td.domain, message: td.message } });
  });

  test("a signature from any other key is refused, so the app never forwards it", async () => {
    const other = localKeySigner(new Uint8Array(32).fill(9));
    const { client } = fakeWorklet(async (req) => {
      const p = req.params as Omit<TransferWithAuthorizationTypedData, "primaryType">;
      return { id: req.id, ok: true, result: { signature: await other.signTypedData({ ...p, primaryType: "TransferWithAuthorization" }) } };
    });
    await expect(workletSigner(client, local.address).signTypedData(typedData(local.address))).rejects.toMatchObject({ code: "signer_mismatch" });
  });

  test("v as 0 or 1 is normalized to 27 or 28", async () => {
    const { client } = fakeWorklet(async (req) => {
      const p = req.params as Omit<TransferWithAuthorizationTypedData, "primaryType">;
      const sig = await local.signTypedData({ ...p, primaryType: "TransferWithAuthorization" });
      const v = parseInt(sig.slice(130), 16) - 27;
      return { id: req.id, ok: true, result: { signature: sig.slice(0, 130) + v.toString(16).padStart(2, "0") } };
    });
    const sig = await workletSigner(client, local.address).signTypedData(typedData(local.address));
    expect(["1b", "1c"]).toContain(sig.slice(130));
  });

  test("an authorization from another payer is refused before anything is sent", async () => {
    const { client, sent } = fakeWorklet((req) => ({ id: req.id, ok: true, result: { signature: "0x" } }));
    await expect(workletSigner(client, local.address).signTypedData(typedData(MERCHANT))).rejects.toMatchObject({ code: "wrong_payer" });
    expect(sent).toEqual([]);
  });

  test("a malformed signature is refused", async () => {
    const { client } = fakeWorklet((req) => ({ id: req.id, ok: true, result: { signature: "0xzz" } }));
    await expect(workletSigner(client, local.address).signTypedData(typedData(local.address))).rejects.toMatchObject({ code: "bad_response" });
  });
});

describe("a real WDK signature made inside Bare 1.33.4 (react-native-bare-kit 0.16.0's runtime)", () => {
  test("recovers to the WDK account's address with Hermit's own EIP-712 code", () => {
    const { address, typedData: td, signature } = WDK_BARE_SIGNATURE;
    expect(recoverTypedDataSigner(td, signature)).toBe(address);
  });

  test("and the same signature over a different amount does not", () => {
    const { address, typedData: td, signature } = WDK_BARE_SIGNATURE;
    const changed = { ...td, message: { ...td.message, value: "10001" } };
    expect(recoverTypedDataSigner(changed, signature)).not.toBe(address);
  });
});
