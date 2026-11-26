// The signing port, and a raw-key implementation for tests and the desktop testnet spike only.
// On the phone the signer is the WDK EVM account inside the worklet (ADR-015); the key never
// reaches this package there.
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { X402Error } from "./errors.ts";
import { checksumAddress, transferWithAuthorizationDigestBytes, type TransferWithAuthorizationTypedData } from "./eip712.ts";

export interface TypedDataSigner {
  /** Checksummed EVM address that will appear as `authorization.from`. */
  readonly address: string;
  /** Returns a 65-byte `r || s || v` signature as 0x hex, v in {27, 28}. */
  signTypedData(typedData: TransferWithAuthorizationTypedData): Promise<string>;
}

function addressOf(uncompressedPublicKey: Uint8Array): string {
  return checksumAddress("0x" + bytesToHex(keccak_256(uncompressedPublicKey.slice(1)).slice(12)));
}

/** Test and desktop-spike signer from a raw secp256k1 key. Never used with a mainnet key. */
export function localKeySigner(privateKey: Uint8Array): TypedDataSigner {
  if (privateKey.length !== 32) throw new X402Error("bad_input", "A secp256k1 key is 32 bytes.");
  const address = addressOf(secp256k1.getPublicKey(privateKey, false));
  return {
    address,
    async signTypedData(td) {
      const digest = transferWithAuthorizationDigestBytes(td);
      // noble's "recovered" format is recovery || r || s; Ethereum wants r || s || (27 + recovery).
      const sig = secp256k1.sign(digest, privateKey, { prehash: false, format: "recovered" });
      return "0x" + bytesToHex(sig.slice(1)) + (27 + sig[0]!).toString(16);
    },
  };
}

/** The address that produced a signature over this authorization, checksummed. */
export function recoverTypedDataSigner(td: TransferWithAuthorizationTypedData, signature: string): string {
  if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) throw new X402Error("bad_input", "A signature is 65 bytes of hex.");
  const raw = hexToBytes(signature.slice(2));
  const v = raw[64]!;
  const recovery = v >= 27 ? v - 27 : v;
  const recovered = new Uint8Array(65);
  recovered[0] = recovery;
  recovered.set(raw.slice(0, 64), 1);
  const pub = secp256k1.recoverPublicKey(recovered, transferWithAuthorizationDigestBytes(td), { prehash: false });
  return addressOf(secp256k1.Point.fromBytes(pub).toBytes(false));
}
