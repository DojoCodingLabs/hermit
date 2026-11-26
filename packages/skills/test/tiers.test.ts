import { describe, expect, test } from "vitest";
import { tierOf } from "@hermit/core";
import { recipeSkill } from "../src/web-task.ts";
import { DEFS, SAMPLE_RECIPE } from "./fixtures.ts";

describe("the tier table (spec 6.4.1): risk tiers are code, never the model's call", () => {
  test("every skill on the chat's menu has the tier table's group and tier", () => {
    expect(Object.fromEntries(DEFS.map((d) => [d.id, `${d.group ?? "-"}:${tierOf(d)}`]))).toEqual({
      remember: "notes:low", recall: "notes:low", forget: "notes:medium",
      remind: "reminders:low", reminders_list: "reminders:low", reminder_cancel: "reminders:medium",
      calendar_read: "calendar:low", calendar_add: "calendar:low",
      read_messages: "messages_read:low", reply_message: "messages_reply:medium",
      mail_list: "mail_read:low", mail_search: "mail_read:low", mail_read: "mail_read:low",
      mail_send: "mail_send:medium", mail_reply: "mail_send:medium", mail_forward: "mail_send:medium", mail_draft: "mail_send:medium", mail_modify: "mail_send:medium",
      read_web: "web_read:low", search_web: "web_read:low",
      open_whatsapp_chat: "apps:medium", compose_sms: "apps:medium", compose_email: "apps:medium", dial: "apps:medium",
      navigate: "apps:medium", share: "apps:medium", set_alarm: "apps:medium", add_contact: "apps:medium",
      pay: "wallet_pay:high", pay_merchant: "wallet_pay:high", connect_service: "-:low", create_bot: "-:low",
    });
  });

  test("a saved recipe's skill is a web task with no tier", () => {
    const d = recipeSkill(SAMPLE_RECIPE);
    expect([d.group, d.tier, tierOf(d)]).toEqual(["web_tasks", undefined, "high"]);
  });

  test("nothing that sends, changes others' data, pays or signs in is low", () => {
    for (const d of DEFS) if (["send", "remote_write", "spend", "credential"].includes(d.risk)) expect(tierOf(d), d.id).not.toBe("low");
  });
});
