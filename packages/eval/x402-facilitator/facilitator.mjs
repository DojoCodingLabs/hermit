// Desktop dev tool only, never bundled into the app: the reference x402 facilitator
// (x402-foundation/x402, npm @x402/core and @x402/evm 2.31.0) registered for the `exact` scheme on
// Stable testnet (eip155:2201), whose gas token is USD₮0. Testnet only. Findings in
// docs/research/x402-spike.md ("USD₮0 settlement").
//
//   cd packages/eval/x402-facilitator && npm ci --ignore-scripts && node facilitator.mjs
//   node facilitator.mjs fund <address> <usdt0>   # send USD₮0 from the gas key (testnet only)
//
// The gas key is a throwaway generated on first run and kept OUTSIDE the repository (OS temp dir,
// mode 600); HERMIT_X402_FACILITATOR_KEY (0x hex) overrides it. The key is never printed.
// It needs a little test USD₮0 for gas: https://faucet.stable.xyz (1 USD₮0 per claim).
import { createServer } from "node:http";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { x402Facilitator } from "@x402/core/facilitator";
import { toFacilitatorEvmSigner } from "@x402/evm";
import { ExactEvmScheme } from "@x402/evm/exact/facilitator";
import { createWalletClient, formatEther, http, parseEther, publicActions } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { stableTestnet } from "viem/chains";

const NETWORK = "eip155:2201";
const RPC = process.env.STABLE_TESTNET_RPC ?? "https://rpc.testnet.stable.xyz";
const PORT = Number(process.env.PORT ?? 4022);
const HOST = "127.0.0.1";
const KEY_FILE = join(tmpdir(), "hermit-x402-facilitator-testnet.key");

if (stableTestnet.id !== 2201 || !stableTestnet.testnet) throw new Error("Refusing to run on anything but Stable testnet.");

function loadKey() {
  const env = process.env.HERMIT_X402_FACILITATOR_KEY;
  if (env && /^0x[0-9a-fA-F]{64}$/.test(env)) return { key: env, source: "env" };
  if (existsSync(KEY_FILE)) return { key: "0x" + readFileSync(KEY_FILE, "utf8").trim(), source: KEY_FILE };
  const hex = randomBytes(32).toString("hex");
  writeFileSync(KEY_FILE, hex, { mode: 0o600 });
  return { key: "0x" + hex, source: `${KEY_FILE} (new)` };
}

const { key, source } = loadKey();
const account = privateKeyToAccount(key);
const client = createWalletClient({ account, chain: stableTestnet, transport: http(RPC) }).extend(publicActions);
const gas = await client.getBalance({ address: account.address });
console.log(`facilitator gas key  ${account.address} (${source})`);
console.log(`gas balance          ${formatEther(gas)} USD₮0 on Stable testnet (native, 18 decimals; the same balance as the 6-decimal ERC-20)`);

if (process.argv[2] === "fund") {
  // Testnet helper: move a little USD₮0 to the payer. On Stable the native gas token and the USD₮0
  // ERC-20 are one balance, so a plain value transfer funds the payer's token balance.
  const to = process.argv[3];
  const amount = process.argv[4] ?? "0.1";
  if (!/^0x[0-9a-fA-F]{40}$/.test(to ?? "")) throw new Error("usage: node facilitator.mjs fund <address> [usdt0]");
  const hash = await client.sendTransaction({ to, value: parseEther(amount) });
  const receipt = await client.waitForTransactionReceipt({ hash });
  console.log(`funded ${to} with ${amount} USD₮0: ${hash} (${receipt.status})`);
  process.exit(0);
}

const signer = toFacilitatorEvmSigner({
  address: account.address,
  getCode: (args) => client.getCode(args),
  readContract: (args) => client.readContract({ ...args, args: args.args ?? [] }),
  verifyTypedData: (args) => client.verifyTypedData(args),
  writeContract: (args) => client.writeContract({ ...args, args: args.args ?? [] }),
  sendTransaction: (args) => client.sendTransaction(args),
  waitForTransactionReceipt: (args) => client.waitForTransactionReceipt(args),
});

const facilitator = new x402Facilitator()
  .onVerifyFailure(async (c) => console.log("verify failure", c.error?.message ?? c.result ?? ""))
  .onAfterSettle(async (c) => console.log("settled", JSON.stringify(c.result)))
  .onSettleFailure(async (c) => console.log("settle failure", c.error?.message ?? ""));
// Only `exact` with EIP-3009 on Stable testnet. No smart-wallet factories (ERC-6492) allowed.
facilitator.register(NETWORK, new ExactEvmScheme(signer, { eip6492AllowedFactories: [] }));

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (c) => {
      body += c;
      if (body.length > 64 * 1024) reject(new Error("body too large"));
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(body));
      } catch (e) {
        reject(e);
      }
    });
  });
}

const send = (res, status, value) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(value));
};

const supported = (p, r) =>
  facilitator.getSupported().kinds.some((k) => k.x402Version === p?.x402Version && k.scheme === r?.scheme && k.network === r?.network);

createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/supported") return send(res, 200, facilitator.getSupported());
    if (req.method === "POST" && (req.url === "/verify" || req.url === "/settle")) {
      const { paymentPayload, paymentRequirements } = await readJson(req);
      const settle = req.url === "/settle";
      if (!supported(paymentPayload, paymentRequirements)) {
        return send(res, 200, settle ? { success: false, errorReason: "unsupported_scheme", transaction: "", network: paymentRequirements?.network ?? "unknown" } : { isValid: false, invalidReason: "unsupported_scheme" });
      }
      const out = settle ? await facilitator.settle(paymentPayload, paymentRequirements) : await facilitator.verify(paymentPayload, paymentRequirements);
      console.log(req.url, JSON.stringify(out));
      return send(res, 200, out);
    }
    send(res, 404, { error: "not found" });
  } catch (e) {
    console.error(req.url, e);
    send(res, 500, { error: e instanceof Error ? e.message : String(e) });
  }
}).listen(PORT, HOST, () => console.log(`facilitator          http://${HOST}:${PORT} (exact, ${NETWORK}, RPC ${RPC})`));
