import { describe, expect, test } from "vitest";
import { calendarChoice, writeTarget, type PhoneCalendar } from "../src/calendars.ts";

const work: PhoneCalendar = { id: "w", title: "Work", writable: true, account: "me@work.example" };
const home: PhoneCalendar = { id: "h", title: "Personal", writable: true, primary: true };
const holidays: PhoneCalendar = { id: "x", title: "Holidays", writable: false };

describe("writeTarget (US-CAL-03: which calendar calendar_add writes to)", () => {
  test("the chosen calendar when it is still there and writable", () => {
    expect(writeTarget([home, work, holidays], "w")?.id).toBe("w");
  });

  test("no choice: the primary writable calendar", () => {
    expect(writeTarget([work, home, holidays])?.id).toBe("h");
  });

  test("a chosen calendar that is gone or read-only falls back to the primary", () => {
    expect(writeTarget([home, work], "deleted")?.id).toBe("h");
    expect(writeTarget([home, work, holidays], "x")?.id).toBe("h");
  });

  test("no primary: the first writable one; none writable: nothing", () => {
    expect(writeTarget([holidays, work])?.id).toBe("w");
    expect(writeTarget([holidays])).toBeUndefined();
    expect(writeTarget([])).toBeUndefined();
  });
});

describe("calendarChoice (HM-CAL-02)", () => {
  test("lists only writable calendars, primary first, then by title", () => {
    const c = calendarChoice([work, holidays, { id: "a", title: "Aardvark club", writable: true }, home]);
    expect(c.options.map((o) => o.id)).toEqual(["h", "a", "w"]);
  });

  test("the selected one is the calendar writes really go to", () => {
    expect(calendarChoice([home, work], "w")).toMatchObject({ selectedId: "w", chosenGone: false });
    expect(calendarChoice([home, work])).toMatchObject({ selectedId: "h", chosenGone: false });
  });

  test("a stored choice that no longer exists is flagged, and the fallback is shown as selected", () => {
    expect(calendarChoice([home, work], "deleted")).toMatchObject({ selectedId: "h", chosenGone: true });
  });

  test("no writable calendar at all is empty, never an error", () => {
    expect(calendarChoice([holidays])).toEqual({ options: [], chosenGone: false });
  });
});
