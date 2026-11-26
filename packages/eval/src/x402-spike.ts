// x402 USD₮0 spike (desktop dev tool, never bundled into the app). Hermit pays in USD₮ only
// (PDR-027), so this runs @hermit/payments' payWithX402 against a tiny local merchant that asks for
// USD₮0 on Stable testnet (eip155:2201) and settles through the self-hosted reference facilitator in
// packages/eval/x402-facilitator. Testnet only; findings in docs/research/x402-spike.md.
//
//   (cd packages/eval/x402-facilitator && npm ci --ignore-scripts && node facilitator.mjs) &
//   pnpm --filter @hermit/eval spike:x402
//
// The earlier Base Sepolia USDC run (a protocol check only, USDC is never payable) is recorded in the
// research doc with its transaction hash; this tool no longer reaches USDC at all.
//
// The payer key is a throwaway kept OUTSIDE the repository (OS temp dir, mode 600);
// HERMIT_X402_TESTNET_KEY (0x hex) overrides it. The key itself is never printed.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { money } from "../../core/src/money.ts";
import {
  authorizationStateCall,
  buildPayment,
  latestBlockCall,
  localKeySigner,
  memoryLedger,
  parsePaymentRequired,
  payWithX402,
  readAuthorizationState,
  readBlock,
  resolvePending,
  selectRequirement,
  TESTNET_ASSETS,
  VOID_MARGIN_SECONDS,
  type HttpRequest,
  type HttpResponse,
} from "../../payments/src/index.ts";

const NETWORK = "eip155:2201";
const RPC = process.env.STABLE_TESTNET_RPC ?? "https://rpc.testnet.stable.xyz";
const EXPLORER = "https://testnet.stablescan.xyz/tx/";
const FACILITATOR = process.env.HERMIT_X402_FACILITATOR ?? "http://127.0.0.1:4022";
const PRICE = 10_000n; // 0.01 USD₮0 (6 decimals)
const KEY_FILE = join(tmpdir(), "hermit-x402-testnet.key");
const USDT0 = TESTNET_ASSETS.find((a) => a.network === NETWORK);
if (!USDT0) throw new Error("No USD₮0 on Stable testnet in the payable list.");

function loadKey(): { key: Uint8Array; source: string } {
  const env = process.env.HERMIT_X402_TESTNET_KEY;
  if (env && /^0x[0-9a-fA-F]{64}$/.test(env)) return { key: Uint8Array.from(Buffer.from(env.slice(2), "hex")), source: "env" };
  if (existsSync(KEY_FILE)) return { key: Uint8Array.from(Buffer.from(readFileSync(KEY_FILE, "utf8").trim(), "hex")), source: KEY_FILE };
  const key = new Uint8Array(randomBytes(32));
  writeFileSync(KEY_FILE, Buffer.from(key).toString("hex"), { mode: 0o600 });
  return { key, source: `${KEY_FILE} (new)` };
}

async function http(req: HttpRequest): Promise<HttpResponse> {
  const init: RequestInit = { method: req.method, headers: req.headers, redirect: "manual" };
  if (req.body !== undefined) init.body = req.body;
  const res = await fetch(req.url, init);
  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => (headers[k] = v));
  return { status: res.status, headers, body: await res.text() };
}

async function postJson(url: string, value: unknown): Promise<Record<string, unknown>> {
  const res = await http({ url, method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(value) });
  try {
    return JSON.parse(res.body) as Record<string, unknown>;
  } catch {
    return { status: res.status, body: res.body.slice(0, 300) };
  }
}

async function rpc(method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = (await res.json()) as { result?: unknown; error?: { message: string } };
  if (j.error) throw new Error(j.error.message);
  return j.result;
}

const tokenBalance = async (owner: string) => BigInt((await rpc("eth_call", [{ to: USDT0.address, data: "0x70a08231" + owner.slice(2).toLowerCase().padStart(64, "0") }, "latest"])) as string);
const b64 = (v: unknown) => Buffer.from(JSON.stringify(v), "utf8").toString("base64");
const log = (label: string, value: unknown) => console.log(`${label.padEnd(22)} ${typeof value === "string" ? value : JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v))}`);

