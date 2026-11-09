import "fake-indexeddb/auto";
import { describe, it, expect } from "vitest";
import { DateTime } from "luxon";
import { type PlanEvent, type Row, newEvent } from "./model";
import { periodRows } from "./planning";
import { expand, effectiveSchedule, conflicts } from "./engine";
import { calendarDayTime, calendarWarnings } from "./calendar";
import { db, selectAccount } from "./store";
import { saveShiftPeriod } from "./shiftPeriods";
const zone = "Europe/Moscow",
  day = DateTime.fromISO("2026-11-10", { zone });
const hours = {
  dayStart: "08:30",
  dayEnd: "20:30",
  nightStart: "20:30",
  nightEnd: "08:30",
};
const row = (id: string, p: Partial<PlanEvent>): Row => ({
  id,
  type: "event",
  payload: { ...newEvent("2026-11-10", zone), ...p },
  deleted: false,
  dirty: false,
  revision: 1,
  mutationId: "test",
});
const base = row("base", {
  kind: "work",
  repeat: "weekly",
  workLayer: "base",
  time: "09:00",
  endTime: "18:00",
});
const records = (choices: Parameters<typeof periodRows>[4], override = {}) =>
  periodRows("g", "2026-11-09", "2026-11-12", zone, choices, {
    ...hours,
    ...override,
  }).map((r) => row(r.id, r.event));
const schedule = (rows: Row[], from = day, to = day.plus({ days: 1 })) =>
  effectiveSchedule(expand(rows, from, to)).effective;
