import * as Notifications from "expo-notifications";
import type { NotifierPort } from "@hermit/core";

const CHANNEL = "reminders";

/** Exact local alarms for reminders (FR-REM-01). Survive reboot via RECEIVE_BOOT_COMPLETED. */
export async function reminderNotifier(): Promise<NotifierPort> {
  await Notifications.setNotificationChannelAsync(CHANNEL, { name: "Reminders", importance: Notifications.AndroidImportance.HIGH });
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
  });
  return {
    async schedule({ id, at, title }) {
      const exact = await Notifications.getExactAlarmPermissionsAsync().catch(() => undefined);
      console.log("[hermit] reminder alarm: exact permission", exact?.granted ?? "unknown");
      return Notifications.scheduleNotificationAsync({
        identifier: `reminder-${id}`,
        content: { title, data: { reminderId: id } },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at, channelId: CHANNEL },
      });
    },
    async cancel(notificationId) {
      await Notifications.cancelScheduledNotificationAsync(notificationId);
    },
  };
}

/** Notifications plus exact alarms; without the exact-alarm grant Android delivers late (Android 14+ denies by default). */
export async function requestReminderAccess(): Promise<boolean> {
  const n = await Notifications.requestPermissionsAsync();
  if (!n.granted) return false;
  const exact = await Notifications.getExactAlarmPermissionsAsync();
  return exact.granted || (await Notifications.requestExactAlarmPermissionsAsync()).granted;
}
