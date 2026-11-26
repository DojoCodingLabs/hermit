// HM-BOT-02: what a bot chat's menu offers. A turn in flight, or nothing said yet, leaves the bot's settings; a new
// chat or a clear only makes sense once there is something to leave behind, and older chats only when there are some.
export type ChatMenuItem = "newChat" | "olderChats" | "botSettings" | "clear";

export function chatMenuItems(o: { busy: boolean; empty: boolean; olderChats: number }): ChatMenuItem[] {
  const idle = !o.busy;
  const said = idle && !o.empty;
  return [
    ...(said ? (["newChat"] as const) : []),
    ...(idle && o.olderChats > 0 ? (["olderChats"] as const) : []),
    "botSettings",
    ...(said ? (["clear"] as const) : []),
  ];
}
