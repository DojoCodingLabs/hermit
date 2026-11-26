// EIP-712 hashing for exactly one struct, EIP-3009 TransferWithAuthorization. Narrow on purpose:
// the payments package signs nothing else, so there is no general typed-data encoder to misuse.
import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { X402Error } from "./errors.ts";

export interface Eip712Domain {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: string;
}

/** EIP-3009 authorization. Integers are decimal strings, as x402 sends them on the wire. */
export interface TransferAuthorization {
  from: string;
  to: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: string;
}

/** The shape a signer port receives. Matches what EVM wallets (WDK, viem, ethers) take for `signTypedData`. */
export interface TransferWithAuthorizationTypedData {
  domain: Eip712Domain;
  primaryType: "TransferWithAuthorization";
  message: TransferAuthorization;
}

export const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  EIP712Domain: [
    { name: "name", type: "string" },
    { name: "version", type: "string" },
    { name: "chainId", type: "uint256" },
    { name: "verifyingContract", type: "address" },
  ],
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

const keccak = (b: Uint8Array) => keccak_256(b);
const DOMAIN_TYPEHASH = keccak(utf8ToBytes("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"));
const TWA_TYPEHASH = keccak(
  utf8ToBytes("TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"),
);

export function isAddress(text: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(text);
}

function word(n: bigint): Uint8Array {
  if (n < 0n || n >= 1n << 256n) throw new X402Error("bad_input", "uint256 out of range.");
  return hexToBytes(n.toString(16).padStart(64, "0"));
}

function uint(text: string | number): Uint8Array {
  const s = String(text);
  if (!/^\d+$/.test(s)) throw new X402Error("bad_input", `"${s}" is not an unsigned integer.`);
  return word(BigInt(s));
}

function address(text: string): Uint8Array {
  if (!isAddress(text)) throw new X402Error("bad_input", `"${text}" is not an EVM address.`);
  return concatBytes(new Uint8Array(12), hexToBytes(text.slice(2).toLowerCase()));
}

function bytes32(text: string): Uint8Array {
  if (!/^0x[0-9a-fA-F]{64}$/.test(text)) throw new X402Error("bad_input", "Nonce must be 32 bytes of hex.");
  return hexToBytes(text.slice(2));
}

function domainHash(d: Eip712Domain): Uint8Array {
  return keccak(concatBytes(DOMAIN_TYPEHASH, keccak(utf8ToBytes(d.name)), keccak(utf8ToBytes(d.version)), uint(d.chainId), address(d.verifyingContract)));
}

export function domainSeparator(d: Eip712Domain): string {
  return "0x" + bytesToHex(domainHash(d));
}

export function transferWithAuthorizationDigestBytes(td: TransferWithAuthorizationTypedData): Uint8Array {
  const m = td.message;
  const structHash = keccak(
    concatBytes(TWA_TYPEHASH, address(m.from), address(m.to), uint(m.value), uint(m.validAfter), uint(m.validBefore), bytes32(m.nonce)),
  );
  return keccak(concatBytes(Uint8Array.of(0x19, 0x01), domainHash(td.domain), structHash));
}

/** The 32-byte hash an EVM key signs for this authorization (what `ecrecover` checks on chain). */
export function transferWithAuthorizationDigest(td: TransferWithAuthorizationTypedData): string {
  return "0x" + bytesToHex(transferWithAuthorizationDigestBytes(td));
}

/** EIP-55 mixed-case checksum. */
export function checksumAddress(text: string): string {
  if (!isAddress(text)) throw new X402Error("bad_input", `"${text}" is not an EVM address.`);
  const lower = text.slice(2).toLowerCase();
  const hash = bytesToHex(keccak(utf8ToBytes(lower)));
  let out = "0x";
  for (let i = 0; i < 40; i++) out += parseInt(hash[i]!, 16) >= 8 ? lower[i]!.toUpperCase() : lower[i]!;
  return out;
}

export function sameAddress(a: string, b: string): boolean {
  return isAddress(a) && isAddress(b) && a.toLowerCase() === b.toLowerCase();
}
