export type X402ErrorCode =
  | "not_402"
  | "malformed"
  | "version"
  | "unsupported_network"
  | "unsupported_asset"
  | "unsupported_scheme"
  | "domain_mismatch"
  | "timeout_too_long"
  /** SL-41: the 402 names a resource on another origin than the address the user asked for. */
  | "host_mismatch"
  | "bad_input";

/** A refusal with a machine reason the approval sheet and the log can show (US-PAY-07). */
export class X402Error extends Error {
  readonly code: X402ErrorCode;
  constructor(code: X402ErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.name = "X402Error";
    this.code = code;
  }
}
