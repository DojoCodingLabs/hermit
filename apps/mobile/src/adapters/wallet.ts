import * as SecureStore from "expo-secure-store";
import { fetch as expoFetch } from "expo/fetch";
import {
  formatMoney, HISTORY, money, parseWalletRecord, READ_METHODS, rpcBody, rpcResult, WALLET_KEY, WALLET_NETWORK, WALLET_RECORD_KEY, type WalletKeyPort,
} from "@hermit/core";
import {
  createInWorklet, openWallet, quoteTransferFee, readBalance, restoreInWorklet, revealWords, sendTransferWithAuthorization, transferReceipt, workletSigner,
} from "@hermit/payments";
import type { PayWorkletPort, WalletChainPort, WalletRecordPort, WalletWorkletPort } from "@hermit/runtime";
import { HermitVault } from "../../modules/hermit-vault";
import { landedAt } from "../mcp-request";
import { decodeBody, readCapped } from "../web-body";
import { counted, countOutbound } from "./net";
import { vaultOnScreen, vaultRandom, wrappedKeyPort } from "./vault";
import { sharedWalletClient, stopSharedWalletWorklet, walletBundleAvailable } from "./wallet-worklet";
import { LIST_MIN_DECIMALS } from "../wallet-view";

/**
 * SL-38 (FR-PAY-01): the wallet's phone adapters.
 *
 * - The wallet key: a random 32-byte key stored only through expo-secure-store with `requireAuthentication` under its
 *   own keychain service (`hermit.wallet`), the vault's pattern: an AES-GCM Keystore key that needs a strong biometric
 *   for every use, can't be exported and is invalidated when fingerprints change.
 * - The record: one SecureStore entry (`hermit.wallet.v1`, in SECRET_KEYS so Delete everything removes it) with the
 *   sealed seed, the address and two dates. Not the database, so the seed's ciphertext never sits next to app data.
 * - The worklet: Tether WDK in its own worklet (./wallet-worklet). Its one network host, Stable testnet's RPC, is
 *   counted for the privacy screen whenever a balance is read (FR-PRIV-02).
 */

export const walletKeyPort: WalletKeyPort = wrappedKeyPort(WALLET_KEY);

export const walletRecordPort: WalletRecordPort = {
  async read() {
    return (await SecureStore.getItemAsync(WALLET_RECORD_KEY)) ?? undefined;
  },
  write: (text) => SecureStore.setItemAsync(WALLET_RECORD_KEY, text),
  remove: () => SecureStore.deleteItemAsync(WALLET_RECORD_KEY),
};

export const walletWorkletPort: WalletWorkletPort = {
  create: (req) => createInWorklet(sharedWalletClient(), req),
  restore: (req) => restoreInWorklet(sharedWalletClient(), req),
  reveal: (req) => revealWords(sharedWalletClient(), req),
  async balance(address) {
    countOutbound(WALLET_NETWORK.rpcOrigin);
    return { usdt0: (await readBalance(sharedWalletClient(), address)).usdt0 };
  },
  close: stopSharedWalletWorklet,
};

/**
 * SL-40 (US-PAY-05): the worklet's payment methods, for @hermit/runtime's payments service. The fee and the balance
 * are read for a public address with no key; `open` unseals the wallet with the key the service just unwrapped behind
 * its own fingerprint; `sign` recovers the signature and refuses any signer but the wallet; `submit` recovers it again
 * before sending and the worklet sends only transferWithAuthorization to USD₮0. Every call that reaches Stable
 * testnet's RPC is counted for the privacy screen (FR-PRIV-02). `close` stops the worklet, which drops the open seed.
 */
export const payWorkletPort: PayWorkletPort = {
  balance(address) {
    countOutbound(WALLET_NETWORK.rpcOrigin);
    return readBalance(sharedWalletClient(), address);
  },
  quoteFee(req) {
    countOutbound(WALLET_NETWORK.rpcOrigin);
    return quoteTransferFee(sharedWalletClient(), req);
  },
  async open(req) {
    const info = await openWallet(sharedWalletClient(), req);
    return { address: info.address };
  },
  sign: (address, typedData) => workletSigner(sharedWalletClient(), address).signTypedData(typedData),
  submit(req) {
    countOutbound(WALLET_NETWORK.rpcOrigin);
    return sendTransferWithAuthorization(sharedWalletClient(), req);
  },
  receipt(hash) {
    countOutbound(WALLET_NETWORK.rpcOrigin);
    return transferReceipt(sharedWalletClient(), hash);
  },
  close: stopSharedWalletWorklet,
};

