import {
  argsHash, createProfileStore, createVaultStore, draftRecipe, keyMatches, MAX_RECIPES, normalizeOrigin, openSecrets, originOf, sha256Hex, validateRecipe,
  vaultItemHash,
  type ApprovalPort, type BrowserPort, type DraftRefusal, type ProfileKind, type Recipe, type RecordedEvent, type SqlPort, type TaskKind,
  type VaultCipherPort, type VaultKeyPort, type OneTimeCodePort,
} from "@hermit/core";
import { decide, WEB_TASK, webTaskRules, type AuditLog, type SignedApprovals } from "@hermit/cage";
import type { SkillRuntime } from "@hermit/agent";
import { recipeSkill, recipesForTurn } from "@hermit/skills";
import { createWebTask, type WebTask, type WebTaskDeps } from "./web-task.ts";

/**
 * SL-53: the web task service behind HM-WEB-02 and the chat's offer. Recipes live in the settings table (validated on
 * every load, so a corrupted or hand-edited row never runs), are saved and removed only by the user's own taps (each a
 * signed log row), and become skills on the menu only for the turn whose words name them. The chat's offer is a
 * one-time id: HM-WEB-02 claims it once to show the plan; a made-up or reused id opens nothing.
 */

export const OFFER_TTL_MS = 30 * 60_000;

export interface WebOffer {
  offerId: string;
  recipeId: string;
  name: string;
  site: string;
}

export interface WebTaskPorts {
  /** Copy in the app's language. */
  copy(key: string, vars?: Record<string, string>): string;
  /** Hermit's in-app browser as a requester, `android://<cert>@<package>`: who receives a login's values. */
  requester: string;
  onScreen(): boolean;
  /** SL-56b (Q138): where a sign-in's one-time code may come from, in order (the SMS consent dialog, the site's email). */
  codes?: OneTimeCodePort[];
}

export interface WebTasksDeps extends WebTaskPorts {
  sql: SqlPort;
  audit: AuditLog;
  approvals: ApprovalPort;
  now(): number;
  newId(): string;
  settings: { get(key: WebSettingKey): Promise<string | undefined>; set(key: WebSettingKey, value: string): Promise<void> };
  read: WebTaskDeps["read"];
  repair: WebTaskDeps["repair"];
  signed?: SignedApprovals;
  vault?: { key: VaultKeyPort; cipher: VaultCipherPort };
}

export type SaveProblem = DraftRefusal | "full" | "not_yours";

type WebSettingKey = "web.recipes" | "web.keptSites" | "web.siteLogins";

/** HM-WEB-02's "Sign in with" picker: the vault's logins for one exact origin, by name and id hash only. */
export interface SiteLogins {
  logins: Array<{ hash: string; name: string }>;
  /** The login the user chose for this origin, only while it is still one of `logins`. */
  chosen?: string;
}

const ITEM_HASH = /^[0-9a-f]{64}$/;

export interface WebTasks {
  recipes(): Promise<Recipe[]>;
  /** The skills for this turn: recipes the user's words name, each offering HM-WEB-02. */
  turnSkills(userText: string, onOffer: (o: WebOffer) => void): Promise<SkillRuntime[]>;
  /** HM-WEB-02 claims the chat's offer once: the recipe and the values from the user's words. */
  claim(offerId: string): Promise<{ recipe: Recipe; values: Record<string, string> } | undefined>;
  /** A task for a recipe in the given browser (one WebView). */
  task(recipe: Recipe, browser: BrowserPort): WebTask;
  /** The user opens a site to record a task themselves (US-WEB-11): an audited open of the address they typed. */
  record(url: string): Promise<{ ok: true; origin: string } | { ok: false; reason: "not_https" | "blocked" }>;
  /** The user saves what they did as a recipe. Only HM-WEB-02's Save tap calls this; no skill reaches it. */
  save(input: { startUrl: string; events: readonly RecordedEvent[]; name: string; kind: TaskKind; fixed?: readonly string[]; question?: string }):
    Promise<{ ok: true; recipe: Recipe } | { ok: false; reason: SaveProblem }>;
  /** The user saves a repaired recipe (the same id, one version up). */
  saveFix(recipe: Recipe): Promise<{ ok: true } | { ok: false; reason: SaveProblem | "invalid" }>;
  remove(id: string): Promise<boolean>;
  /** Sites whose sign-in the user chose to keep (US-WEB-06); every other site's data is cleared after each task. */
  keptSites(): Promise<string[]>;
  keepSignedIn(origin: string, keep: boolean): Promise<void>;
  /** The user cleared a site's data on HM-WEB-02: logged; the app clears the site's WebView profile. */
  cleared(origin: string): Promise<void>;
  /** SL-56: the vault's logins for this exact origin and the user's choice among them (HM-WEB-02). */
  loginsFor(origin: string): Promise<SiteLogins>;
  /**
   * SL-56: the user's tap on HM-WEB-02 picks the login a task signs in with on this exact origin (undefined clears
   * it). Only a login stored for that origin can be chosen; false when it isn't one.
   */
  chooseLogin(origin: string, hash: string | undefined): Promise<boolean>;
}

