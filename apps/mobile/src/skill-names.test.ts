import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { markKey, skillName, SKILL_NAME_KEYS } from "./skill-names.ts";

const locale = (name: string) => JSON.parse(readFileSync(new URL(`../../../packages/copy/locales/${name}.json`, import.meta.url), "utf8")) as Record<string, string>;
const PACKAGES = new URL("../../../packages/", import.meta.url).pathname;

function sources(): string[] {
  return readdirSync(PACKAGES).flatMap((pkg) => {
    const dir = join(PACKAGES, pkg, "src");
    try {
      return readdirSync(dir, { recursive: true }).map(String).filter((f) => f.endsWith(".ts")).map((f) => readFileSync(join(dir, f), "utf8"));
    } catch {
      return [];
    }
  });
}

test("HM-ACT-01, HM-NIGHT-02: every skill id and every row the signed log writes has a name in both locales", () => {
  const src = sources().join("\n");
  const ids = new Set([
    // Skills: skillId("x") and "x" as SkillId, in the catalog, the cage's policy and the runtime.
    ...[...src.matchAll(/skillId\("([a-z_]+)"\)|"([a-z_]+)" as SkillId/g)].map((m) => m[1] ?? m[2]!),
    // Rows that aren't a skill call: a vault, wallet or connector action, a web task, a spending change.
    ...[...src.matchAll(/event: "[a-z_]+", skill: "([a-z_]+)"/g)].map((m) => m[1]!),
    // Night jobs: night.<job>, for every job.
    ...[.../export type NightJobId = ([^;]+);/.exec(src)![1]!.matchAll(/"([a-z]+)"/g)].map((m) => `night.${m[1]}`),
  ]);
  for (const seen of ["search_web", "read_web", "pay", "reply_message", "remind", "vault", "web_task", "night.agenda"]) assert.ok(ids.has(seen), seen);
  const unnamed = [...ids].filter((id) => !Object.hasOwn(SKILL_NAME_KEYS, id)).sort();
  assert.deepEqual(unnamed, []);
  for (const name of ["en", "es-419"]) {
    const dict = locale(name);
    for (const key of Object.values(SKILL_NAME_KEYS)) assert.equal(typeof dict[key], "string", `${name} ${key}`);
    for (const key of ["common.skill.mcp", "common.skill.connectorAction", "common.skill.other"]) assert.equal(typeof dict[key], "string", `${name} ${key}`);
  }
});

test("HM-ACT-01: a skill id is never shown; a connector's or MCP tool's action and anything unknown get words too", () => {
  assert.equal(skillName("search_web"), "common.skill.search_web");
  assert.equal(skillName("night.mail"), "HM-NIGHT-01.job.mail");
  assert.equal(skillName("mcp_notes_list_notes"), "common.skill.mcp");
  assert.equal(skillName("conn_acme_create_item"), "common.skill.connectorAction");
  assert.equal(skillName("something_new"), "common.skill.other");
  assert.equal(skillName("constructor"), "common.skill.other");
});

test("HM-ACT-01: every row mark is a word in both locales", () => {
  const activity = readFileSync(join(PACKAGES, "cage/src/activity.ts"), "utf8");
  const marks = [...activity.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]!).filter((m) => /export type ActivityMark[^;]*"/.test(activity) && activity.slice(0, activity.indexOf("export interface ActivityRow")).includes(`"${m}"`));
  assert.ok(marks.includes("read_untrusted") && marks.includes("approved") && marks.includes("skipped"));
  for (const name of ["en", "es-419"]) {
    const dict = locale(name);
    for (const m of marks) assert.equal(typeof dict[markKey(m)], "string", `${name} ${markKey(m)}`);
  }
  assert.equal(markKey("read_untrusted"), "HM-ACT-01.mark.read_untrusted");
});
