// Preview only: the approval requests the sheet (HM-APPR-01, HM-APPR-02) is shown with. The lines are built the way
// the runtime builds them: the skill's own describeAction, then the runtime's extra lines, labels in the user's language.
import { formatMoney, usdt, type ApprovalRequest } from "@hermit/core";
import { firstWinSkills, payDef, payMerchantDef } from "@hermit/skills";
import { webSkills } from "../../../../../packages/skills/src/web.ts";
import { t } from "../../../src/i18n";
import { scene } from "../scene";
import { mailApproval } from "./mail";

const ANA = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
const signed = { payload: {} as never, message: "hermit-approval-v1" };

export function sampleApproval(variant: string): ApprovalRequest | undefined {
  const base = { id: "req1", requireBiometric: true, expiresAt: Date.now() + 3600_000 };
  const money = (n: bigint) => formatMoney(usdt(n), scene.lang, 2);
  switch (variant) {
    case "pay": {
      // pay: "mándale 20 dólares a Ana" with Ana a saved payee (skills/src/pay.ts, runtime/src/pay.ts).
      const s = payDef.describeAction({ amount: "20", to: ANA } as never, {} as never);
      return {
        ...base,
        call: { id: "c1", skill: "pay" as never, argsHash: "a3f91c075e2b88d04f61b9a2c7d0e4f1" },
        said: scene.lang === "en" ? "Send Ana 20 dollars" : "Mándale 20 dólares a Ana",
        summary: { ...s, lines: [...s.lines, { label: "Saved payee", value: "Ana", flag: "pay_payee" }, { label: "Network fee (estimate)", value: money(12_000n), flag: "pay_fee" }, { label: "Left today after this", value: money(30_000_000n), flag: "pay_cap_left" }] },
        signed,
      };
    }
    case "pay-typed": {
      // pay to an address the user typed this turn (no saved payee): the runtime's typed-address line, the address whole.
      const typed = "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359";
      const s = payDef.describeAction({ amount: "5", to: typed } as never, {} as never);
      return {
        ...base,
        call: { id: "c6", skill: "pay" as never, argsHash: "c94e1a07d2b3" },
        said: scene.lang === "en" ? `Pay ${typed.toLowerCase()} 5 USDT` : `Paga 5 USDT a ${typed.toLowerCase()}`,
        summary: { ...s, lines: [...s.lines, { label: "Address", value: t("HM-APPR-02.typedValue"), flag: "pay_typed" }, { label: "Network fee (estimate)", value: money(12_000n), flag: "pay_fee" }, { label: "Left today after this", value: money(45_000_000n), flag: "pay_cap_left" }] },
        signed,
      };
    }
    case "credential":
      // A web task's sign-in step (runtime/src/web-task.ts, FILL_LOGIN): the recipe's name, the site and the login.
      return {
        ...base,
        call: { id: "c2", skill: "fill_login" as never, argsHash: "a2" },
        summary: { title: recipeName(), lines: [{ label: t("HM-WEB-02.sheet.site"), value: "www.farmaciasahumada.cl" }, { label: t("HM-WEB-02.sheet.login"), value: "Farmacias Ahumada (hugo.prueba@example.com)" }] },
        signed,
      };
    case "search": {
      const def = webSkills.find((d) => d.id === ("search_web" as never));
      const s = def ? def.describeAction({ query: "horario farmacia de turno Ñuñoa" } as never, { search: { label: "DuckDuckGo", base: "https://html.duckduckgo.com/html/" } } as never) : { title: "Search the web?", lines: [] };
      return { ...base, requireBiometric: false, call: { id: "c3", skill: "search_web" as never, argsHash: "a3" }, summary: s };
    }
    case "message": {
      // A reply after reading messages (ST-TAINTED). The warning is the loop's own string (agent/src/loop.ts:349),
      // whose ref is the skill id that read the content; the lines are reply_message's describeAction.
      const def = firstWinSkills.find((d) => d.id === ("reply_message" as never))!;
      const s = def.describeAction({ conversationId: "wa:carla", text: "Dale, nos vemos el jueves a las 7 en el café." } as never, { conversation: () => ({ name: "Carla Rojas", address: "+56 9 5555 0123" }) } as never);
      return { ...base, call: { id: "c4", skill: "reply_message" as never, argsHash: "a4" }, taintWarning: "Suggested after reading messages", taintKind: "inbound_message", said: scene.lang === "en" ? "Tell her yes, Thursday at 7 at the café" : "Dile que sí, el jueves a las 7 en el café", summary: s };
    }
    case "merchant": {
      // pay_merchant (SL-41): a page that asked for x402; the skill's lines, then the hold's from the parsed offer.
      const s = payMerchantDef.describeAction({ url: "https://news.example.com/informe" } as never, {} as never);
      return {
        ...base,
        call: { id: "c5", skill: "pay_merchant" as never, argsHash: "b71d2e4409fa" },
        said: scene.lang === "en" ? "Pay for https://news.example.com/informe" : "Paga https://news.example.com/informe",
        summary: { ...s, lines: [...s.lines, { label: "Amount", value: money(10_000n), flag: "pay_amount" }, { label: "To", value: "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359", flag: "pay_to" }, { label: "Network", value: "Stable testnet", flag: "pay_network" }, { label: "Can be collected for", value: t("HM-APPR-02.validFor", { minutes: "5" }), flag: "pay_valid" }, { label: "Left today after this", value: money(29_990_000n), flag: "pay_cap_left" }] },
        signed,
      };
    }
    default:
      // SL-48 and SL-49: the mail sheets, from ./mail.
      return mailApproval(variant);
  }
}

const recipeName = () => (scene.lang === "en" ? "Reorder my prescription" : "Volver a pedir mi receta");
