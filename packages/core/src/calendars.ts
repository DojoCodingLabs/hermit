/** A calendar on the phone, as HM-CAL-02 lists it (US-CAL-03). */
export interface PhoneCalendar {
  id: string;
  title: string;
  /** Hermit can add events to it (read-only calendars, like holidays or shared ones, are never offered). */
  writable: boolean;
  primary?: boolean;
  /** The account it syncs with, shown under the title so two "Calendar" entries can be told apart. */
  account?: string;
}

/**
 * Where calendar_add writes: the chosen calendar while it exists and is writable, else the primary
 * writable one, else the first writable one. A choice that disappeared never blocks adding an event.
 */
export function writeTarget(calendars: readonly PhoneCalendar[], chosenId?: string): PhoneCalendar | undefined {
  const writable = calendars.filter((c) => c.writable);
  return (chosenId ? writable.find((c) => c.id === chosenId) : undefined) ?? writable.find((c) => c.primary) ?? writable[0];
}

export interface CalendarChoice {
  /** Writable calendars only, primary first, then by title. */
  options: PhoneCalendar[];
  /** The calendar writes really go to right now (the fallback when the stored choice is gone). */
  selectedId?: string;
  /** A stored choice that no longer exists or became read-only (the screen says where writes go now). */
  chosenGone: boolean;
}

export function calendarChoice(calendars: readonly PhoneCalendar[], chosenId?: string): CalendarChoice {
  const options = calendars
    .filter((c) => c.writable)
    .sort((a, b) => Number(Boolean(b.primary)) - Number(Boolean(a.primary)) || a.title.localeCompare(b.title));
  const target = writeTarget(options, chosenId);
  return {
    options,
    ...(target ? { selectedId: target.id } : {}),
    chosenGone: Boolean(chosenId && target && target.id !== chosenId),
  };
}