describe("post-night day is work, approximate sleep, then a free evening", () => {
  it("automatically reserves sleep after the November 22–23 night across the week and editing-period boundary", () => {
    const monday = DateTime.fromISO("2026-11-23", { zone });
    const shifts = periodRows(
      "nov22",
      "2026-11-22",
      "2026-11-22",
      zone,
      { "2026-11-22": "night" },
      hours,
    ).map((r) => row(r.id, r.event));
    const result = schedule(
      [base, ...shifts],
      monday,
      monday.plus({ days: 7 }),
    );
    const work = result.filter(
      (o) =>
        o.event.kind === "work" &&
        o.start < monday.plus({ days: 1 }).toMillis(),
    );
    expect(work).toHaveLength(1);
    expect(calendarDayTime(work[0], monday)).toBe("00:00–08:30");
    const sleep = result.filter((o) => o.event.kind === "recovery");
    expect(sleep).toHaveLength(1);
    expect(calendarDayTime(sleep[0], monday)).toBe("08:30–16:30");
    expect(sleep[0].derivedFromNight).toBe(true);
    expect(
      result.some(
        (o) =>
          o.sourceId === "base" &&
          calendarDayTime(o, monday) === "09:00–18:00" &&
          o.start < monday.plus({ days: 1 }).toMillis(),
      ),
    ).toBe(false);
    expect(
      result.some(
        (o) =>
          o.sourceId === "base" &&
          DateTime.fromMillis(o.start, { zone }).toISODate() === "2026-11-24",
      ),
    ).toBe(true);
  });
  it("keeps the post-night rule when a view starts after the actual shift ended, and inherits old period settings", () => {
    const monday = DateTime.fromISO("2026-11-23", { zone });
    const shifts = periodRows(
      "nov22",
      "2026-11-22",
      "2026-11-22",
      zone,
      { "2026-11-22": "night" },
      { ...hours, sleepHours: 9 },
    ).map((r) => row(r.id, r.event));
    (shifts[1].payload as PlanEvent).sleepHours = undefined;
    const result = schedule(
      [base, ...shifts],
      monday.plus({ hours: 17 }),
      monday.plus({ hours: 20 }),
    );
    expect(result.some((o) => o.sourceId === "base")).toBe(false);
    expect(
      calendarDayTime(
        result.find((o) => o.event.kind === "recovery")!,
        monday,
      ),
    ).toBe("08:30–17:30");
  });
  it("does not duplicate an explicitly marked sleep and respects its custom duration", () => {
    const recordsWithSleep = records(
      { "2026-11-09": "night", "2026-11-10": "recovery" },
      { sleepHours: 7 },
    );
    const result = schedule([base, ...recordsWithSleep]);
    expect(result.filter((o) => o.event.kind === "recovery")).toHaveLength(1);
    expect(
      calendarDayTime(
        result.find((o) => o.event.kind === "recovery")!,
        day,
      ),
    ).toBe("08:30–15:30");
  });
  it("recognizes an overnight work interval by its times even when its title is custom", () => {
    const result = schedule([
      row("custom", {
        kind: "work",
        title: "Дежурство",
        date: "2026-11-09",
        time: "21:00",
        endTime: "09:00",
      }),
    ]);
    expect(
      calendarDayTime(
        result.find((o) => o.event.kind === "recovery")!,
        day,
      ),
    ).toBe("09:00–17:00");
  });
  it("does not turn a daytime shift into sleep or erase an explicitly entered next shift", () => {
    expect(
      schedule(records({ "2026-11-10": "day" })).some(
        (o) => o.event.kind === "recovery",
      ),
    ).toBe(false);
    const result = schedule(
      records({ "2026-11-09": "night", "2026-11-10": "day" }),
    );
    expect(result.some((o) => o.event.title === "Дневная смена")).toBe(true);
    expect(conflicts(result).some((c) => c.severity === "info")).toBe(true);
  });
  it("removes inferred sleep when the night or its period is deleted or disabled", () => {
    for (const target of [0, 1])
      for (const update of [{ deleted: true }, { enabled: false }]) {
        const shifts = records({ "2026-11-09": "night" });
        if ("deleted" in update) shifts[target].deleted = true;
        else (shifts[target].payload as PlanEvent).enabled = false;
        expect(
          schedule([base, ...shifts]).some((o) => o.event.kind === "recovery"),
        ).toBe(false);
      }
  });
  it("preserves consecutive explicitly configured overnight work in the base week", () => {
    const result = schedule(
      [
        row("base-night", {
          kind: "work",
          repeat: "weekly",
          weekdays: [1, 2],
          date: "2026-11-09",
          time: "20:30",
          endTime: "08:30",
          workLayer: "base",
        }),
      ],
      day.minus({ days: 1 }),
      day.plus({ days: 2 }),
    );
    expect(result.filter((o) => o.event.kind === "work")).toHaveLength(2);
    expect(result.filter((o) => o.event.kind === "recovery")).toHaveLength(2);
  });
  it("marks only the remaining work and eight hours of sleep even when yesterday was not entered", () => {
    const result = schedule([base, ...records({ "2026-11-10": "recovery" })]);
    expect(result.map((o) => [o.event.kind, calendarDayTime(o, day)])).toEqual([
      ["work", "00:00–08:30"],
      ["recovery", "08:30–16:30"],
    ]);
    expect(conflicts(result)).toEqual([]);
    expect(
      schedule(
        [base, ...records({ "2026-11-10": "recovery" })],
        day.plus({ hours: 17 }),
        day.plus({ hours: 20 }),
      ),
    ).toEqual([]);
  });
  it("keeps the actual overnight shift without counting its morning twice", () => {
    const result = schedule([
      base,
      ...records({ "2026-11-09": "night", "2026-11-10": "recovery" }),
    ]);
    const work = result.filter((o) => o.event.kind === "work");
    expect(work).toHaveLength(1);
    expect(work[0].end - work[0].start).toBe(12 * 3600000);
    expect(calendarDayTime(work[0], day)).toBe("00:00–08:30");
    expect(calendarDayTime(work[0], day.minus({ days: 1 }))).toBe(
      "20:30–24:00",
    );
  });
  it("warns during sleep including travel, while leaving the evening available", () => {
    const result = schedule([
      ...records({ "2026-11-10": "recovery" }),
      row("early", {
        kind: "activity",
        status: "available",
        time: "16:30",
        endTime: "17:30",
        before: 30,
      }),
      row("evening", {
        kind: "activity",
        status: "available",
        time: "17:00",
        endTime: "18:00",
        before: 30,
      }),
    ]);
    const warnings = calendarWarnings(result);
    expect(warnings.get("early@2026-11-10")).toMatchObject([
      { severity: "info", other: { event: { kind: "recovery" } } },
    ]);
    expect(warnings.has("evening@2026-11-10")).toBe(false);
  });
  it("uses the configured night end and sleep duration", () => {
    const result = schedule(
      records(
        { "2026-11-10": "recovery" },
        { nightEnd: "09:00", sleepHours: 7.5 },
      ),
    );
    expect(result.map((o) => calendarDayTime(o, day))).toEqual([
      "00:00–09:00",
      "09:00–16:30",
    ]);
  });
  it("updates old all-day shift marks in the effective view without modifying saved rows", () => {
    const saved = records(
      { "2026-11-09": "night", "2026-11-10": "recovery" },
      { nightEnd: "09:00" },
    );
    const rest = saved.find(
      (r) => (r.payload as PlanEvent).kind === "recovery",
    )!;
    rest.payload = {
      ...(rest.payload as PlanEvent),
      time: "00:00",
      endTime: "00:00",
      sleepHours: undefined,
      title: "Восстановление",
    };
    const before = JSON.stringify(saved);
    expect(
      calendarDayTime(
        schedule([base, ...saved]).find((o) => o.event.kind === "recovery")!,
        day,
      ),
    ).toBe("09:00–17:00");
    expect(JSON.stringify(saved)).toBe(before);
  });
  it("does not lose early-morning work when the view ends before sleep begins", () => {
    const result = schedule(
      [base, ...records({ "2026-11-10": "recovery" })],
      day,
      day.plus({ hours: 8 }),
    );
    expect(result).toHaveLength(1);
    expect(result[0].event.kind).toBe("work");
    expect(calendarDayTime(result[0], day)).toBe("00:00–08:30");
  });
  it("keeps a sleep interval that crosses midnight and frees time only after it ends", () => {
    const result = schedule(
      records(
        { "2026-11-10": "recovery" },
        { nightEnd: "18:00", sleepHours: 8 },
      ),
      day,
      day.plus({ days: 2 }),
    );
    const rest = result.find((o) => o.event.kind === "recovery")!;
    expect(rest.end - rest.start).toBe(8 * 3600000);
    expect(calendarDayTime(rest, day)).toBe("18:00–24:00");
    expect(calendarDayTime(rest, day.plus({ days: 1 }))).toBe("00:00–02:00");
  });
  it("persists the sleep setting and restores ordinary work when the day is cleared", async () => {
    await selectAccount("post-night-test");
    await db.rows.clear();
    await saveShiftPeriod(
      "g",
      "2026-11-09",
      "2026-11-12",
      zone,
      { "2026-11-10": "recovery" },
      { ...hours, sleepHours: 9 },
    );
    await db.close();
    await db.open();
    expect((await db.rows.get("g:period"))?.payload).toMatchObject({
      sleepHours: 9,
    });
    expect(
      calendarDayTime(
        schedule(await db.rows.toArray()).find(
          (o) => o.event.kind === "recovery",
        )!,
        day,
      ),
    ).toBe("08:30–17:30");
    await saveShiftPeriod("g", "2026-11-09", "2026-11-12", zone, {}, hours);
    expect(
      schedule([base, ...(await db.rows.toArray())]).map((o) =>
        calendarDayTime(o, day),
      ),
    ).toEqual(["09:00–18:00"]);
    db.close();
  });
});
