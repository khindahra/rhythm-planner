import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DateTime } from "luxon";
import {
  newEvent,
  defaultSettings,
  type PlanEvent,
  type Row,
  type Action,
} from "./model";
import {
  expand,
  effectiveSchedule,
  conflicts,
  requiredActions,
  reconcileActionRows,
} from "./engine";
import {
  workBlockers,
  visibleCalendarItems,
  assertVisitFitsWork,
} from "./availability";
import { activityFormat, planVisit } from "./planning";
import { db, selectAccount, save, setStatus } from "./store";
const zone = "Europe/Moscow",
  day = DateTime.fromISO("2026-11-23", { zone });
const row = (id: string, part: Partial<PlanEvent>): Row => ({
  id,
  type: "event",
  payload: { ...newEvent("2026-11-23", zone), ...part },
  deleted: false,
  revision: 1,
  dirty: false,
  mutationId: "test",
});
const work = row("work", {
  kind: "work",
  title: "Работа",
  time: "09:00",
  endTime: "18:00",
});
const zumba = row("zumba", {
  kind: "activity",
  title: "Зумба",
  time: "17:00",
  endTime: "18:00",
  status: "available",
  activityFormat: "in_person",
});
const spanish = row("spanish", {
  kind: "activity",
  title: "Испанский",
  time: "17:00",
  endTime: "18:00",
  notifyAbsence: true,
  attendanceMode: "regular",
});
const schedule = (rows: Row[]) =>
  effectiveSchedule(expand(rows, day, day.plus({ days: 1 }))).effective;
describe("optional conflict filter", () => {
  it("filters options against chosen plans including travel, keeps touching intervals and alternatives, and never removes booked visits", () => {
    const items = schedule([
      row("plan", { time: "18:00", endTime: "19:00" }),
      row("early", {
        kind: "activity",
        status: "available",
        time: "17:00",
        endTime: "18:00",
        after: 30,
      }),
      row("safe", {
        kind: "activity",
        status: "available",
        time: "19:30",
        endTime: "20:30",
        before: 30,
      }),
      row("alternative", {
        kind: "activity",
        status: "available",
        time: "20:00",
        endTime: "21:00",
      }),
      row("booked", {
        kind: "activity",
        status: "booked",
        time: "18:15",
        endTime: "18:45",
      }),
    ]);
    const before = JSON.stringify(items);
    expect(
      visibleCalendarItems(items).some((o) => o.sourceId === "early"),
    ).toBe(true);
    const filtered = visibleCalendarItems(items, true, false, true).map(
      (o) => o.sourceId,
    );
    expect(filtered).not.toContain("early");
    expect(filtered).toEqual(
      expect.arrayContaining(["plan", "booked", "safe", "alternative"]),
    );
    expect(JSON.stringify(items)).toBe(before);
  });
  it("filters overlaps with sleep but does not treat cancelled plans or days off as busy", () => {
    const items = schedule([
      row("sleep", { kind: "recovery", time: "09:00", endTime: "16:00" }),
      row("early", {
        kind: "activity",
        status: "available",
        time: "16:15",
        endTime: "17:15",
        before: 30,
      }),
      row("cancelled", {
        status: "cancelled",
        time: "20:00",
        endTime: "21:00",
      }),
      row("off", { kind: "off", time: "20:00", endTime: "21:00" }),
      row("evening", {
        kind: "activity",
        status: "available",
        time: "20:00",
        endTime: "21:00",
      }),
    ]);
    expect(
      visibleCalendarItems(items, true, false, true).map((o) => o.sourceId),
    ).toEqual(["sleep", "off", "evening"]);
  });
  it("preserves the online/work exception and filters online classes when they overlap a different plan", () => {
    const online = row("spanish", {
      ...(spanish.payload as PlanEvent),
      status: "available",
    });
    const items = schedule([work, zumba, online]);
    expect(
      visibleCalendarItems(items, true, true, true).map((o) => o.sourceId),
    ).toEqual(["work", "spanish"]);
    const withOtherPlan = schedule([
      work,
      online,
      row("personal", { time: "17:00", endTime: "18:00" }),
    ]);
    expect(
      visibleCalendarItems(withOtherPlan, true, false, true).some(
        (o) => o.sourceId === "spanish",
      ),
    ).toBe(false);
  });
});

