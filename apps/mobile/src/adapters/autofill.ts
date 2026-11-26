import type { FormKind, LoginIndexEntry } from "@hermit/core";
import type { NativeFillRequest } from "@hermit/runtime";
import { HermitAutofill } from "../../modules/hermit-autofill";

/**
 * SL-35: the phone side of form filling (apps/mobile/modules/hermit-autofill). The module is optional, so a phone
 * on an APK built before it gets "unavailable" answers instead of a crash.
 */

/** The runtime's autofill port: the kinds-only profile index the service reads. Never a value. */
export const autofillPort = {
  setProfileIndex(index: { kinds: FormKind[]; sensitive: FormKind[] }) {
    HermitAutofill?.setProfileIndex(index.kinds, index.sensitive);
  },
  /** SL-36: the vault's logins by id hash, name and exact origins. Never a username or a password. */
  setLoginIndex(index: LoginIndexEntry[]) {
    // An APK built before SL-36 has the module without this function: the index waits for the next build.
    if (typeof HermitAutofill?.setLoginIndex === "function") HermitAutofill.setLoginIndex(JSON.stringify(index));
  },
};

/** HM-SET-01: whether Hermit is the selected autofill service; undefined when this phone or build has no autofill. */
export function autofillSelected(): boolean | undefined {
  if (!HermitAutofill) return undefined;
  const s = HermitAutofill.status();
  return s.supported ? s.selected : undefined;
}

/** Android's "use Hermit?" picker, or the Passwords, passkeys and autofill page once Hermit is selected. */
export function openAutofillSettings(): void {
  HermitAutofill?.openSettings();
}

export type PendingFill = { kind: "request"; request: NativeFillRequest } | { kind: "ended" } | { kind: "no_module" };

/** The fill waiting for HM-FORM-01. The JSON is the module's own; it is checked again by the runtime's prepare. */
export function pendingFill(id: string): PendingFill {
  if (!HermitAutofill) return { kind: "no_module" };
  const json = HermitAutofill.pendingFill(id);
  if (!json) return { kind: "ended" };
  try {
    const o = JSON.parse(json) as NativeFillRequest & { appLabel?: string | null; origin?: string | null; web?: Array<{ domain: string; scheme?: string | null }> };
    const web = (o.web ?? []).map((w) => (w.scheme ? { domain: w.domain, scheme: w.scheme } : { domain: w.domain }));
    const base = { id: o.id, packageName: o.packageName, certDigests: o.certDigests, web, origin: o.origin ?? "", ...(o.appLabel ? { appLabel: o.appLabel } : {}) };
    // SL-36: a login names the vault item the user picked by its id hash; the runtime checks it against the vault.
    const request: NativeFillRequest = o.kind === "login" ? { ...base, kind: "login", item: o.item, fields: o.fields } : { ...base, fields: o.fields };
    return { kind: "request", request };
  } catch {
    return { kind: "ended" };
  }
}

/** Hands the approved values to Android and goes back to the form. False when the request already ended. */
export function completeFill(id: string, values: Record<string, string>): boolean {
  return HermitAutofill?.completeFill(id, values) ?? false;
}

/** Nothing is filled; back to the form. */
export function cancelFill(id: string): void {
  HermitAutofill?.cancelFill(id);
}
