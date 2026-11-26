import type { MessageStore, ReplySenderPort } from "@hermit/core";
import { File, Paths } from "expo-file-system";
import { HermitNotifications } from "../../modules/hermit-notifications";

/** FR-MSG-04: replies go through the notification's own reply action. */
export const whatsappReply: ReplySenderPort = {
  send: (handle, text) => HermitNotifications.reply(handle, text),
};

/**
 * FR-MSG-01, FR-MSG-02: drain what arrived while the app was closed, then take messages live.
 * Returns the unsubscribe function.
 */
export async function startCapture(store: MessageStore): Promise<() => void> {
  await store.ingestMany(await HermitNotifications.drainQueue());
  const sub = HermitNotifications.addListener("onCapture", (n) => void store.ingest(n));
  live = sub;
  return () => sub.remove();
}

let live: { remove(): void } | undefined;

/** SL-26: the live listener stops feeding the database; what arrives next waits in the native queue. */
export function stopCapture(): void {
  live?.remove();
  live = undefined;
}

/** SL-26: the queue the native listener keeps in the app's files directory while JavaScript is not running. */
export function deleteCaptureQueue(): void {
  const queue = new File(Paths.document, "hermit-capture-queue.jsonl");
  if (queue.exists) queue.delete();
}

export function notificationAccessEnabled(): boolean {
  return HermitNotifications.isEnabled();
}

export function openNotificationAccessSettings(): void {
  HermitNotifications.openSettings();
}
