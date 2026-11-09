import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";
import { DateTime } from "luxon";
import { calendarStart, periodRows, planVisit } from "./planning";
import { newEvent, defaultSettings, type PlanEvent, type Row } from "./model";
import {
  expand,
  effectiveSchedule,
  conflicts,
  requiredActions,
} from "./engine";
import { db, selectAccount, save, setStatus } from "./store";
import { monthCounts, markAttendance } from "./AttendanceView";
const zone = "Europe/Moscow";
const start = DateTime.fromISO("2026-11-09", { zone });
const record = (id: string, event: PlanEvent): Row => ({
  id,
  type: "event",
  payload: event,
  revision: 0,
  dirty: false,
  deleted: false,
  mutationId: "test",
});
const hours = {
  dayStart: "08:30",
  dayEnd: "20:30",
  nightStart: "20:30",
  nightEnd: "08:30",
};
describe("work periods and ISO calendar", () => {
  it("starts both month and week grids on Monday", () => {
    const sunday = DateTime.fromISO("2026-11-08", { zone });
    expect(calendarStart(sunday, "week").weekday).toBe(1);
    expect(calendarStart(sunday, "month").weekday).toBe(1);
  });
  it("allows a partial period containing only known changes", () => {
    const rows = periodRows(
      "g",
      "2026-11-09",
      "2026-11-10",
      zone,
      { "2026-11-09": "day" },
      hours,
    );
    expect(rows.map((r) => r.id)).toEqual(["g:period", "g:2026-11-09"]);
  });
  it("replaces a base week with exact shifts and days off, then restores it after the period", () => {
    const base = record("base", {
      ...newEvent("2026-11-09", zone),
      kind: "work",
      repeat: "weekly",
      time: "09:00",
      endTime: "18:00",
      workLayer: "base",
    });
    const period = periodRows(
      "g",
      "2026-11-09",
      "2026-11-12",
      zone,
      {
        "2026-11-09": "day",
        "2026-11-10": "night",
        "2026-11-11": "recovery",
        "2026-11-12": "off",
      },
      hours,
    ).map((r) => record(r.id, r.event));
    const result = effectiveSchedule(
      expand([base, ...period], start, start.plus({ days: 5 })),
    ).effective;
    const work = result.filter((o) => o.event.kind === "work");
    expect(work).toHaveLength(3);
    expect(
      work.find((o) => o.event.title === "Ночная смена")!.end -
        work.find((o) => o.event.title === "Ночная смена")!.start,
    ).toBe(12 * 3600000);
    expect(
      work.some(
        (o) =>
          DateTime.fromMillis(o.start, { zone }).toISODate() === "2026-11-12",
      ),
    ).toBe(false);
    expect(
      effectiveSchedule(
        expand(
          [
            base,
            ...period.map((r) => ({
              ...r,
              payload: { ...(r.payload as PlanEvent), enabled: false },
            })),
          ],
          start,
          start.plus({ days: 5 }),
        ),
      ).effective.filter((o) => o.event.kind === "work"),
    ).toHaveLength(5);
  });
});
describe("flexible activities and booking behavior", () => {
  const pool = {
    ...newEvent("2026-11-09", zone),
    kind: "activity" as const,
    title: "Бассейн",
    activityMode: "flexible" as const,
    attendanceMode: "free" as const,
    status: "available" as const,
    duration: 60,
    before: 45,
    after: 75,
  };
  it("never puts a catalog-only pool into the calendar", () =>
    expect(
      expand([record("pool", pool)], start, start.plus({ days: 10 })),
    ).toHaveLength(0));
  it("plans a dated visit with three occupied hours and no booking action", () => {
    const visit = planVisit(pool, "pool", "2026-11-09", "15:00");
    const items = expand(
      [record("visit", visit)],
      start,
      start.plus({ days: 1 }),
    );
    expect(items).toHaveLength(1);
    expect(items[0].occupiedEnd - items[0].occupiedStart).toBe(3 * 3600000);
    expect(requiredActions(items, [], defaultSettings).size).toBe(0);
  });
  it("can plan across midnight and validates optional opening hours", () => {
    expect(planVisit(pool, "pool", "2026-11-09", "23:30").endDate).toBe(
      "2026-11-10",
    );
    expect(() =>
      planVisit(
        { ...pool, openingTime: "08:00", closingTime: "22:00" },
        "pool",
        "2026-11-09",
        "21:30",
      ),
    ).toThrow("часы работы");
  });
  it("generates absence reminders for regular activities without a separate obligation type", () => {
    const spanish = record("spanish", {
      ...newEvent("2026-11-09", zone),
      kind: "activity",
      attendanceMode: "regular",
      bookingRequired: false,
      notifyAbsence: true,
    });
    const work = record("work", {
      ...newEvent("2026-11-09", zone),
      kind: "work",
    });
    const items = expand([spanish, work], start, start.plus({ days: 1 }));
    expect(
      [...requiredActions(items, conflicts(items), defaultSettings).values()]
        .map((a) => a.kind)
        .sort(),
    ).toEqual(["absence", "conflict"]);
  });
  it("does not ask to cancel an unconfirmed booking", () => {
    const items = expand(
      [
        record("dance", {
          ...newEvent("2026-11-09", zone),
          kind: "activity",
          status: "cancelled",
          bookingRequired: true,
          bookingConfirmed: false,
        }),
      ],
      start,
      start.plus({ days: 1 }),
    );
    expect(requiredActions(items, [], defaultSettings).size).toBe(0);
  });
});
describe("visits are separate from plans", () => {
  beforeEach(async () => {
    await selectAccount("visits-test");
    await db.rows.clear();
  });
  it("counts per-activity attendance for the chosen month, ignores tombstones, and deduplicates same-day marks", async () => {
    await markAttendance("Испанский", "2026-11-04");
    await markAttendance("испанский", "2026-11-04");
    await markAttendance("Испанский", "2026-11-07");
    await markAttendance("Зумба", "2026-11-08");
    await markAttendance("Зумба", "2026-10-08");
    const rows = await db.rows.toArray();
    expect(rows).toHaveLength(4);
    expect(
      monthCounts(rows, "2026-11")
        .map((c) => c.count)
        .sort(),
    ).toEqual([1, 2]);
    expect(expand(rows, start, start.plus({ days: 10 }))).toEqual([]);
  });
  it("remembers whether a visit was booked before cancellation", async () => {
    await save(
      "event",
      {
        ...newEvent("2026-11-09", zone),
        kind: "activity",
        bookingRequired: true,
      },
      "dance",
    );
    await setStatus("dance@2026-11-09", "booked");
    await setStatus("dance@2026-11-09", "cancelled");
    expect((await db.rows.get("occ:dance@2026-11-09"))?.payload).toMatchObject({
      bookingConfirmed: true,
    });
  });
});