export function createWebTasks(deps: WebTasksDeps): WebTasks {
  const offers = new Map<string, { recipeId: string; version: number; values: Record<string, string>; at: number }>();
  const userAct = (reason: string, ref: string) =>
    deps.audit.append({ ts: deps.now(), sessionId: "web", event: "web_task", skill: "web_task", argsHash: sha256Hex(`web:${ref}`), outcome: "ok", reason });

  async function load(): Promise<Recipe[]> {
    const raw = await deps.settings.get("web.recipes");
    let list: unknown;
    try {
      list = raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
    if (!Array.isArray(list)) return [];
    return list.flatMap((r) => {
      const v = validateRecipe(r);
      return v.ok ? [v.recipe] : [];
    });
  }
  const store = (list: Recipe[]) => deps.settings.set("web.recipes", JSON.stringify(list));

  const vaultStore = createVaultStore(deps.sql);
  const profileStore = createProfileStore(deps.sql);

  /** The vault's items stored for this exact origin. Names and ids only: no value is read. */
  async function itemsFor(origin: string): Promise<Array<{ id: string; hash: string; name: string }>> {
    const exact = normalizeOrigin(origin);
    if (!exact || !deps.vault) return [];
    return (await vaultStore.list())
      .filter((e) => e.origins.some((o) => normalizeOrigin(o) === exact))
      .map((e) => ({ id: e.id, hash: vaultItemHash(e.id), name: e.name }));
  }

  /** `web.siteLogins`: exact origin to item hash. A corrupted or hand-edited row is no choice. */
  async function siteLogins(): Promise<Record<string, string>> {
    const raw = await deps.settings.get("web.siteLogins");
    let map: unknown;
    try {
      map = raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
    if (!map || typeof map !== "object" || Array.isArray(map)) return {};
    const out: Record<string, string> = {};
    for (const [o, h] of Object.entries(map)) if (normalizeOrigin(o) === o && typeof h === "string" && ITEM_HASH.test(h)) out[o] = h;
    return out;
  }

  const logins: WebTaskDeps["logins"] = deps.vault
    ? {
        list: itemsFor,
        // The stored choice even when its login is gone: the runner then signs in with no other one (the user does).
        async chosen(origin) {
          const exact = normalizeOrigin(origin);
          return exact ? (await siteLogins())[exact] : undefined;
        },
        async open(id, origin, prompt) {
          // What was approved is what opens: the same item, still storing this exact origin.
          const entry = await vaultStore.entry(id);
          if (!entry || !entry.origins.some((o) => normalizeOrigin(o) === origin)) return undefined;
          const [check, sealed] = await Promise.all([vaultStore.keyCheck(), vaultStore.sealed(id)]);
          if (!check || !sealed) return undefined;
          // The vault key needs its own strong biometric for every use (Q86, Q112).
          const got = await deps.vault!.key.unwrap(prompt);
          if (got.kind !== "key") return undefined;
          try {
            if (!(await keyMatches(deps.vault!.cipher, got.key, check))) return undefined;
            const s = await openSecrets(deps.vault!.cipher, got.key, id, sealed);
            return { username: s.username, secret: s.secret };
          } catch {
            return undefined;
          } finally {
            got.key.fill(0);
          }
        },
      }
    : undefined;

  const profile: WebTaskDeps["profile"] = {
    async value(kind: ProfileKind) {
      const row = (await profileStore.list()).find((r) => r.kind === kind);
      // A sensitive field is never typed by a task: the user types it on the page.
      return row && !row.sensitive ? row.value : undefined;
    },
  };

  return {
    recipes: load,

    async turnSkills(userText, onOffer) {
      return recipesForTurn(userText, await load()).map((recipe): SkillRuntime => ({
        def: recipeSkill(recipe),
        async execute(args) {
          // The loop already kept only values in the user's words (the skill's normalize); strings only from here.
          const values: Record<string, string> = {};
          for (const p of recipe.params) if (typeof args[p.name] === "string") values[p.name] = args[p.name] as string;
          const offerId = deps.newId();
          offers.set(offerId, { recipeId: recipe.id, version: recipe.version, values, at: deps.now() });
          const site = recipe.origin.replace(/^https:\/\//, "");
          onOffer({ offerId, recipeId: recipe.id, name: recipe.name, site });
          return {
            ok: true,
            modelText: `Offered the user the plan for the saved web task "${recipe.name}" on ${site}. Nothing was opened or sent.`,
            reply: deps.copy("HM-CHAT-01.web.offer", { name: recipe.name, site }),
          };
        },
      }));
    },

    async claim(offerId) {
      const o = offers.get(offerId);
      offers.delete(offerId);
      if (!o || deps.now() - o.at > OFFER_TTL_MS) return undefined;
      const recipe = (await load()).find((r) => r.id === o.recipeId);
      // A recipe changed since the offer shows its new plan, without the old values.
      if (!recipe) return undefined;
      return { recipe, values: recipe.version === o.version ? o.values : {} };
    },

    task(recipe, browser) {
      return createWebTask(
        {
          browser,
          approvals: deps.approvals,
          audit: deps.audit,
          now: deps.now,
          newId: deps.newId,
          say: deps.copy,
          ...(deps.read ? { read: deps.read } : {}),
          ...(deps.repair ? { repair: deps.repair } : {}),
          ...(deps.signed ? { signed: deps.signed } : {}),
          ...(logins ? { logins } : {}),
          profile,
          requester: deps.requester,
          onScreen: deps.onScreen,
          ...(deps.codes?.length ? { codes: deps.codes } : {}),
        },
        { recipe, sessionId: "web" },
      );
    },

    async record(url) {
      const origin = originOf(url);
      if (!origin || !origin.startsWith("https://")) return { ok: false, reason: "not_https" };
      // The user's own address and tap: the same audited open a task's Start is.
      const args = { url, record: true };
      const call = { id: deps.newId(), skill: WEB_TASK, args, argsHash: argsHash(args), repairs: [] };
      const log = (e: { event: "call_proposed" | "policy_decided" | "approval"; decision?: "allow" | "ask" | "deny"; outcome?: "ok"; reason?: string }) =>
        deps.audit.append({ ts: deps.now(), sessionId: "web", skill: WEB_TASK, argsHash: call.argsHash, ...e });
      await log({ event: "call_proposed" });
      const decision = decide(call, "network", { id: "web", taint: [], unattended: !deps.onScreen() }, webTaskRules());
      await log({ event: "policy_decided", decision: decision.effect });
      if (decision.effect === "deny") return { ok: false, reason: "blocked" };
      await log({ event: "approval", decision: "ask", outcome: "ok", reason: "record.start" });
      return { ok: true, origin };
    },

    async save(input) {
      const list = await load();
      if (list.length >= MAX_RECIPES) return { ok: false, reason: "full" };
      const id = deps.newId().toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 24) || "r";
      const d = draftRecipe({ ...input, id, now: deps.now() });
      if (!d.ok) return d;
      await store([...list.filter((r) => r.id !== d.recipe.id), d.recipe]);
      await userAct("web.recipe_saved", d.recipe.id);
      return { ok: true, recipe: d.recipe };
    },

    async saveFix(recipe) {
      const v = validateRecipe(recipe);
      if (!v.ok) return { ok: false, reason: "invalid" };
      const list = await load();
      const old = list.find((r) => r.id === recipe.id);
      // A fix replaces the recipe it came from, one version up, on the same site; nothing else.
      if (!old || old.origin !== recipe.origin || recipe.version !== old.version + 1) return { ok: false, reason: "not_yours" };
      await store(list.map((r) => (r.id === recipe.id ? v.recipe : r)));
      await userAct("web.recipe_fixed", recipe.id);
      return { ok: true };
    },

    async remove(id) {
      const list = await load();
      if (!list.some((r) => r.id === id)) return false;
      await store(list.filter((r) => r.id !== id));
      await userAct("web.recipe_removed", id);
      return true;
    },

    keptSites,
    keepSignedIn,

    async cleared(origin) {
      const exact = normalizeOrigin(origin);
      if (!exact) return;
      if ((await keptSites()).includes(exact)) await keepSignedIn(exact, false);
      await userAct("web.site_cleared", exact);
    },

    async loginsFor(origin) {
      const items = await itemsFor(origin);
      const exact = normalizeOrigin(origin);
      const chosen = exact ? (await siteLogins())[exact] : undefined;
      return {
        logins: items.map((x) => ({ hash: x.hash, name: x.name })),
        ...(chosen && items.some((x) => x.hash === chosen) ? { chosen } : {}),
      };
    },

    async chooseLogin(origin, hash) {
      const exact = normalizeOrigin(origin);
      if (!exact || !deps.vault) return false;
      if (hash !== undefined && !(await itemsFor(exact)).some((x) => x.hash === hash)) return false;
      const map = await siteLogins();
      if (hash === undefined) delete map[exact];
      else map[exact] = hash;
      await deps.settings.set("web.siteLogins", JSON.stringify(map));
      await userAct(hash === undefined ? "web.login_unchosen" : "web.login_chosen", exact);
      return true;
    },
  };

  async function keptSites(): Promise<string[]> {
    const raw = await deps.settings.get("web.keptSites");
    try {
      const list = raw ? (JSON.parse(raw) as unknown) : [];
      return Array.isArray(list) ? list.filter((o): o is string => typeof o === "string" && normalizeOrigin(o) === o) : [];
    } catch {
      return [];
    }
  }

  async function keepSignedIn(origin: string, keep: boolean): Promise<void> {
    const exact = normalizeOrigin(origin);
    if (!exact) return;
    const now = (await keptSites()).filter((o) => o !== exact);
    await deps.settings.set("web.keptSites", JSON.stringify(keep ? [...now, exact] : now));
    await userAct(keep ? "web.site_kept" : "web.site_not_kept", exact);
  }
}
