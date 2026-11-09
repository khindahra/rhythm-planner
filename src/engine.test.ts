import { describe, it, expect } from "vitest";
import { DateTime } from "luxon";
import {
  newEvent,
  defaultSettings,
  type Row,
  type PlanEvent,
  type Action,
} from "./model";
import {
  expand,
  effectiveSchedule,
  conflicts,
  requiredActions,
  reconcileActionRows,
  actionState,
  mergeRemote,
  wall,
  validateEvent,
} from "./engine";
const zone = "Europe/Moscow";
const from = DateTime.fromISO("2026-11-09", { zone });
const to = from.plus({ days: 7 });
const row = (id: string, part: Partial<PlanEvent>): Row => ({
  id,
  type: "event",
  payload: { ...newEvent("2026-11-09", zone), ...part },
  deleted: false,
  revision: 1,
  dirty: false,
  mutationId: "test",
});
const items = (...rows: Row[]) =>
  effectiveSchedule(expand(rows, from, to)).effective;
describe("schedule layers and overnight shifts", () => {
  it("expands the base week without weekends", () =>
    expect(
      expand([row("base", { kind: "work", repeat: "weekly" })], from, to),
    ).toHaveLength(5));
  it("keeps overnight end on the following local day", () => {
    const o = items(
      row("night", { kind: "work", time: "20:30", endTime: "08:30" }),
    )[0];
    expect(o.end - o.start).toBe(12 * 3600000);
    expect(DateTime.fromMillis(o.end, { zone }).day).toBe(10);
  });
  it("includes the previous night in the next day view", () =>
    expect(
      expand(
        [row("night", { time: "20:30", endTime: "08:30" })],
        from.plus({ days: 1 }),
        from.plus({ days: 2 }),
      ),
    ).toHaveLength(1));
  it("clips but never mutates the source schedule", () => {
    const source = row("base", {
      kind: "work",
      time: "09:00",
      endTime: "18:00",
    });
    const o = row("replacement", {
      kind: "override",
      time: "12:00",
      endTime: "15:00",
    });
    const result = effectiveSchedule(expand([source, o], from, to));
    expect(result.effective.map((o) => (o.end - o.start) / 3600000)).toEqual([
      3, 3, 3,
    ]);
    expect(result.originals).toHaveLength(1);
    expect((source.payload as PlanEvent).endTime).toBe("18:00");
    expect(
      items(source, {
        ...o,
        payload: { ...(o.payload as PlanEvent), enabled: false },
      }),
    ).toHaveLength(1);
  });
  it("restores work when an override is disabled or tombstoned", () => {
    const base = row("base", { kind: "work" });
    const over = row("over", { kind: "override", overrideMode: "suppress" });
    expect(items(base, over)).toHaveLength(0);
    expect(items(base, { ...over, deleted: true })).toHaveLength(1);
  });
  it("suppresses only the specified interval across midnight", () => {
    const base = row("base", { kind: "work", time: "20:30", endTime: "08:30" });
    const over = row("over", {
      kind: "override",
      overrideMode: "suppress",
      date: "2026-11-10",
      time: "00:00",
      endTime: "08:30",
    });
    expect(
      (items(base, over)[0].end - items(base, over)[0].start) / 3600000,
    ).toBe(3.5);
  });
  it("does not double count overlapping work layers", () => {
    const work = items(
      row("a", { kind: "work", time: "09:00", endTime: "13:00" }),
      row("b", { kind: "work", time: "12:00", endTime: "18:00" }),
    );
    expect(work).toHaveLength(1);
    expect((work[0].end - work[0].start) / 3600000).toBe(9);
  });
  it("uses stable precedence for overlapping overrides", () => {
    const result = items(
      row("a", { kind: "override", time: "09:00", endTime: "18:00" }),
      row("z", {
        kind: "override",
        overrideMode: "suppress",
        time: "12:00",
        endTime: "13:00",
      }),
    );
    expect(result).toHaveLength(2);
    expect(result.reduce((n, o) => n + o.end - o.start, 0) / 3600000).toBe(8);
  });
  it("expands custom cycles with recovery and rest", () => {
    const result = expand(
      [row("cycle", { kind: "work", repeat: "pattern" })],
      from,
      from.plus({ days: 4 }),
    );
    expect(result.map((o) => o.event.kind)).toEqual([
      "work",
      "work",
      "recovery",
      "work",
      "off",
    ]);
  });
  it("replaces the base week throughout a cycle without cutting off the night at recovery midnight", () => {
    const result = items(
      row("base", {
        kind: "work",
        repeat: "weekly",
        time: "09:00",
        endTime: "18:00",
      }),
      row("cycle", { kind: "work", repeat: "pattern", until: "2026-11-12" }),
    );
    expect(
      result.filter((o) => o.event.title === "Базовая рабочая неделя"),
    ).toHaveLength(0);
    const night = result.find((o) => o.event.title === "Ночная смена")!;
    expect((night.end - night.start) / 3600000).toBe(12);
    expect(result.filter((o) => o.event.kind === "work")).toHaveLength(3);
  });
});
describe("timezone handling", () => {
  it("uses the selected zone regardless of host timezone", () =>
    expect(wall("2026-11-09", "09:00", zone).toUTC().toISO()).toBe(
      "2026-11-09T06:00:00.000Z",
    ));
  it("uses elapsed hours across DST without moving wall time", () => {
    const r = row("dst", {
      date: "2026-03-28",
      zone: "Europe/Berlin",
      time: "20:30",
      endTime: "08:30",
    });
    const d = DateTime.fromISO("2026-03-28", { zone: "Europe/Berlin" });
    const o = expand([r], d, d.plus({ days: 2 }))[0];
    expect((o.end - o.start) / 3600000).toBe(11);
  });
  it("rejects nonexistent and ambiguous local times", () => {
    expect(() => wall("2026-03-29", "02:30", "Europe/Berlin")).toThrow();
    expect(() => wall("2026-10-25", "02:30", "Europe/Berlin")).toThrow();
  });
  it("rejects invalid dates and reversed explicit ranges", () => {
    expect(() => validateEvent({ ...newEvent("2026-02-30", zone) })).toThrow();
    expect(() =>
      validateEvent({ ...newEvent("2026-11-09", zone), endDate: "2026-11-08" }),
    ).toThrow();
  });
});
describe("occupied windows and conflicts", () => {
  it("finds travel-buffer conflicts even when actual classes do not overlap", () => {
    const a = row("work", { kind: "work", time: "09:00", endTime: "18:00" });
    const b = row("pool", {
      kind: "activity",
      time: "19:00",
      endTime: "20:00",
      before: 90,
      after: 30,
    });
    const c = conflicts(items(a, b));
    expect(c).toHaveLength(1);
    expect(c[0].severity).toBe("hard");
  });
  it("ignores unselected and cancelled activities", () =>
    expect(
      conflicts(
        items(
          row("a", { kind: "work" }),
          row("b", { kind: "activity", status: "available" }),
          row("c", { kind: "activity", status: "cancelled" }),
        ),
      ),
    ).toHaveLength(0));
  it("allows touching endpoints", () =>
    expect(
      conflicts(
        items(
          row("a", { endTime: "10:00" }),
          row("b", { time: "10:00", endTime: "11:00" }),
        ),
      ),
    ).toHaveLength(0));
  it("labels recovery overlaps as informational", () =>
    expect(
      conflicts(items(row("a", { kind: "recovery" }), row("b", {})))[0]
        .severity,
    ).toBe("info"));
});
describe("persistent actionable reminders", () => {
  const selected = items(
    row("class", { kind: "activity", bookingRequired: true, title: "Бассейн" }),
  );
  it("deduplicates required actions by stable occurrence and kind", () => {
    const needed = requiredActions(selected, [], defaultSettings);
    expect(needed.size).toBe(1);
    const changed = reconcileActionRows([], needed);
    const old: Row[] = [
      {
        ...row(changed[0].id, {}),
        type: "action",
        payload: changed[0].payload,
      },
    ];
    expect(reconcileActionRows(old, needed)).toEqual([]);
  });
  it("keeps completion and history across regeneration", () => {
    const needed = requiredActions(selected, [], defaultSettings);
    const [id, a] = [...needed][0];
    expect(
      reconcileActionRows(
        [
          {
            ...row(id, {}),
            type: "action",
            payload: { ...a, status: "completed" },
          },
        ],
        needed,
      ),
    ).toEqual([]);
  });
  it("snoozes without completing, then becomes overdue again", () => {
    const a: Action = {
      kind: "booking",
      occurrenceId: "class",
      title: "Запись",
      due: "2026-11-09T08:00:00Z",
      notifyAt: "2026-11-08T08:00:00Z",
      status: "snoozed",
      snoozeUntil: "2026-11-09T10:00:00Z",
    };
    expect(actionState(a, Date.parse("2026-11-09T09:00:00Z"))).toBe("snoozed");
    expect(actionState(a, Date.parse("2026-11-09T11:00:00Z"))).toBe("overdue");
  });
  it("creates separate conflict and absence tasks", () => {
    const os = items(
      row("work", { kind: "work" }),
      row("spanish", {
        kind: "fixed",
        title: "Испанский",
        activityFormat: "in_person",
      }),
    );
    expect(
      [...requiredActions(os, conflicts(os), defaultSettings).values()]
        .map((a) => a.kind)
        .sort(),
    ).toEqual(["absence", "conflict"]);
  });
  it("tracks cancellation separately from booking", () => {
    const cancelled = items(
      row("class", {
        kind: "activity",
        status: "cancelled",
        bookingRequired: true,
      }),
    );
    expect(
      [...requiredActions(cancelled, [], defaultSettings).values()][0].kind,
    ).toBe("cancellation");
  });
});
describe("synchronization merge and tombstones", () => {
  it("retains a dirty local edit when the server has not changed", () => {
    const local = { ...row("x", {}), dirty: true };
    expect(mergeRemote(local, { ...local })).toBe(local);
  });
  it("preserves both versions on simultaneous edits", () => {
    const local = { ...row("x", {}), dirty: true };
    const remote = { ...row("x", { title: "Remote" }), revision: 2 };
    expect(mergeRemote(local, remote).conflict?.payload).toEqual(
      remote.payload,
    );
  });
  it("preserves edit-versus-delete conflicts", () => {
    const local = { ...row("x", {}), dirty: true };
    const merged = mergeRemote(local, { ...local, revision: 2, deleted: true });
    expect(merged.deleted).toBe(false);
    expect(merged.conflict?.deleted).toBe(true);
  });
  it("pulls a tombstone over a clean local row", () =>
    expect(
      mergeRemote(row("x", {}), { ...row("x", {}), revision: 2, deleted: true })
        .deleted,
    ).toBe(true));
});
