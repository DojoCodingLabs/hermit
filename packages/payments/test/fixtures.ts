// Testnet only. No keys, no personal data.

/** A USD₮0 offer on Stable testnet (eip155:2201), the shape Hermit pays (PDR-027). */
export const USDT0_TOKEN = "0x78Cf24370174180738C5B8E352B6D14c83a6c9A9";
export const USDT0_NET = "eip155:2201";
export const MERCHANT = "0x209693Bc6afc0C5328bA36FaF03C514EF312287C";
export const USDT0_PAYMENT_REQUIRED_V2 = {
  x402Version: 2,
  error: "Payment required",
  resource: { url: "https://merchant.example/protected", description: "Access to protected content", mimeType: "" },
  accepts: [
    {
      scheme: "exact",
      network: USDT0_NET,
      amount: "10000",
      asset: USDT0_TOKEN,
      payTo: MERCHANT,
      maxTimeoutSeconds: 300,
      extra: { name: "USD₮0", version: "1" },
    },
  ],
};

/** The same offer in the x402 v1 shape: JSON body, `maxAmountRequired`, network passed through as CAIP-2. */
export const USDT0_PAYMENT_REQUIRED_V1 = {
  x402Version: 1,
  error: "X-PAYMENT header is required",
  accepts: [
    {
      scheme: "exact",
      network: USDT0_NET,
      maxAmountRequired: "10000",
      resource: "https://merchant.example/protected",
      description: "Access to protected content",
      mimeType: "",
      payTo: MERCHANT,
      maxTimeoutSeconds: 300,
      asset: USDT0_TOKEN,
      extra: { name: "USD₮0", version: "1" },
    },
  ],
};

// Real responses captured from the public x402 testnet demo (https://x402.org/protected) on 2026-11-14:
// Base Sepolia USDC and Solana devnet. Hermit pays only in USD₮ (PDR-027), so these must be refused.

export const DEMO_PAYMENT_REQUIRED_V2 = {
  x402Version: 2,
  error: "Payment required",
  resource: { url: "https://x402.vercel.app/protected", description: "Access to protected content", mimeType: "" },
  accepts: [
    {
      scheme: "exact",
      network: "eip155:84532",
      amount: "10000",
      asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      payTo: "0x209693Bc6afc0C5328bA36FaF03C514EF312287C",
      maxTimeoutSeconds: 300,
      extra: { name: "USDC", version: "2" },
    },
    {
      scheme: "exact",
      network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
      amount: "10000",
      asset: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
      payTo: "CKPKJWNdJEqa81x7CkZ14BVPiY6y16Sxs7owznqtWYp5",
      maxTimeoutSeconds: 300,
      extra: { feePayer: "CKPKJWNdJEqa81x7CkZ14BVPiY6y16Sxs7owznqtWYp5", transactionVersions: [0, 1] },
    },
  ],
};

/** The same offer in the x402 v1 shape: JSON body, `maxAmountRequired`, legacy network names. */
export const DEMO_PAYMENT_REQUIRED_V1 = {
  x402Version: 1,
  error: "X-PAYMENT header is required",
  accepts: [
    {
      scheme: "exact",
      network: "base-sepolia",
      maxAmountRequired: "10000",
      resource: "https://x402.vercel.app/protected",
      description: "Access to protected content",
      mimeType: "",
      payTo: "0x209693Bc6afc0C5328bA36FaF03C514EF312287C",
      maxTimeoutSeconds: 300,
      asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      extra: { name: "USDC", version: "2" },
    },
  ],
};

/** `DOMAIN_SEPARATOR()` read from the token contract over public RPC on 2026-11-14. */
export const ONCHAIN_DOMAIN_SEPARATOR = {
  stableTestnetUsdt0: "0x51b2f5f7a57a74ea3ce0d8f747d2b870190416bf6d25cf3c54bf2340d0411029",
};

export function b64json(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

/**
 * A TransferWithAuthorization signed by `@tetherto/wdk-wallet-evm` 1.0.0-beta.26 inside Bare 1.33.4 (the runtime
 * react-native-bare-kit 0.16.0 embeds), through the wallet worklet's handler (SL-17, 2026-11-17). The wallet was
 * random, held in memory for that run only; only its public address and this signature were kept.
 */
export const WDK_BARE_SIGNATURE = {
  address: "0x94F297358D675B1185F1FFE4D7aC0B454DdeFDaA",
  typedData: {
    domain: { name: "USD₮0", version: "1", chainId: 2201, verifyingContract: USDT0_TOKEN },
    primaryType: "TransferWithAuthorization" as const,
    message: {
      from: "0x94F297358D675B1185F1FFE4D7aC0B454DdeFDaA",
      to: MERCHANT,
      value: "10000",
      validAfter: "0",
      validBefore: "1800000000",
      nonce: "0x000000000000000000000000000000000000000000000000000000000000002a",
    },
  },
  signature:
    "0xb70d8f66fe05747b90f53ab4aa6046c65be54e2c1aa0189779c9cff519949c0d662df20f9886170024962f767173eb9d56320d757a6c84e79b02ccbe066e42621b",
};
