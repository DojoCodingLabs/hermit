import { describe, expect, test } from "vitest";
import { domainSeparator, localKeySigner, recoverTypedDataSigner, transferWithAuthorizationDigest, TESTNET_ASSETS } from "../src/index.ts";
import { MERCHANT, ONCHAIN_DOMAIN_SEPARATOR, USDT0_TOKEN } from "./fixtures.ts";

describe("EIP-712 domain separators match the deployed testnet token", () => {
  test("Stable testnet USD₮0 (name USD₮0, version 1)", () => {
    const usdt0 = TESTNET_ASSETS.find((a) => a.network === "eip155:2201")!;
    expect(domainSeparator({ name: usdt0.eip712.name, version: usdt0.eip712.version, chainId: usdt0.chainId, verifyingContract: usdt0.address })).toBe(
      ONCHAIN_DOMAIN_SEPARATOR.stableTestnetUsdt0,
    );
  });

  test("the ASCII spelling USDT0 is a different domain, so the token would reject it", () => {
    expect(domainSeparator({ name: "USDT0", version: "1", chainId: 2201, verifyingContract: USDT0_TOKEN })).not.toBe(ONCHAIN_DOMAIN_SEPARATOR.stableTestnetUsdt0);
  });
});

describe("a local secp256k1 key signs TransferWithAuthorization the way the token verifies it", () => {
  const signer = localKeySigner(new Uint8Array(32).fill(7));
  const typedData = {
    domain: { name: "USD₮0", version: "1", chainId: 2201, verifyingContract: USDT0_TOKEN },
    primaryType: "TransferWithAuthorization" as const,
    message: {
      from: signer.address,
      to: MERCHANT,
      value: "10000",
      validAfter: "0",
      validBefore: "1800000000",
      nonce: "0x" + "00".repeat(31) + "01",
    },
  };

  test("the address is a checksummed 20-byte EVM address", () => {
    expect(signer.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(signer.address).not.toBe(signer.address.toLowerCase());
  });

  test("the known test key derives the known address", () => {
    // Private key 0x...01 is the textbook secp256k1 generator point.
    const one = new Uint8Array(32);
    one[31] = 1;
    expect(localKeySigner(one).address).toBe("0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf");
  });

  test("the signature is 65 bytes with v in {27, 28} and recovers to the signer", async () => {
    const sig = await signer.signTypedData(typedData);
    expect(sig).toMatch(/^0x[0-9a-f]{130}$/);
    expect([27, 28]).toContain(parseInt(sig.slice(-2), 16));
    expect(recoverTypedDataSigner(typedData, sig)).toBe(signer.address);
  });

  test("changing any field changes the digest", () => {
    const base = transferWithAuthorizationDigest(typedData);
    expect(transferWithAuthorizationDigest({ ...typedData, message: { ...typedData.message, value: "10001" } })).not.toBe(base);
    expect(transferWithAuthorizationDigest({ ...typedData, domain: { ...typedData.domain, chainId: 9745 } })).not.toBe(base);
  });
});