const { key, source } = loadKey();
const signer = localKeySigner(key);
const supported = (await (await fetch(`${FACILITATOR}/supported`)).json()) as { kinds: { network: string }[]; signers: Record<string, string[]> };
if (!supported.kinds.some((k) => k.network === NETWORK)) throw new Error(`The facilitator at ${FACILITATOR} does not settle ${NETWORK}.`);
const operator = Object.values(supported.signers).flat()[0]!;
// The merchant is paid at the facilitator operator's address: one throwaway operator plays both
// roles here, and the test USD₮0 cycles back to the gas key.
const payTo = process.env.HERMIT_X402_PAY_TO ?? operator;

log("payer", signer.address);
log("key", source);
log("facilitator", `${FACILITATOR} (gas key ${operator})`);
log("payer USD₮0", `${await tokenBalance(signer.address)} base units`);
log("facilitator gas", `${BigInt((await rpc("eth_getBalance", [operator, "latest"])) as string)} wei of USD₮0`);

// A tiny merchant: 402 with one USD₮0 offer, then verify and settle through the facilitator.
let offer: Record<string, unknown> = {};
let resourceUrl = "";
async function merchant(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const paid = req.headers["payment-signature"];
  const required = { x402Version: 2, error: "Payment required", resource: { url: resourceUrl, description: "Hermit USD₮0 spike", mimeType: "text/plain" }, accepts: [offer] };
  if (typeof paid !== "string") {
    res.writeHead(402, { "payment-required": b64(required), "content-type": "application/json" });
    res.end(JSON.stringify({ error: "Payment required" }));
    return;
  }
  const paymentPayload = JSON.parse(Buffer.from(paid, "base64").toString("utf8")) as { accepted?: unknown };
  if (JSON.stringify(paymentPayload.accepted) !== JSON.stringify(offer)) {
    res.writeHead(402, { "payment-required": b64({ ...required, error: "accepted_mismatch" }) });
    res.end("{}");
    return;
  }
  const verified = await postJson(`${FACILITATOR}/verify`, { x402Version: 2, paymentPayload, paymentRequirements: offer });
  if (verified.isValid !== true) {
    res.writeHead(402, { "payment-required": b64({ ...required, error: String(verified.invalidReason ?? verified.error ?? "invalid") }) });
    res.end(JSON.stringify(verified));
    return;
  }
  const settled = await postJson(`${FACILITATOR}/settle`, { x402Version: 2, paymentPayload, paymentRequirements: offer });
  if (settled.success !== true) {
    res.writeHead(402, { "payment-required": b64({ ...required, error: String(settled.errorReason ?? settled.error ?? "settle_failed") }) });
    res.end(JSON.stringify(settled));
    return;
  }
  res.writeHead(200, { "payment-response": b64(settled), "content-type": "text/plain" });
  res.end("protected content, paid in USD₮0");
}
const server = createServer((req, res) => {
  merchant(req, res).catch((e: unknown) => {
    res.writeHead(500);
    res.end(String(e));
  });
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
resourceUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/protected`;
offer = { scheme: "exact", network: NETWORK, amount: PRICE.toString(), asset: USDT0.address, payTo, maxTimeoutSeconds: 300, extra: { name: USDT0.eip712.name, version: USDT0.eip712.version } };
log("merchant", resourceUrl);

try {
  // Step 1: the 402 and the offer Hermit picks.
  const first = await http({ url: resourceUrl, method: "GET", headers: {} });
  const pr = parsePaymentRequired(first);
  const sel = selectRequirement(pr, TESTNET_ASSETS);
  log("selected", { network: sel.requirement.network, asset: sel.asset.code, token: sel.asset.address, amount: sel.price.amount, payTo: sel.requirement.payTo });

  // Step 2: the facilitator's /verify on its own (simulates transferWithAuthorization on the token),
  // with a negative control signed by another key that must fail on the signature.
  const draft = buildPayment(pr, sel, { from: signer.address, nowSeconds: Date.now() / 1000, nonce: new Uint8Array(randomBytes(32)) });
  const verifyWith = async (sig: string) => {
    const paymentPayload = JSON.parse(Buffer.from(draft.header(sig).value, "base64").toString("utf8")) as unknown;
    const j = await postJson(`${FACILITATOR}/verify`, { x402Version: 2, paymentPayload, paymentRequirements: sel.requirement.raw });
    return `isValid=${String(j.isValid)} invalidReason=${String(j.invalidReason ?? "none")}`;
  };
  log("facilitator /verify", await verifyWith(await signer.signTypedData(draft.typedData)));
  log("control: wrong key", await verifyWith(await localKeySigner(new Uint8Array(randomBytes(32))).signTypedData(draft.typedData)));

  // Step 3: the real flow. Approved automatically because this is a testnet dev tool; on the phone
  // `approve` is the cage's fingerprint sheet.
  const ledger = memoryLedger();
  const outcome = await payWithX402({ url: resourceUrl, method: "GET", headers: {} }, {
    http,
    signer,
    approve: async (q) => {
      if (!q.testnet) throw new Error("Refusing to approve a non-testnet payment in the spike.");
      log("approval asked", { origin: q.origin, amount: q.amount.amount, asset: q.amount.asset, network: q.amount.network, validBefore: q.validBefore });
      return true;
    },
    nowMs: () => Date.now(),
    randomBytes: (n) => new Uint8Array(randomBytes(n)),
  }, {
    assets: TESTNET_ASSETS,
    cap: { perPayment: money(50_000n, "USDT", NETWORK), perDay: money(100_000n, "USDT", NETWORK) },
    ledger,
  });

  log("outcome", outcome.kind);
  if (outcome.kind === "paid") {
    log("settlement", outcome.settlement ?? "none");
    log("content", outcome.response.body.slice(0, 200));
    const tx = outcome.settlement?.transaction;
    if (tx) {
      const receipt = (await rpc("eth_getTransactionReceipt", [tx])) as { status: string; blockNumber: string; from: string } | null;
      log("receipt", receipt ? { status: receipt.status, block: Number(BigInt(receipt.blockNumber)), from: receipt.from } : "not found");
      log("explorer", EXPLORER + tx);
    }
    const used = readAuthorizationState((await rpc("eth_call", [authorizationStateCall(outcome.record), "latest"])) as string);
    log("authorizationState", `used=${used}`);
    log("payer USD₮0 after", `${await tokenBalance(signer.address)} base units`);
  } else if (outcome.kind === "authorized_unconfirmed") {
    log("reason", outcome.reason);
    log("response", `${outcome.response.status} ${outcome.response.body.slice(0, 300)}`);
    log("ledger", ledger.records().map((r) => r.status).join(","));
    const blockReq = latestBlockCall();
    const block = readBlock(await rpc(blockReq.method, blockReq.params));
    const used = readAuthorizationState((await rpc("eth_call", [authorizationStateCall(outcome.record), block.number])) as string);
    const later = outcome.record.validBefore + VOID_MARGIN_SECONDS;
    log("authorizationState", `block ${Number(BigInt(block.number))} t=${block.timestamp}: used=${used}; now ${resolvePending(outcome.record, used, block.timestamp).status}; if still unused at t=${later}: ${resolvePending(outcome.record, used, later).status}`);
    if (outcome.reason.includes("insufficient") || outcome.reason.includes("balance")) {
      console.log(`\nManual step: claim test USD₮0 at https://faucet.stable.xyz for the facilitator gas key ${operator},`);
      console.log(`then: (cd packages/eval/x402-facilitator && node facilitator.mjs fund ${signer.address} 0.1), and run this again.`);
    }
  } else {
    log("detail", outcome);
  }
} finally {
  server.close();
}
