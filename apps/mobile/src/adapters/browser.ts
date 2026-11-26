// SL-53 (HM-WEB-02): the in-app browser's adapter. The native module (modules/hermit-browser) is one WebView per task;
// this wires its events to the host counter (FR-PRIV-02) and gives the runtime Hermit's own identity as the requester
// a login's values go to. Without the module (an older APK) there are no web tasks.
import type { HermitPorts } from "@hermit/runtime";
import { sha256Hex, type OneTimeCodePort } from "@hermit/core";
import { HermitBrowser } from "../../modules/hermit-browser";
import { HermitSmsConsent } from "../../modules/hermit-sms-consent";
import { createSmsCodeSource } from "../sms-code";
import { translate } from "../i18n";
import { countOutbound } from "./net";
import { vaultOnScreen } from "./vault";

export const browserAvailable = () => HermitBrowser !== null;

/** Whether this phone's WebView keeps each site in its own profile (otherwise the shared store is cleared per task). */
export const browserMultiProfile = () => {
  try {
    return HermitBrowser?.status().multiProfile === true;
  } catch {
    return false;
  }
};

/** Whether this phone's WebView has the web message channel the recorder posts on (no channel, no recording). */
export const browserRecorder = () => {
  try {
    return HermitBrowser?.status().recorder === true;
  } catch {
    return false;
  }
};

/** The site's WebView profile name: never the origin itself, so the profile list on disk names no site. */
export const siteProfile = (origin: string) => `site_${sha256Hex(`hermit.browser.v1|${origin}`).slice(0, 32)}`;

/** Every request the WebView makes is counted by host, like every fetch Hermit makes (FR-PRIV-02). */
export const countBrowserRequest = (url: string) => {
  if (/^https?:\/\//i.test(url)) countOutbound(url);
};

/** Clears a site's cookies and storage (after a task unless the user keeps it, or on the user's tap). */
export async function clearSiteData(origin: string): Promise<boolean> {
  if (!HermitBrowser) return false;
  return HermitBrowser.clearSite(browserMultiProfile() ? siteProfile(origin) : "shared").catch(() => false);
}

export function browserPorts(more: OneTimeCodePort[] = []): HermitPorts["browser"] {
  if (!HermitBrowser) return undefined;
  let identity = "android://unknown@io.dojocoding.hermit";
  try {
    identity = HermitBrowser.status().identity;
  } catch {
    // Keep the placeholder: a login then names an identity the signed prompt shows as unknown.
  }
  // SL-56b (Q138): a sign-in's one-time code from the SMS the user allows in Android's consent dialog, and from the
  // sources the caller adds: the site's email in a connected Gmail account (SL-48, Q141: Gmail only).
  const codes = [...(HermitSmsConsent ? [createSmsCodeSource(HermitSmsConsent, Date.now)] : []), ...more];
  return { requester: identity, onScreen: vaultOnScreen, copy: (lang, key, vars) => translate(lang, key, vars), ...(codes.length ? { codes } : {}) };
}
