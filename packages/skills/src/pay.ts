import {
  amountInWords, checksummed, checksumOk, formatMoney, matchPayees, otherAssetInWords, parsePayAmount, payAmountText, skillId, typedAddresses,
  usdt, WALLET_NETWORK, type ApprovalSummary, type Money, type NormalizeContext, type Payee, type SignedApprovalTerms, type SkillDef,
} from "@hermit/core";

type Args = Record<string, unknown>;
const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** The network as the sheet names it. */
export const PAY_NETWORK_LABEL = "Stable testnet";

/**
 * The asset the call is in: USD₮ unless the user, or the model, named another one. Code refuses anything else, so a
 * payment the user asked for in euros is never quietly paid in USD₮.
 */
export function payAsset(args: Args): string {
  const a = s(args.asset).toUpperCase().replace("₮", "T");
  return !a || ["USDT", "USDT0", "USD", "DOLLARS", "DOLLAR", "DÓLARES", "DOLARES"].includes(a) ? WALLET_NETWORK.asset : a;
}

/** The amount and asset the call pays, exactly: USD₮ base units from `amount`, or another asset so it is refused. */
export function payMoney(args: Args): Money | undefined {
  const m = parsePayAmount(s(args.amount));
  if (!m) return undefined;
  const asset = payAsset(args);
  return asset === WALLET_NETWORK.asset ? m : { amount: m.amount, asset, network: WALLET_NETWORK.network };
}

/**
 * SL-40 (US-PAY-05, FR-PAY-03): the model fills `pay`; code decides what its arguments may be, from the user's own words
 * this turn and the payees the user saved, never from a message, a page or a tool result.
 * - amount: the one amount in the user's words, exactly. None or two: empty, so Hermit asks.
 * - recipient: one address the user typed this turn (a mixed-case typo is dropped), or else the saved payee whose name the
 *   user said. Several payees with that name: empty, so Hermit asks which. An address the model wrote that the user
 *   didn't type is dropped.
 * - asset: another asset the user named is kept, so the payment is refused rather than paid in USD₮.
 */
export function normalizePay(payees: readonly Payee[]) {
  return (args: Args, ctx: NormalizeContext): { args: Args; notes: string[] } => {
    const notes: string[] = [];
    const out: Args = { ...args };
    const words = ctx.userText;

    const said = amountInWords(words);
    const amount = said.kind === "amount" ? payAmountText(said.money) : "";
    if (s(args.amount) !== amount) notes.push(`amount: ${said.kind === "amount" ? `"${amount}" from the user's words` : `${said.kind} in the user's words, left empty`}`);
    out.amount = amount;

    const other = otherAssetInWords(words);
    if (other) {
      out.asset = other;
      notes.push(`asset: the user named ${other}`);
    } else delete out.asset;

    const typed = typedAddresses(words);
    const given = s(args.to);
    if (typed.length === 1) {
      const t = typed[0]!;
      out.to = checksumOk(t) ? checksummed(t) : "";
      delete out.person;
      if (!checksumOk(t)) notes.push("to: the typed address has a wrong checksum, left empty");
      else if (given.toLowerCase() !== t.toLowerCase()) notes.push("to: the address the user typed");
      return { args: out, notes };
    }
    if (typed.length > 1) {
      out.to = "";
      delete out.person;
      notes.push("to: the user typed more than one address, left empty");
      return { args: out, notes };
    }
    // No address typed: a name, from `person` or from `to` when the model put the name there.
    const name = s(args.person) || (ADDRESS.test(given) ? "" : given);
    if (ADDRESS.test(given)) notes.push("to: an address the user didn't type this turn, dropped");
    const found = name ? matchPayees(name, words, payees) : [];
    if (found.length === 1) {
      out.to = checksummed(found[0]!.address);
      out.person = name.slice(0, 80);
      notes.push("to: a saved payee the user named");
    } else {
      out.to = "";
      if (name) out.person = name.slice(0, 80);
      else delete out.person;
      notes.push(found.length > 1 ? "to: several saved payees have that name, left empty" : "to: no saved payee the user named, left empty");
    }
    return { args: out, notes };
  };
}

const obj = (properties: Record<string, unknown>, required: string[]) => ({ type: "object", properties, required, additionalProperties: false });

export const payDef: SkillDef<Args> = {
  id: skillId("pay"),
  version: 1,
  risk: "spend",
  producesUntrusted: false,
  menuLine:
    "Send money in USD₮ (dollars) from the user's wallet to a person or an address (\"send Ana 20 dollars\", \"pay 0x... 5 USD₮\", \"mándale 20 dólares a Ana\", \"págale a Carlos 10\"). Always needs the user's fingerprint.",
  args: obj({
    amount: { type: "string", description: "The amount exactly as the user said it, digits only (\"20\", \"20.5\")", maxLength: 24 },
    to: { type: "string", description: "The 0x address exactly as the user typed it, only if they typed one", maxLength: 42 },
    person: { type: "string", description: "The person's name exactly as the user said it (\"Ana\"), when they gave no address", maxLength: 80 },
    asset: { type: "string", description: "Only if the user named a currency other than dollars or USD₮", maxLength: 16 },
  }, ["amount"]),
  describeAction(args): ApprovalSummary {
    const m = payMoney(args);
    const to = s(args.to);
    const lines: ApprovalSummary["lines"] = [
      { label: "Amount", value: !m ? s(args.amount) : m.asset === WALLET_NETWORK.asset ? formatMoney(m, "en", 6) : `${payAmountText(usdt(m.amount))} ${m.asset}`, flag: "pay_amount" },
      { label: "To", value: to, flag: "pay_to" },
      { label: "Network", value: PAY_NETWORK_LABEL, flag: "pay_network" },
    ];
    // A sheet that can't say how much, in what, or to whom is never shown (the loop refuses the call instead).
    if (!m || !ADDRESS.test(to)) return { title: "Send money", lines, unresolved: "Hermit can't tell how much to send or to whom." };
    return { title: "Send money", lines, binding: `${checksummed(to)}|${m.asset}|${m.amount}` };
  },
  approvalTerms(args): SignedApprovalTerms {
    const m = payMoney(args);
    const to = s(args.to);
    if (!m || !ADDRESS.test(to)) throw new Error("A payment needs an amount and an address.");
    return { amount: m, recipient: checksummed(to) };
  },
};
