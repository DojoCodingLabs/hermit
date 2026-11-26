import { describe, expect, it } from "vitest";
import { sha256 } from "@noble/hashes/sha2.js";
import { utf8ToBytes } from "@noble/hashes/utils.js";
import {
  base64url,
  fromBase64url,
  normalizeProviderTokens,
  openCode,
  openFromRelay,
  openSealed,
  parseProviderState,
  parseTokenRequest,
  issueProviderState,
  parseStartRequest,
  startRequestBody,
  verifyProviderState,
  relayKeyPair,
  sealCode,
  sealForPhone,
  sealTokens,
  sealWithKey,
  utf8FromBytes,
  verifierMatches,
} from "../src/relay-protocol.ts";

const bytes = (n: number, fill: number) => new Uint8Array(n).fill(fill);
const text = (b: Uint8Array | undefined) => (b ? utf8FromBytes(b) : undefined);
const SEAL_KEY = bytes(32, 7);
const NOW = 1_800_000_000_000;

describe("relay crypto (FR-CONN-07)", () => {
  it("base64url round-trips and refuses anything outside the alphabet", () => {
    const b = Uint8Array.from([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    expect(fromBase64url(base64url(b))).toEqual(b);
    expect(fromBase64url("a+b/")).toBeUndefined();
    expect(fromBase64url("abc=")).toBeUndefined();
    expect(fromBase64url("a")).toBeUndefined();
  });

  it("only the phone's key for this sign-in opens what the relay sealed for it", () => {
    const phone = relayKeyPair(bytes(32, 1));
    const other = relayKeyPair(bytes(32, 2));
    const sealed = sealForPhone(phone.publicKey, utf8ToBytes("tokens"), utf8ToBytes("aad"), bytes(32, 3));
    expect(text(openFromRelay(phone.secretKey, sealed, utf8ToBytes("aad")))).toBe("tokens");
    expect(openFromRelay(other.secretKey, sealed, utf8ToBytes("aad"))).toBeUndefined();
    expect(openFromRelay(phone.secretKey, sealed, utf8ToBytes("other aad"))).toBeUndefined();
  });

  it("a single flipped bit anywhere in a sealed message is refused", () => {
    const phone = relayKeyPair(bytes(32, 1));
    const sealed = sealForPhone(phone.publicKey, utf8ToBytes("the access token"), new Uint8Array(), bytes(32, 3));
    for (const i of [0, 31, 32, 40, sealed.length - 1]) {
      const bad = Uint8Array.from(sealed);
      bad[i] = (bad[i] as number) ^ 1;
      expect(openFromRelay(phone.secretKey, bad, new Uint8Array())).toBeUndefined();
    }
    expect(openFromRelay(phone.secretKey, sealed.slice(0, 40), new Uint8Array())).toBeUndefined();
  });

  it("the ciphertext does not contain the plaintext", () => {
    const phone = relayKeyPair(bytes(32, 1));
    const sealed = sealForPhone(phone.publicKey, utf8ToBytes("xoxb-secret-token-value"), new Uint8Array(), bytes(32, 3));
    expect(Array.from(sealed, (c) => String.fromCharCode(c)).join("")).not.toContain("xoxb");
  });

  it("the relay's own seal opens only with its key, purpose and associated data", () => {
    const sealed = sealWithKey(SEAL_KEY, "code", utf8ToBytes("hello"), utf8ToBytes("a"), bytes(24, 9));
    expect(text(openSealed(SEAL_KEY, "code", sealed, utf8ToBytes("a")))).toBe("hello");
    expect(openSealed(bytes(32, 8), "code", sealed, utf8ToBytes("a"))).toBeUndefined();
    expect(openSealed(SEAL_KEY, "other", sealed, utf8ToBytes("a"))).toBeUndefined();
  });

  it("checks a PKCE verifier against its S256 challenge", () => {
    const verifier = base64url(bytes(32, 5));
    const challenge = base64url(sha256(utf8ToBytes(verifier)));
    expect(verifierMatches(verifier, challenge)).toBe(true);
    expect(verifierMatches(base64url(bytes(32, 6)), challenge)).toBe(false);
    expect(verifierMatches("short", challenge)).toBe(false);
  });
});

describe("relay protocol messages", () => {
  const key = base64url(relayKeyPair(bytes(32, 1)).publicKey);
  const state = base64url(bytes(24, 4));
  const challenge = base64url(sha256(utf8ToBytes("v".repeat(43))));

  const EXP = NOW + 600_000;
  const issued = () => issueProviderState(SEAL_KEY, { provider: "slack", state, challenge, key }, EXP);

  it("the issued state carries the phone's state, PKCE challenge and key, an expiry and the relay's MAC; nothing else", () => {
    const param = issued();
    expect(param.startsWith(`h2.slack.${state}.${challenge}.${key}.`)).toBe(true);
    expect(parseProviderState(param)).toMatchObject({ provider: "slack", state, challenge, key, expiresAt: EXP });
    expect(verifyProviderState(SEAL_KEY, param, NOW)).toMatchObject({ ok: true, state: { provider: "slack", state, challenge, key } });
  });

  it("a state this relay did not issue is refused: unsigned, signed by another relay, or a forged MAC", () => {
    const foreign = issueProviderState(bytes(32, 8), { provider: "slack", state, challenge, key }, EXP);
    const forged = `${issued().slice(0, issued().lastIndexOf("."))}.${base64url(bytes(32, 0))}`;
    for (const bad of [foreign, forged, `h1.slack.${state}.${challenge}.${key}`]) expect(verifyProviderState(SEAL_KEY, bad, NOW)).toEqual({ ok: false, error: "invalid_request" });
  });

  it("an issued state with another challenge, key, state, provider or expiry spliced in is refused", () => {
    const param = issued();
    const other = base64url(sha256(utf8ToBytes("w".repeat(43))));
    const otherKey = base64url(relayKeyPair(bytes(32, 9)).publicKey);
    for (const bad of [
      param.replace(challenge, other),
      param.replace(key, otherKey),
      param.replace(state, base64url(bytes(24, 5))),
      param.replace(".slack.", ".notion."),
      param.replace(`.${Math.floor(EXP / 1000).toString(36)}.`, `.${Math.floor((EXP + 3_600_000) / 1000).toString(36)}.`),
    ]) expect(verifyProviderState(SEAL_KEY, bad, NOW)).toEqual({ ok: false, error: "invalid_request" });
  });

  it("an expired issued state is refused", () => {
    expect(verifyProviderState(SEAL_KEY, issued(), EXP + 1)).toEqual({ ok: false, error: "expired" });
  });

  it("a malformed provider state is refused", () => {
    const param = issued();
    for (const bad of ["", param.replace("h2.", "h1."), param.replace(".slack.", ".Slack."), param.slice(0, param.lastIndexOf(".")), `${param}.extra`, param.replace(state, "short"), `${param}\n`]) {
      expect(parseProviderState(bad)).toBeUndefined();
      expect(verifyProviderState(SEAL_KEY, bad, NOW).ok).toBe(false);
    }
  });

  it("reads a start request strictly", () => {
    const ok = { protocol: "hermit-relay-1", provider: "slack", state, challenge, key };
    expect(parseStartRequest(JSON.stringify(ok))).toEqual({ provider: "slack", state, challenge, key });
    expect(parseStartRequest(startRequestBody({ provider: "slack", state, challenge, key }))).toEqual({ provider: "slack", state, challenge, key });
    expect(parseStartRequest(JSON.stringify({ ...ok, extra: 1 }))).toBeUndefined();
    expect(parseStartRequest(JSON.stringify({ ...ok, key: "short" }))).toBeUndefined();
  });

  it("a sealed code opens until it expires, then says expired", () => {
    const sealed = sealCode(SEAL_KEY, { provider: "slack", state, challenge, key, code: "abc", expiresAt: NOW + 600_000 }, bytes(24, 2));
    expect(openCode(SEAL_KEY, sealed, NOW)).toEqual({ ok: true, claims: { provider: "slack", state, challenge, key, code: "abc", expiresAt: NOW + 600_000 } });
    expect(openCode(SEAL_KEY, sealed, NOW + 600_001)).toEqual({ ok: false, error: "expired" });
  });

  it("a tampered sealed code is refused", () => {
    const sealed = sealCode(SEAL_KEY, { provider: "slack", state, challenge, key, code: "abc", expiresAt: NOW + 1 }, bytes(24, 2));
    const flipped = sealed.slice(0, 30) + (sealed[30] === "A" ? "B" : "A") + sealed.slice(31);
    expect(openCode(SEAL_KEY, flipped, NOW)).toEqual({ ok: false, error: "invalid_request" });
    expect(openCode(SEAL_KEY, "not-base64!", NOW)).toEqual({ ok: false, error: "invalid_request" });
    expect(openCode(bytes(32, 1), sealed, NOW)).toEqual({ ok: false, error: "invalid_request" });
  });

  it("reads the token request strictly: every field, no extras", () => {
    const ok = { protocol: "hermit-relay-1", provider: "slack", code: "c".repeat(40), code_verifier: "v".repeat(43), redirect_uri: "https://relay.example.org/v1/callback" };
    expect(parseTokenRequest(JSON.stringify(ok))).toEqual(ok);
    expect(parseTokenRequest(JSON.stringify({ ...ok, protocol: "hermit-relay-0" }))).toBeUndefined();
    expect(parseTokenRequest(JSON.stringify({ ...ok, client_secret: "x" }))).toBeUndefined();
    expect(parseTokenRequest(JSON.stringify({ ...ok, code_verifier: "short" }))).toBeUndefined();
    expect(parseTokenRequest("{")).toBeUndefined();
    expect(parseTokenRequest(`{"__proto__":{"x":1}}`)).toBeUndefined();
  });

  it("keeps only the OAuth token fields from a provider's answer", () => {
    expect(normalizeProviderTokens({ access_token: "a", token_type: "bearer", refresh_token: "r", expires_in: 3600, scope: "x y", team: { id: "T1" }, id_token: "j" })).toEqual({
      access_token: "a", token_type: "bearer", refresh_token: "r", expires_in: 3600, scope: "x y", id_token: "j",
    });
    expect(normalizeProviderTokens({ ok: false, error: "invalid_code" })).toBeUndefined();
    expect(normalizeProviderTokens({ ok: true, access_token: "xoxb-1", token_type: "bot" })).toEqual({ access_token: "xoxb-1", token_type: "bot" });
    expect(normalizeProviderTokens({ token_type: "bearer" })).toBeUndefined();
    expect(normalizeProviderTokens({ access_token: "a", expires_in: -5 })).toEqual({ access_token: "a" });
  });

  it("tokens sealed for the phone carry the provider, the client and the phone's state", () => {
    const phone = relayKeyPair(bytes(32, 1));
    const sealed = sealTokens({ provider: "slack", clientId: "123.456", state, key: base64url(phone.publicKey), tokens: { access_token: "a" } }, bytes(32, 3));
    expect(sealed).toBeTypeOf("string");
    expect(sealed).not.toContain("123.456");
    expect(sealTokens({ provider: "slack", clientId: "1", state, key: "not-a-key", tokens: { access_token: "a" } }, bytes(32, 3))).toBeUndefined();
  });
});
