const REDACTED = "[secret]";

/**
 * A token, key or form body with a secret in it. Printing, string interpolation and JSON all show
 * "[secret]"; only `reveal()` gives the value, and only the app's transport adapter calls it, at send time.
 */
export class Secret {
  readonly #value: string;

  constructor(value: string) {
    this.#value = value;
  }

  reveal(): string {
    return this.#value;
  }

  toString(): string {
    return REDACTED;
  }

  toJSON(): string {
    return REDACTED;
  }

  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return REDACTED;
  }
}

/** Replaces every occurrence of the given secret values in text (a response that echoes a token). */
export function scrub(text: string, secrets: readonly string[]): string {
  let out = text;
  // Short values would blank out ordinary words; real tokens and keys are long.
  for (const s of secrets) if (s.length >= 6) out = out.split(s).join(REDACTED);
  return out;
}

/** Base64 (standard alphabet, padded) of UTF-8 text. Platform-free: no btoa or Buffer. */
export function base64(bytes: Uint8Array): string {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const [a, b, c] = [bytes[i] as number, bytes[i + 1], bytes[i + 2]];
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    out += A[(n >> 18) & 63]! + A[(n >> 12) & 63]! + (b === undefined ? "=" : A[(n >> 6) & 63]!) + (c === undefined ? "=" : A[n & 63]!);
  }
  return out;
}

export function base64url(bytes: Uint8Array): string {
  return base64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
