import type { Recipe } from "@hermit/core";
import { createBotDef } from "../src/bots.ts";
import { firstWinSkills, mailSkillDefs, mailWriteSkillDefs } from "../src/catalog.ts";
import { connectSkill } from "../src/connect.ts";
import { intentSkills } from "../src/intents.ts";
import { payMerchantDef } from "../src/pay-merchant.ts";
import { payDef } from "../src/pay.ts";
import { webSkills } from "../src/web.ts";

/** The chat menu's 32 built-in skills; saved recipes, MCP tools and connector operations join it per turn. */
export const DEFS = [...firstWinSkills, ...mailSkillDefs, ...mailWriteSkillDefs, ...webSkills, ...intentSkills, payDef, payMerchantDef, connectSkill, createBotDef];

/** A saved web task: booking a table, with a number, a choice and a free-text parameter, and one committing step. */
export const SAMPLE_RECIPE: Recipe = {
  format: 1,
  id: "k3j9",
  version: 2,
  name: "Table at Casa Luna",
  kind: "book",
  origin: "https://casaluna.example.com",
  params: [
    { name: "people", label: "People", kind: "number", required: true, default: "2" },
    { name: "time", label: "Time", kind: "choice", options: ["19:00", "20:00", "21:00"], required: true },
    { name: "note", label: "Note", kind: "text", required: false },
  ],
  steps: [
    { op: "open", path: "/book" },
    { op: "fill", target: { role: "textbox", name: "People" }, value: { param: "people" } },
    { op: "select", target: { role: "combobox", name: "Time" }, value: { param: "time" } },
    { op: "fill", target: { role: "textbox", name: "Note" }, value: { param: "note" } },
    { op: "click", target: { role: "button", name: "Book" }, commit: "remote_write" },
  ],
  createdAt: 1,
  updatedAt: 1,
};
