/**
 * HM-CONN-05's relay choices (SL-57, US-CONN-09, US-CONN-10, PDR-022): the user's own relay, by an address they type,
 * and Dojo's relay, off by default and only offered once Dojo has one (its URL comes from the app's build config,
 * unset until Q43). Screen-only: no skill reaches it, so nothing the model read can point sign-ins somewhere else.
 * The sign-in itself is `beginRelaySignIn` and `completeRelaySignIn` in @hermit/connectors.
 *
 * And the user's own OAuth client IDs (US-CONN-08, PDR-021) for the providers that sign in from the phone with PKCE
 * and no secret (Google and Microsoft, for email: SL-48), with Dojo's from the build config once Q43's apps exist. A
 * client ID is a public identifier, not a secret, so it sits in the settings table like the relay address.
 */
import {
  discoverRelay,
  oauthProviders,
  parseRelayBase,
  validateClientId,
  type ConnectorTransport,
  type SignInConfig,
  type SignInSettings,
} from "@hermit/connectors";

export type RelaySettingKey = "relay.own" | "relay.dojo" | "signin.clients";

/** The providers whose own client ID HM-CONN-05 takes: public clients that sign in from the phone with PKCE. */
export type ClientProvider = "google" | "microsoft";
export const CLIENT_PROVIDERS: readonly ClientProvider[] = ["google", "microsoft"];

/** The user's own client IDs, and which providers have one of Dojo's in this build. */
export interface ClientIdsView {
  own: Partial<Record<ClientProvider, string>>;
  dojo: Record<ClientProvider, boolean>;
}

export interface RelaySettingsStore {
  get(key: RelaySettingKey): Promise<string | undefined>;
  set(key: RelaySettingKey, value: string): Promise<void>;
  remove(key: RelaySettingKey): Promise<void>;
}

export interface RelayView {
  /** The user's own relay, when one is saved and still passes the address check. */
  own?: { url: string; host: string };
  /** `available` only when this build has Dojo's relay URL (Q43); `on` only after the user opted in. */
  dojo: { available: boolean; on: boolean; host?: string };
}

export type RelayCheck = { kind: "ok"; providers: string[] } | { kind: "refused"; problem: "bad_address" | "unreachable" | "not_a_relay" };

export interface RelaySettings {
  view(): Promise<RelayView>;
  /** Saves only an https address on an exact public host, port 443 (private, LAN and loopback hosts refused). */
  saveOwn(url: string): Promise<{ ok: true } | { ok: false; problem: "bad_address" }>;
  removeOwn(): Promise<void>;
  /** Asks a relay which services it signs in for (one counted request), before or after saving it. */
  check(url: string): Promise<RelayCheck>;
  setDojo(on: boolean): Promise<{ ok: true } | { ok: false; problem: "not_available" }>;
  /** HM-CONN-05 (US-CONN-08): the user's own client IDs and which of Dojo's exist. */
  clients(): Promise<ClientIdsView>;
  /** Saves a client ID only when it has the provider's shape (`validateClientId`); anything else changes nothing. */
  saveClientId(provider: ClientProvider, clientId: string): Promise<{ ok: true } | { ok: false; problem: "bad_client_id" }>;
  removeClientId(provider: ClientProvider): Promise<void>;
  /** The choices as `signInOptions` and `mailSignInOption` read them: the user's own client first, then Dojo's. */
  signIn(): Promise<{ settings: SignInSettings; config: SignInConfig }>;
  /** For HM-SET-02: the relays Hermit may contact with these choices, listed even before first use. */
  privacyHosts(): Promise<{ relayHosts: string[]; ownRelayHosts: string[] }>;
}

const href = (raw: string | undefined) => {
  const u = raw ? parseRelayBase(raw) : undefined;
  return u ? { url: u.path === "/" ? u.origin : `${u.origin}${u.path}`, host: u.host } : undefined;
};

