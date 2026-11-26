import { needsFingerprint, normalizeSite, RESERVED_GROUPS, SKILL_GROUPS, type BotLook, type PermissionMode, type SkillDef, type SkillGroup } from "@hermit/core";
import type { SkillRuntime } from "@hermit/agent";
import { botRoleText } from "@hermit/model";
import { createBotDef, MAX_PROPOSED_SITES } from "@hermit/skills";
import type { BotProposalView } from "./bot-api.ts";
import type { BotProposals } from "./bots.ts";

/**
 * Multi-bot (Task 12, spec 6.4 "Creating a bot", 6.8): Hermit's bot proposals. Asked for a bot, Hermit's create_bot
 * creates nothing: it keeps an offer, by a one-time id, and the chat shows a card the app draws from the offer's typed
 * fields. The bot exists only once the user taps Create (HermitBots.create with the offer's id, the fingerprint when the
 * grants need it) or creates it from the review on HM-BOT-03. Offers live in memory, for PROPOSAL_TTL_MS each.
 */

/** How long an offer lasts. After it, the card's Create and HM-BOT-03 find it gone, as a web task's offer (web-tasks.ts). */
export const PROPOSAL_TTL_MS = 30 * 60_000;

/**
 * The card's fingerprint flag (the coordinator's ruling on Task 12): core's one rule with the proposal's own mode, which
 * is always none. A bot with no mode of its own inherits the global one, the same mode before and after it exists, so
 * its mode brings nothing to confirm and only the grants decide, as create's gate decides (bots.ts, newBotGate). The
 * global mode is never read: a global Don't ask took the typed word and the fingerprint when it was set.
 */
function needsFingerprintToCreate(grants: readonly SkillGroup[]): boolean {
  // Whichever mode it inherits, it is the same before and after.
  const inherited: PermissionMode = "ask";
  return needsFingerprint({ grants, mode: inherited }, { grants: [], mode: inherited });
}

/** A copy, so nothing holding a view can change the offer behind it (its `tainted` above all). */
const copyOf = (v: BotProposalView): BotProposalView => ({
  ...v, look: { ...v.look }, grants: [...v.grants], sources: { sites: [...v.sources.sites], connectors: [...v.sources.connectors] },
});

export function createBotProposals(deps: { newId(): string; nextLook(): Promise<BotLook>; now(): number; mode(): Promise<PermissionMode> }): BotProposals {
  const offers = new Map<string, { view: BotProposalView; at: number }>();
  const expired = (o: { at: number }) => deps.now() - o.at > PROPOSAL_TTL_MS;
  /** The offer while it lasts; one past its time goes. */
  const live = (offerId: string): BotProposalView | undefined => {
    const o = offers.get(offerId);
    if (!o) return undefined;
    if (!expired(o)) return o.view;
    offers.delete(offerId);
    return undefined;
  };
  return {
    async offer(p) {
      for (const [id, o] of offers) if (expired(o)) offers.delete(id);
      // Review Focus 4: the name and the role as a role's prompt has them (Task 9): one line each, quotation marks made
      // apostrophes and the untrusted markers neutralized, so neither can break the card or, once created, the prompt.
      const { name, text: role } = botRoleText({ name: p.name, text: p.role });
      // Never a reserved group (vault_logins in wave 1): no screen shows it, so the user could grant it unseen.
      const grants = [...new Set(p.grants)].filter((g) => SKILL_GROUPS.includes(g) && !RESERVED_GROUPS.includes(g));
      // Registrable domains, as a bot's sources are kept; anything that isn't a public website is dropped.
      const sites = [...new Set(p.sites.map((s) => normalizeSite(s)).filter((s): s is string => s !== undefined))].slice(0, MAX_PROPOSED_SITES);
      const view: BotProposalView = {
        offerId: deps.newId(), name, role, look: await deps.nextLook(), grants, sources: { sites, connectors: [] },
        tainted: p.tainted, needsFingerprint: needsFingerprintToCreate(grants), mode: await deps.mode(),
      };
      offers.set(view.offerId, { view, at: deps.now() });
      return copyOf(view);
    },
    peek(offerId) {
      const view = live(offerId);
      return view && copyOf(view);
    },
    claim(offerId) {
      const view = live(offerId);
      offers.delete(offerId);
      return view && copyOf(view);
    },
  };
}

/**
 * create_bot, Hermit's only (it is in no group). It turns the model's arguments into a proposal and ends the turn with
 * code's words in the language of the user's (`say`), never the model's; `onOffer` hands the card's view to the turn. A
 * session that read others' text, in this turn or before it, makes a tainted proposal: its card offers only Review.
 */
export function createBotRuntime(proposals: BotProposals, say: (key: string, userText: string) => string, onOffer: (v: BotProposalView) => void): SkillRuntime {
  return {
    def: createBotDef as SkillDef,
    async execute(args, ctx) {
      const name = typeof args.name === "string" ? args.name : "";
      const role = typeof args.role === "string" ? args.role : "";
      if (!botRoleText({ name, text: "" }).name) {
        return { ok: false, modelText: "A bot needs a name, so nothing was proposed. Propose it again with a name, or ask the user what to call it." };
      }
      // The schema's lists are checked here: only group ids, and only text for sites.
      const grants = Array.isArray(args.grants) ? args.grants.filter((g): g is SkillGroup => SKILL_GROUPS.includes(g as SkillGroup)) : [];
      const sites = Array.isArray(args.sites) ? args.sites.filter((s): s is string => typeof s === "string") : [];
      // Review Focus 2: drafted after reading others' text, a page could have written its role, grants or sites.
      const tainted = ctx.session.taint.length > 0;
      const view = await proposals.offer({ name, role, grants, sites, tainted });
      onOffer(view);
      return {
        ok: true,
        modelText: "Showed the user a card with the proposed bot. Nothing was created: the user creates it from the card, or reviews it first.",
        reply: say(tainted ? "HM-CHAT-01.bot.offerTainted" : "HM-CHAT-01.bot.offer", ctx.userText ?? ""),
      };
    },
  };
}
