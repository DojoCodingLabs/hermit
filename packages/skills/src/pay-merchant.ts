import { findUrls, parseWebUrl, skillId, type ApprovalSummary, type NormalizeContext, type SignedApprovalTerms, type SkillDef } from "@hermit/core";

type Args = Record<string, unknown>;

const https = (raw: string) => parseWebUrl(raw, { upgrade: true });
const linksIn = (text: string) => findUrls(text).map((u) => https(u)?.url).filter((u): u is string => u !== undefined);

/**
 * SL-41 (US-PAY-07): `pay_merchant.url` from the user's own words only. The links in this message, else in the user's
 * latest earlier message that had any ("pay for it" after read_web met a 402). The model's pick stands only when it is
 * one of them; one link replaces anything else; otherwise the address is left empty and the sheet is never shown. So
 * no page, message or tool result can choose which site gets paid.
 */
export function normalizePayMerchant(args: Args, ctx: NormalizeContext): { args: Args; notes: string[] } {
  let said = linksIn(ctx.userText);
  if (!said.length) said = (ctx.earlier ?? []).map(linksIn).find((l) => l.length) ?? [];
  const given = typeof args.url === "string" ? https(args.url)?.url : undefined;
  if (given && said.includes(given)) return { args: { url: given }, notes: given === args.url ? [] : ["url: made https"] };
  if (said.length === 1) return { args: { url: said[0] }, notes: ["url: the link the user gave"] };
  return { args: { url: "" }, notes: [said.length ? "url: the user gave several links, left empty" : "url: no link in the user's words, left empty"] };
}

export const payMerchantDef: SkillDef<Args> = {
  id: skillId("pay_merchant"),
  version: 1,
  risk: "spend",
  producesUntrusted: false,
  tier: "high",
  group: "wallet_pay",
  menuLine:
    "Pay for a web page or API the user gives a link to that asks for a payment (x402), in USD₮ (\"pay for https://...\", \"buy access to this link\", \"págale a esta página\", \"sí, paga para verla\"). Always shows the price and needs the user's fingerprint.",
  args: {
    type: "object",
    properties: { url: { type: "string", description: "The page's full address exactly as the user gave it, starting with https://", maxLength: 2048 } },
    required: ["url"],
    additionalProperties: false,
  },
  normalize: normalizePayMerchant,
  describeAction(args): ApprovalSummary {
    const url = typeof args.url === "string" ? parseWebUrl(args.url) : undefined;
    if (url?.scheme !== "https") return { title: "Pay this site?", lines: [], unresolved: "Hermit can't tell which page to pay for (it needs the https link the user gave)." };
    return {
      title: "Pay this site?",
      lines: [
        { label: "Site", value: url.host, flag: "pay_site" },
        { label: "Page", value: url.url, flag: "pay_page" },
      ],
      binding: url.url,
    };
  },
  approvalTerms(): SignedApprovalTerms {
    // The amount, the payee and the origin come from the site's 402, read and checked by code in the hold.
    throw new Error("A purchase's terms come from the merchant's payment request, read before the sheet.");
  },
};