/** Only known providers with a client ID of their shape: a stored or configured value that fails is unset (fail closed). */
function clientIds(raw: unknown): Partial<Record<ClientProvider, string>> {
  const out: Partial<Record<ClientProvider, string>> = {};
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return out;
  for (const p of CLIENT_PROVIDERS) {
    const id = (raw as Record<string, unknown>)[p];
    if (typeof id === "string" && validateClientId(p, id)) out[p] = id;
  }
  return out;
}

export function createRelaySettings(deps: {
  settings: RelaySettingsStore;
  transport?: ConnectorTransport;
  dojoRelayUrl?: string;
  /** Dojo's registered OAuth client IDs from the build config (Q43), absent until its apps exist. */
  dojoClientIds?: Partial<Record<string, string>>;
}): RelaySettings {
  const dojo = href(deps.dojoRelayUrl);
  const dojoClients = clientIds(deps.dojoClientIds ?? {});

  async function ownClients(): Promise<Partial<Record<ClientProvider, string>>> {
    const raw = await deps.settings.get("signin.clients");
    if (!raw) return {};
    try {
      return clientIds(JSON.parse(raw) as unknown);
    } catch {
      return {};
    }
  }
  const storeClients = async (next: Partial<Record<ClientProvider, string>>) =>
    Object.keys(next).length ? deps.settings.set("signin.clients", JSON.stringify(next)) : deps.settings.remove("signin.clients");

  async function view(): Promise<RelayView> {
    const own = href(await deps.settings.get("relay.own"));
    const on = Boolean(dojo) && (await deps.settings.get("relay.dojo")) === "1";
    return { ...(own ? { own } : {}), dojo: dojo ? { available: true, on, host: dojo.host } : { available: false, on: false } };
  }

  return {
    view,
    async saveOwn(url) {
      const own = href(url);
      if (!own) return { ok: false, problem: "bad_address" };
      await deps.settings.set("relay.own", own.url);
      return { ok: true };
    },
    removeOwn: () => deps.settings.remove("relay.own"),
    async check(url) {
      if (!href(url)) return { kind: "refused", problem: "bad_address" };
      if (!deps.transport) return { kind: "refused", problem: "unreachable" };
      const found = await discoverRelay(deps.transport, url);
      if (!found.ok) return { kind: "refused", problem: found.problem };
      return { kind: "ok", providers: found.info.providers.map((p) => (Object.hasOwn(oauthProviders, p.id) ? oauthProviders[p.id]!.name : p.id)) };
    },
    async setDojo(on) {
      if (!dojo) return { ok: false, problem: "not_available" };
      if (on) await deps.settings.set("relay.dojo", "1");
      else await deps.settings.remove("relay.dojo");
      return { ok: true };
    },
    async clients() {
      return { own: await ownClients(), dojo: { google: Boolean(dojoClients.google), microsoft: Boolean(dojoClients.microsoft) } };
    },
    async saveClientId(provider, clientId) {
      const id = clientId.trim();
      if (!CLIENT_PROVIDERS.includes(provider) || !validateClientId(provider, id)) return { ok: false, problem: "bad_client_id" };
      await storeClients({ ...(await ownClients()), [provider]: id });
      return { ok: true };
    },
    async removeClientId(provider) {
      const next = { ...(await ownClients()) };
      delete next[provider];
      await storeClients(next);
    },
    async signIn() {
      const v = await view();
      return {
        settings: { ownClientIds: { ...(await ownClients()) }, ...(v.own ? { ownRelayUrl: v.own.url } : {}), dojoRelayOptIn: v.dojo.on },
        config: { dojoClientIds: { ...dojoClients }, ...(dojo ? { dojoRelayUrl: dojo.url } : {}) },
      };
    },
    async privacyHosts() {
      const v = await view();
      return { relayHosts: v.dojo.on && v.dojo.host ? [v.dojo.host] : [], ownRelayHosts: v.own ? [v.own.host] : [] };
    },
  };
}
