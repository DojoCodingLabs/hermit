/**
 * SL-55 (HM-CONN-04): the pure parts of the connect screen, tested on Node. The rules (discovery order, risk, the test
 * call, the fingerprint, the log) live in @hermit/connectors behind the runtime; this only decides what the screen says.
 */

/**
 * How the screen starts from its route params. Chat provenance needs the one-time offer id the runtime made for the
 * chat's offer (and the runtime checks it again); a deep link with only `request` prefills the field as the user's own
 * typing, which their tap on Find confirms. Anything else starts empty.
 */
export function startFrom(params: { request?: unknown; offer?: unknown }): { text: string; origin: "typed" | "chat"; offerId?: string } {
  const text = typeof params.request === "string" ? params.request : "";
  if (text && typeof params.offer === "string" && params.offer) return { text, origin: "chat", offerId: params.offer };
  return { text, origin: "typed" };
}

/** A change that adds more than one character at once is a paste; either way it is the user's own act. */
export const inputOrigin = (before: string, after: string): "typed" | "pasted" => (after.length - before.length > 1 ? "pasted" : "typed");

interface ReviewLike {
  signIn: { available: boolean; needs: "key" | "basic" | "none" };
  testable: string[];
  keySaved: boolean;
  tested?: { result: string };
}

/**
 * Why Install can't run yet, as the copy key's last part, in the order the user fixes them; undefined when it can.
 * The runtime checks the same things again (and asks for the fingerprint); this only explains the disabled button.
 */
export function installBlocker(review: ReviewLike): "sign_in_unavailable" | "no_key" | "not_tested" | "test_failed" | undefined {
  if (!review.signIn.available) return "sign_in_unavailable";
  if (!review.keySaved) return "no_key";
  if (review.testable.length === 0) return undefined;
  if (!review.tested) return "not_tested";
  return review.tested.result === "ok" ? undefined : "test_failed";
}

interface Reading {
  kind: "bearer" | "header_key" | "query_key" | "basic";
  name?: string;
  prefix?: string;
}

/** The sign-in as one sentence's key and values: "Your key goes in the X-Api-Key header" (SL-52 item 5). */
export function signInSentence(r: Reading | undefined): { key: string; vars: Record<string, string> } {
  if (!r) return { key: "HM-CONN-04.signIn.none", vars: {} };
  if (r.kind === "bearer") return { key: "HM-CONN-04.signIn.bearer", vars: {} };
  if (r.kind === "basic") return { key: "HM-CONN-04.signIn.basic", vars: {} };
  if (r.kind === "query_key") return { key: "HM-CONN-04.signIn.query", vars: { name: r.name ?? "" } };
  return r.prefix ? { key: "HM-CONN-04.signIn.headerPrefix", vars: { name: r.name ?? "", prefix: r.prefix } } : { key: "HM-CONN-04.signIn.header", vars: { name: r.name ?? "" } };
}

/** The operations on by default: none. A connector the user installs does only what they turn on (US-CONN-05). */
export const defaultEnabled = (): string[] => [];
