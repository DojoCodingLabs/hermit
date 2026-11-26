import * as Calendar from "expo-calendar";
import { Linking } from "react-native";
import { writeTarget, type CalendarEvent, type CalendarPort, type PhoneCalendar } from "@hermit/core";

/**
 * FR-CAL-01 over the SDK 58 calendar objects. Writes go to the calendar chosen on HM-CAL-02
 * (the runtime passes it from the `calendar.id` setting), else a primary writable one (`writeTarget`).
 */
export function phoneCalendar(): CalendarPort {
  const all = () => Calendar.getCalendars(Calendar.EntityTypes.EVENT);
  const describe = (c: Calendar.ExpoCalendar): PhoneCalendar => ({
    id: c.id,
    title: c.title,
    writable: c.allowsModifications,
    ...(c.isPrimary ? { primary: true } : {}),
    ...(c.source?.name && c.source.name !== c.title ? { account: c.source.name } : {}),
  });
  return {
    async list(from, to): Promise<CalendarEvent[]> {
      const calendars = await all();
      if (!calendars.length) return [];
      const events = await Calendar.listEvents(calendars, new Date(from), new Date(to));
      // W1: an all-day event's instants are Android's UTC midnights; the skill reads them as dates (allDayDates).
      return events.map((e) => ({ title: e.title ?? "", start: Date.parse(String(e.startDate)), end: Date.parse(String(e.endDate)), calendar: e.calendarId, ...(e.allDay ? { allDay: true } : {}) }));
    },
    async add(event, opts) {
      const calendars = await all();
      const target = writeTarget(calendars.map(describe), opts?.calendarId);
      const native = target && calendars.find((c) => c.id === target.id);
      if (!native) throw new Error("No writable calendar on this phone.");
      await native.createEvent({ title: event.title, startDate: new Date(event.start), endDate: new Date(event.end) });
    },
    async calendars() {
      return (await all()).map(describe);
    },
  };
}

export async function requestCalendarPermission(): Promise<boolean> {
  return (await Calendar.requestCalendarPermissions()).granted;
}

/** HM-CAL-02 and HM-REM-01 check without prompting (ST-FORBIDDEN shows Open settings instead). */
export async function calendarPermissionGranted(): Promise<boolean> {
  return (await Calendar.getCalendarPermissions()).granted;
}

/** Hermit's page in the system settings, where a denied calendar permission is turned back on. */
export function openAppSettings(): Promise<void> {
  return Linking.openSettings();
}
