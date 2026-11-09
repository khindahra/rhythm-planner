import { describe, it, expect } from "vitest";
import { DateTime } from "luxon";
import { newEvent, defaultSettings, type PlanEvent, type Row } from "./model";
import { expand, conflicts, requiredActions } from "./engine";
import {
  calendarWarnings,
  calendarTitle,
  calendarTime,
  calendarDayTime,
  calendarWindow,
  daySegments,
  layoutSegments,
} from "./calendar";
const zone = "Europe/Moscow";
const day = DateTime.fromISO("2026-11-09", { zone });
function items(...parts: Partial<PlanEvent>[]) {
  return expand(
    parts.map((p, i): Row => ({
      id: String(i),
      type: "event",
      payload: { ...newEvent("2026-11-09", zone), ...p },
      deleted: false,
      revision: 1,
      dirty: false,
      mutationId: "test",
    })),
    day,
    day.plus({ days: 2 }),
  );
}
describe("calendar options and precise intervals", () => {
  it("shows the full 18:30–20:30 window for a 19:00–20:00 studio class without changing its booking deadline", () => {
    const [lesson] = items({
      kind: "activity",
      title: "Зумба",
      time: "19:00",
      endTime: "20:00",
      before: 30,
      after: 30,
      bookingRequired: true,
      bookingLead: 120,
    });
    expect(calendarTime(lesson, zone)).toBe("18:30–20:30");
    expect(calendarDayTime(lesson, day)).toBe("18:30–20:30");
    expect(daySegments([lesson], day)[0]).toMatchObject({
      startMinute: 1110,
      endMinute: 1230,
    });
    expect(DateTime.fromMillis(lesson.start, { zone }).toFormat("HH:mm")).toBe(
      "19:00",
    );
    expect(DateTime.fromMillis(lesson.end, { zone }).toFormat("HH:mm")).toBe(
      "20:00",
    );
    const booking = [
      ...requiredActions([lesson], [], defaultSettings).values(),
    ].find((a) => a.kind === "booking")!;
    expect(DateTime.fromISO(booking.due).setZone(zone).toFormat("HH:mm")).toBe(
      "17:00",
    );
  });
  it("includes preparation on the previous day and return travel on the next day", () => {
    const [early] = items({
      kind: "activity",
      time: "00:15",
      endTime: "01:00",
      before: 30,
    });
    expect(calendarDayTime(early, day.minus({ days: 1 }))).toBe("23:45–24:00");
    expect(daySegments([early], day.minus({ days: 1 }))[0]).toMatchObject({
      startMinute: 1425,
      endMinute: 1440,
    });
    const [late] = items({
      kind: "activity",
      time: "23:00",
      endTime: "23:45",
      after: 30,
    });
    expect(calendarDayTime(late, day.plus({ days: 1 }))).toBe("00:00–00:15");
    expect(daySegments([late], day.plus({ days: 1 }))[0]).toMatchObject({
      startMinute: 0,
      endMinute: 15,
    });
  });
  it("places classes in separate columns when their travel windows overlap", () => {
    const list = items(
      {
        kind: "activity",
        time: "19:00",
        endTime: "20:00",
        before: 30,
        after: 30,
      },
      {
        kind: "activity",
        time: "20:00",
        endTime: "21:00",
        before: 30,
        after: 30,
      },
    );
    expect(
      layoutSegments(daySegments(list, day)).map((s) => [s.column, s.columns]),
    ).toEqual([
      [0, 2],
      [1, 2],
    ]);
  });
  it("orders the day agenda by the start of the entire occupied interval", () => {
    const list = items(
      { kind: "activity", time: "19:00", endTime: "20:00", before: 60 },
      { kind: "activity", time: "18:30", endTime: "19:00" },
    );
    expect(
      daySegments(list, day).map((s) => calendarDayTime(s.item, day)),
    ).toEqual(["18:00–20:00", "18:30–19:00"]);
    const work = items({
      kind: "work",
      time: "09:00",
      endTime: "18:00",
      before: 30,
    })[0];
    expect(calendarWindow(work)).toEqual({ start: work.start, end: work.end });
  });
  it("shows work and both bounds instead of the base-week title", () => {
    const [work, spanish] = items(
      {
        kind: "work",
        title: "Обычная рабочая неделя",
        time: "09:00",
        endTime: "18:00",
      },
      { kind: "activity", title: "Испанский", time: "19:00", endTime: "20:30" },
    );
    expect(`${calendarTime(work, zone)} ${calendarTitle(work)}`).toBe(
      "09:00–18:00 Работа",
    );
    expect(`${calendarTime(spanish, zone)} ${calendarTitle(spanish)}`).toBe(
      "19:00–20:30 Испанский",
    );
  });
  it("warns about travel overlap for an option without creating tasks", () => {
    const list = items(
      { kind: "work", time: "09:00", endTime: "18:00" },
      {
        kind: "activity",
        time: "18:15",
        endTime: "19:15",
        before: 30,
        status: "available",
        bookingRequired: true,
        attendanceMode: "booking",
      },
    );
    expect(calendarWarnings(list).get(list[1].id)).toMatchObject([
      { potential: true, severity: "hard", other: { id: list[0].id } },
    ]);
    expect(calendarWarnings(list).has(list[0].id)).toBe(false);
    expect(conflicts(list)).toEqual([]);
    expect(requiredActions(list, conflicts(list), defaultSettings).size).toBe(
      0,
    );
  });
  it("keeps an already chosen impossible visit as a conflict without suggesting booking", () => {
    const list = items(
      { kind: "work", time: "09:00", endTime: "18:00" },
      {
        kind: "activity",
        time: "17:00",
        endTime: "18:30",
        status: "selected",
        bookingRequired: true,
        attendanceMode: "booking",
      },
    );
    expect(calendarWarnings(list).get(list[1].id)).toMatchObject([
      { potential: false, severity: "hard" },
    ]);
    const actions = [
      ...requiredActions(list, conflicts(list), defaultSettings).values(),
    ];
    expect(actions.some((a) => a.kind === "booking")).toBe(false);
    expect(actions.some((a) => a.kind === "conflict")).toBe(true);
  });
  it("does not flag mutually exclusive options, cancelled events, off days, or touching intervals", () => {
    const list = items(
      {
        kind: "activity",
        status: "available",
        time: "18:00",
        endTime: "19:00",
      },
      {
        kind: "activity",
        status: "available",
        time: "18:00",
        endTime: "19:00",
      },
      { kind: "work", time: "09:00", endTime: "18:00" },
      { time: "18:00", endTime: "19:00", status: "cancelled" },
      { kind: "off", time: "18:00", endTime: "19:00" },
    );
    expect(calendarWarnings(list).size).toBe(0);
  });
  it("distinguishes recovery from hard conflicts", () => {
    const list = items(
      { kind: "recovery", time: "09:00", endTime: "18:00" },
      {
        kind: "activity",
        status: "available",
        time: "10:00",
        endTime: "11:00",
      },
    );
    expect(calendarWarnings(list).get(list[1].id)).toMatchObject([
      { potential: true, severity: "info" },
    ]);
  });
  it("clips an overnight shift to each local day and shows the end date offset", () => {
    const list = items({ kind: "work", time: "20:00", endTime: "08:30" });
    expect(calendarTime(list[0], zone)).toBe("20:00–08:30 (+1 дн.)");
    expect(daySegments(list, day)[0]).toMatchObject({
      startMinute: 1200,
      endMinute: 1440,
    });
    expect(daySegments(list, day.plus({ days: 1 }))[0]).toMatchObject({
      startMinute: 0,
      endMinute: 510,
    });
    expect(calendarTime(list[0], "Asia/Yekaterinburg")).toBe(
      "22:00–10:30 (+1 дн.)",
    );
  });
  it("places simultaneous alternatives in separate columns and reuses a free column", () => {
    const list = items(
      { time: "10:00", endTime: "11:00" },
      { time: "10:30", endTime: "12:00" },
      { time: "11:00", endTime: "12:00" },
      { time: "12:00", endTime: "13:00" },
    );
    const result = layoutSegments(daySegments(list, day));
    expect(result.map((s) => [s.column, s.columns])).toEqual([
      [0, 2],
      [1, 2],
      [0, 2],
      [0, 1],
    ]);
  });
  it("accounts for minimum visible card height when assigning columns", () => {
    const result = layoutSegments(
      daySegments(
        items(
          { time: "10:00", endTime: "10:05" },
          { time: "10:10", endTime: "10:15" },
        ),
        day,
      ),
      40,
    );
    expect(result.map((s) => s.column)).toEqual([0, 1]);
  });
});