describe("leaving home while work is scheduled", () => {
  it("does not ask to book an already selected class that has become impossible because of work", () => {
    const chosen = row("zumba", {
      ...(zumba.payload as PlanEvent),
      status: "selected",
      bookingRequired: true,
    });
    const blocked = schedule([work, chosen]);
    expect(
      [
        ...requiredActions(
          blocked,
          conflicts(blocked),
          defaultSettings,
        ).values(),
      ].some((a) => a.kind === "booking"),
    ).toBe(false);
    const available = schedule([chosen]);
    expect(
      [
        ...requiredActions(
          available,
          conflicts(available),
          defaultSettings,
        ).values(),
      ].some((a) => a.kind === "booking"),
    ).toBe(true);
  });
  it("hides impossible unselected studio classes while keeping online Spanish", () => {
    const items = schedule([work, zumba, spanish]);
    expect(visibleCalendarItems(items).map((o) => o.sourceId)).toEqual([
      "work",
      "spanish",
    ]);
    expect(
      visibleCalendarItems(items, true, true).map((o) => o.sourceId),
    ).toEqual(["work", "zumba", "spanish"]);
    expect(
      visibleCalendarItems(items, false, true).map((o) => o.sourceId),
    ).toEqual(["work", "spanish"]);
  });
  it("includes both travel buffers and allows exactly touching work boundaries", () => {
    for (const part of [
      { time: "18:15", endTime: "19:15", before: 30 },
      { time: "07:30", endTime: "08:45", after: 30 },
    ]) {
      const items = schedule([
        work,
        row("dance", { ...(zumba.payload as PlanEvent), ...part }),
      ]);
      expect(
        visibleCalendarItems(items).some((o) => o.sourceId === "dance"),
      ).toBe(false);
    }
    const items = schedule([
      work,
      row("dance", {
        ...(zumba.payload as PlanEvent),
        time: "18:30",
        endTime: "19:30",
        before: 30,
      }),
    ]);
    expect(
      visibleCalendarItems(items).some((o) => o.sourceId === "dance"),
    ).toBe(true);
  });
  it("keeps already chosen or booked visits visible for cancellation", () => {
    for (const status of ["selected", "booked"] as const) {
      const items = schedule([
        work,
        row("zumba", { ...(zumba.payload as PlanEvent), status }),
      ]);
      expect(
        visibleCalendarItems(items).some((o) => o.sourceId === "zumba"),
      ).toBe(true);
      expect(
        workBlockers(
          items.find((o) => o.sourceId === "zumba")!,
          items,
        ),
      ).toHaveLength(1);
      expect(conflicts(items)[0].severity).toBe("hard");
    }
  });
  it("recalculates without deleting classes when work is disabled or replaced with time off", () => {
    const before = JSON.stringify(zumba);
    expect(
      visibleCalendarItems(schedule([work, zumba])).some(
        (o) => o.sourceId === "zumba",
      ),
    ).toBe(false);
    expect(
      visibleCalendarItems(
        schedule([
          {
            ...work,
            payload: { ...(work.payload as PlanEvent), enabled: false },
          },
          zumba,
        ]),
      ).some((o) => o.sourceId === "zumba"),
    ).toBe(true);
    expect(
      visibleCalendarItems(
        schedule([
          work,
          zumba,
          row("off", {
            kind: "override",
            time: "00:00",
            endTime: "00:00",
            overrideMode: "suppress",
          }),
        ]),
      ).some((o) => o.sourceId === "zumba"),
    ).toBe(true);
    expect(JSON.stringify(zumba)).toBe(before);
  });
  it("does not hide options merely for overlapping sleep", () => {
    const items = schedule([
      zumba,
      row("sleep", { kind: "recovery", time: "10:00", endTime: "18:00" }),
    ]);
    expect(
      visibleCalendarItems(items).some((o) => o.sourceId === "zumba"),
    ).toBe(true);
  });
  it("defaults existing Spanish titles to online and lets an explicit setting override it", () => {
    for (const title of ["Испанский", "Español", "Espanol", "Spanish"]) {
      const e = {
        ...newEvent("2026-11-23", zone),
        kind: "activity" as const,
        title,
      };
      expect(activityFormat(e)).toBe("online");
      expect(activityFormat({ ...e, activityFormat: "in_person" })).toBe(
        "in_person",
      );
    }
    expect(activityFormat(zumba.payload as PlanEvent)).toBe("in_person");
    expect(
      activityFormat({
        ...(zumba.payload as PlanEvent),
        activityFormat: "online",
      }),
    ).toBe("online");
  });
  it("treats online Spanish during work as a soft warning without absence or conflict tasks", () => {
    const items = schedule([work, spanish]);
    expect(conflicts(items).map((c) => c.severity)).toEqual(["info"]);
    expect(requiredActions(items, conflicts(items), defaultSettings).size).toBe(
      0,
    );
  });
  it("retains real online conflicts with other personal plans", () => {
    const items = schedule([
      work,
      spanish,
      row("appointment", { time: "17:00", endTime: "18:00" }),
    ]);
    expect(
      conflicts(items).some(
        (c) =>
          c.severity === "hard" &&
          [c.a.sourceId, c.b.sourceId].includes("spanish"),
      ),
    ).toBe(true);
    expect(
      [
        ...requiredActions(items, conflicts(items), defaultSettings).values(),
      ].some((a) => a.kind === "absence"),
    ).toBe(true);
  });
  it("blocks flexible pool visits during work and allows an actual slot after work", () => {
    const pool = {
      ...(zumba.payload as PlanEvent),
      title: "Бассейн",
      activityMode: "flexible" as const,
      duration: 60,
      before: 30,
      after: 30,
    };
    expect(() =>
      assertVisitFitsWork(
        [work],
        planVisit(pool, "pool", "2026-11-23", "18:15"),
      ),
    ).toThrow("пересекаются с работой");
    expect(() =>
      assertVisitFitsWork(
        [work],
        planVisit(pool, "pool", "2026-11-23", "18:30"),
      ),
    ).not.toThrow();
    expect(() =>
      assertVisitFitsWork(
        [work],
        planVisit(
          { ...pool, activityFormat: "online" },
          "online",
          "2026-11-23",
          "17:00",
        ),
      ),
    ).not.toThrow();
  });
  it("clears obsolete online-work conflict/absence reminders and keeps tasks outside the loaded scope", () => {
    const onsite = schedule([
      work,
      row("spanish", {
        ...(spanish.payload as PlanEvent),
        activityFormat: "in_person",
      }),
    ]);
    const old = [
      ...requiredActions(onsite, conflicts(onsite), defaultSettings),
    ].map(([id, payload]) => ({
      ...work,
      id,
      type: "action" as const,
      payload,
    }));
    const online = schedule([work, spanish]);
    const required = requiredActions(
      online,
      conflicts(online),
      defaultSettings,
    );
    const changes = reconcileActionRows(old, required, online);
    expect(changes).toHaveLength(2);
    expect(
      changes.every(
        (c) =>
          c.payload.status === "completed" && c.payload.resolvedAutomatically,
      ),
    ).toBe(true);
    expect(reconcileActionRows(old, required, [])).toEqual([]);
  });
});
describe("work guard when selecting a saved occurrence", () => {
  beforeEach(async () => {
    await selectAccount("work-availability-test");
    await db.rows.clear();
    await save("event", work.payload, work.id);
    await save("event", zumba.payload, zumba.id);
    await save("event", spanish.payload, spanish.id);
  });
  afterEach(() => db.close());
  it("rejects the choice atomically and lets the same class be chosen after the shift changes", async () => {
    await expect(setStatus("zumba@2026-11-23", "selected")).rejects.toThrow(
      "пересекаются с работой",
    );
    expect(await db.rows.get("occ:zumba@2026-11-23")).toBeUndefined();
    await setStatus("spanish@2026-11-23", "selected");
    await save(
      "event",
      { ...(work.payload as PlanEvent), enabled: false },
      work.id,
    );
    await setStatus("zumba@2026-11-23", "selected");
    expect((await db.rows.get("occ:zumba@2026-11-23"))?.payload).toMatchObject({
      status: "selected",
    });
  });
});
