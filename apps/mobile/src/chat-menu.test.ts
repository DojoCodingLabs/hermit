import { test } from "node:test";
import assert from "node:assert/strict";
import { chatMenuItems } from "./chat-menu.ts";

test("HM-BOT-02: the menu offers what fits the moment", () => {
  assert.deepEqual(chatMenuItems({ busy: false, empty: false, olderChats: 2 }), ["newChat", "olderChats", "botSettings", "clear"]);
  assert.deepEqual(chatMenuItems({ busy: true, empty: false, olderChats: 0 }), ["botSettings"]);
  assert.deepEqual(chatMenuItems({ busy: false, empty: true, olderChats: 0 }), ["botSettings"]);
});
