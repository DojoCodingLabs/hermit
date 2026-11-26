// The wallet worklet (SL-17 spike, SL-38; docs/research/wdk-worklet-spike.md). Tether WDK runs in its own
// react-native-bare-kit Worklet, next to QVAC's, and keeps the seed; this side speaks the IPC protocol from
// @hermit/payments and checks every answer it gets back. Stable testnet only.
//
// This file is the adapter boundary (Q109): the wallet service (@hermit/runtime) sees only `WalletWorkletPort`
// (./wallet.ts), so the WDK source can move from this worklet to Dojo's fork of Tether's React Native host later
// without touching wallet logic.
import { Worklet } from "react-native-bare-kit";
import { createWalletClient, type WalletClient } from "@hermit/payments";

let bundle: string | null = null;
try {
  // Generated at `expo prebuild` by plugins/with-wallet-worklet.js (or worklets/wallet/build.mjs, the fallback) and
  // gitignored. Metro treats a require inside try/catch as optional, so a build without it still bundles and the
  // wallet screens say the wallet isn't in this build.
  bundle = require("../../worklets/wallet/dist/wallet.bundle.cjs") as string;
} catch {
  bundle = null;
}

export function walletBundleAvailable(): boolean {
  return typeof bundle === "string" && bundle.length > 0;
}

export interface WalletWorklet {
  client: WalletClient;
  /** False once the worklet stopped, broke or was told to stop. */
  alive(): boolean;
  stop(): Promise<void>;
}

export function startWalletWorklet(): WalletWorklet {
  if (!walletBundleAvailable()) throw new Error("No wallet bundle in this build.");
  const worklet = new Worklet();
  let alive = true;
  // The first argument's extension must be .bundle for bare-kit to read the source as a bundle.
  worklet.start("/wallet.bundle", bundle!);
  const client = createWalletClient({ write: (bytes) => worklet.IPC.write(bytes) });
  const dead = (code: string) => {
    alive = false;
    client.fail(code);
  };
  worklet.IPC.on("data", (chunk) => client.receive(chunk as Uint8Array));
  worklet.IPC.on("error", () => dead("worklet_error"));
  worklet.IPC.on("close", () => dead("worklet_stopped"));
  return {
    client,
    alive: () => alive,
    async stop() {
      if (!alive) return;
      try {
        await client.call("close");
      } catch {
        // Already gone; terminate anyway.
      }
      dead("worklet_stopped");
      worklet.terminate();
    },
  };
}

/** The product wallet's worklet: started on first use, stopped when the wallet locks, Delete everything or a crash. */
let shared: WalletWorklet | null = null;

export function sharedWalletClient(): WalletClient {
  if (!shared || !shared.alive()) shared = startWalletWorklet();
  return shared.client;
}

export async function stopSharedWalletWorklet(): Promise<void> {
  const w = shared;
  shared = null;
  await w?.stop();
}
