import "fake-indexeddb/auto";
import { beforeEach, describe, it, expect } from "vitest";
import { DateTime } from "luxon";
import { newEvent, type PlanEvent, type Row } from "./model";
import { periodRows } from "./planning";
import { expand, effectiveSchedule, conflicts } from "./engine";
import { saveShiftPeriod } from "./shiftPeriods";
import { db, save, selectAccount } from "./store";
const zone = "Europe/Moscow",
  start = DateTime.fromISO("2026-11-09", { zone });
const hours = {
  dayStart: "08:30",
  dayEnd: "20:30",
  nightStart: "20:30",
  nightEnd: "08:30",
};
const record = (id: string, event: PlanEvent): Row => ({
  id,
  type: "event",
  payload: event,
  revision: 1,
  deleted: false,
  dirty: false,
  mutationId: "test",
});
const base = record("base", {
  ...newEvent("2026-11-09", zone),
  kind: "work",
  title: "Обычная неделя",
  repeat: "weekly",
  time: "09:00",
  endTime: "18:00",
  workLayer: "base",
});
const schedule = (rows: Row[], from = start, to = start.plus({ days: 7 })) =>
  effectiveSchedule(expand(rows, from, to)).effective;
const byDay = (rows: Row[]) =>
  Object.fromEntries(
    schedule(rows)
      .filter((o) => o.event.kind === "work")
      .map((o) => [
        DateTime.fromMillis(o.start, { zone }).toISODate(),
        `${DateTime.fromMillis(o.start, { zone }).toFormat("HH:mm")}–${DateTime.fromMillis(o.end, { zone }).toFormat("HH:mm")}`,
      ]),
  );
describe("situational shifts fall back to the ordinary week", () => {
  it("replaces one known shift and preserves ordinary hours on every unmarked workday", () => {
    const rows = periodRows(
      "g",
      "2026-11-09",
      "2026-11-30",
      zone,
      { "2026-11-11": "day" },
      hours,
    ).map((r) => record(r.id, r.event));
    expect(byDay([base, ...rows])).toEqual({
      "2026-11-09": "09:00–18:00",
      "2026-11-10": "09:00–18:00",
      "2026-11-11": "08:30–20:30",
      "2026-11-12": "09:00–18:00",
      "2026-11-13": "09:00–18:00",
    });
  });
  it("an explicit day off suppresses only that day, while an empty period changes nothing", () => {
    const off = periodRows(
      "g",
      "2026-11-09",
      "2026-11-30",
      zone,
      { "2026-11-11": "off" },
      hours,
    ).map((r) => record(r.id, r.event));
    expect(Object.keys(byDay([base, ...off]))).toEqual([
      "2026-11-09",
      "2026-11-10",
      "2026-11-12",
      "2026-11-13",
    ]);
    const empty = periodRows(
      "g",
      "2026-11-09",
      "2026-11-30",
      zone,
      {},
      hours,
    ).map((r) => record(r.id, r.event));
    expect(byDay([base, ...empty])).toEqual(byDay([base]));
  });
  it("keeps an overnight shift, adds sleep on the following day, and supports a view that starts after midnight", () => {
    const rows = periodRows(
      "g",
      "2026-11-09",
      "2026-11-30",
      zone,
      { "2026-11-09": "night" },
      hours,
    ).map((r) => record(r.id, r.event));
    const result = schedule([base, ...rows]);
    const night = result.find((o) => o.event.title === "Ночная смена")!;
    expect(night.end - night.start).toBe(12 * 3600000);
    expect(byDay([base, ...rows])["2026-11-10"]).toBeUndefined();
    expect(byDay([base, ...rows])["2026-11-11"]).toBe("09:00–18:00");
    expect(
      schedule(
        [base, ...rows],
        start.plus({ days: 1 }),
        start.plus({ days: 2 }),
      ).some((o) => o.event.title === "Ночная смена"),
    ).toBe(true);
  });
  it("applies an explicit known shift for a partial-day view even before the shift starts", () => {
    const rows = periodRows(
      "g",
      "2026-11-09",
      "2026-11-30",
      zone,
      { "2026-11-09": "night" },
      hours,
    ).map((r) => record(r.id, r.event));
    expect(
      schedule(
        [base, ...rows],
        start.plus({ hours: 9 }),
        start.plus({ hours: 12 }),
      ).some((o) => o.sourceId === "base"),
    ).toBe(false);
  });
  it("restores the base week when a period is disabled or deleted without individually changing its child rows", () => {
    const rows = periodRows(
      "g",
      "2026-11-09",
      "2026-11-30",
      zone,
      { "2026-11-11": "off" },
      hours,
    ).map((r) => record(r.id, r.event));
    for (const change of [
      { deleted: true },
      { payload: { ...(rows[0].payload as PlanEvent), enabled: false } },
    ])
      expect(
        byDay([base, { ...rows[0], ...change }, ...rows.slice(1)]),
      ).toEqual(byDay([base]));
  });
  it("detects a class conflicting with ordinary work on an unmarked day", () => {
    const rows = periodRows(
      "g",
      "2026-11-09",
      "2026-11-30",
      zone,
      { "2026-11-11": "day" },
      hours,
    ).map((r) => record(r.id, r.event));
    const spanish = record("spanish", {
      ...newEvent("2026-11-10", zone),
      kind: "activity",
      time: "12:00",
      endTime: "13:00",
    });
    expect(
      conflicts(schedule([base, ...rows, spanish])).some(
        (c) => c.a.sourceId === "spanish" || c.b.sourceId === "spanish",
      ),
    ).toBe(true);
  });
});
describe("saving and clearing sparse periods", () => {
  beforeEach(async () => {
    await selectAccount("sparse-shifts-test");
    await db.rows.clear();
    await save("event", base.payload, "base");
  });
  it("saves a single marked day, reopens from IndexedDB, and restores ordinary work after that mark is cleared", async () => {
    await saveShiftPeriod(
      "g",
      "2026-11-09",
      "2026-11-30",
      zone,
      { "2026-11-11": "off" },
      hours,
    );
    await db.close();
    await db.open();
    expect(byDay(await db.rows.toArray())["2026-11-11"]).toBeUndefined();
    await saveShiftPeriod("g", "2026-11-09", "2026-11-30", zone, {}, hours);
    await db.close();
    await db.open();
    expect(byDay(await db.rows.toArray())).toEqual(byDay([base]));
    expect((await db.rows.get("g:2026-11-11"))?.deleted).toBe(true);
  });
});