const RPC_TIMEOUT_MS = 20_000;
const rpcSend = counted(expoFetch as unknown as (url: string, init?: never) => ReturnType<typeof expoFetch>);
let rpcId = 0;

/**
 * SL-39 (FR-PAY-02): Stable testnet's RPC for HM-PAY-03's history, read-only. Only `eth_blockNumber` and `eth_getLogs`
 * are sent (`rpcBody` refuses anything else, and so does this), as a POST to the one fixed origin, through `counted`
 * so the host shows on the privacy screen (HM-SET-02). No redirects, no cookies, a 20 s timeout and a size cap; the
 * answer must carry the request's id, and an error keeps only its code.
 */
export const walletChainPort: WalletChainPort = {
  async call(method, params) {
    if (!(READ_METHODS as readonly string[]).includes(method)) throw new TypeError("refused: not a read method");
    const id = ++rpcId;
    const url = WALLET_NETWORK.rpcOrigin;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);
    try {
      const res = await rpcSend(url, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: rpcBody(id, method, params),
        redirect: "manual",
        credentials: "omit",
        signal: controller.signal,
      } as never);
      if (!landedAt(url, res.url, res.redirected) || res.status !== 200) throw new TypeError("refused: the RPC answered with " + res.status);
      const reader = res.body?.getReader();
      const { bytes, truncated } = reader ? await readCapped(reader, HISTORY.maxResponseChars) : { bytes: new Uint8Array(), truncated: false };
      if (truncated) {
        controller.abort();
        throw new TypeError("refused: the RPC's answer is too large");
      }
      return rpcResult(decodeBody(bytes, "application/json; charset=utf-8"), id);
    } finally {
      clearTimeout(timer);
    }
  },
};

/** HM-PAY-04: the address is public, so its copy is a plain clip (not marked sensitive) with no clear timer. */
export const copyAddress = (address: string) => HermitVault.copyPlain(address);

/** HM-ACT-02: a log entry's hashes and signature are public metadata, copied the same way (a plain clip). */
export const copyLogValue = (value: string) => HermitVault.copyPlain(value);

/** The wallet port for createHermit, or undefined when this build has no wallet bundle (the screens say so). */
export function walletPorts() {
  if (!walletBundleAvailable()) return undefined;
  return { key: walletKeyPort, record: walletRecordPort, worklet: walletWorkletPort, random: vaultRandom, onScreen: vaultOnScreen, chain: walletChainPort };
}

/** Delete everything's `destroy_wallet_key` step (idempotent): the worklet stops, then the key and its Keystore key go. */
export async function destroyWalletKey(): Promise<void> {
  await stopSharedWalletWorklet().catch(() => {});
  await walletKeyPort.destroy();
}

/**
 * US-SET-03: the wallet's balance, formatted, when it holds money, so Delete everything warns first. A wallet whose
 * balance can't be read (offline) is warned about too, as "an amount Hermit can't check": failing open would erase
 * money without a word.
 */
export async function walletBalanceForErase(locale: string, unknown: string): Promise<string | undefined> {
  // Fail closed (security review): a read that throws, or a record there but unreadable, may still hold funds.
  let text: string | null;
  try {
    text = await SecureStore.getItemAsync(WALLET_RECORD_KEY);
  } catch {
    return unknown;
  }
  if (!text) return undefined;
  const rec = parseWalletRecord(text);
  if (!rec) return unknown;
  if (!walletBundleAvailable()) return unknown;
  try {
    const usdt0 = await walletWorkletPort.balance(rec.address);
    if (usdt0.usdt0 === 0n) return undefined;
    return formatMoney(money(usdt0.usdt0, WALLET_NETWORK.asset, WALLET_NETWORK.network), locale, 2, LIST_MIN_DECIMALS);
  } catch {
    return unknown;
  }
}
