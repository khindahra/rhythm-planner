import { it, expect } from "vitest";
import { DateTime } from "luxon";
import {
  expand,
  effectiveSchedule,
  requiredActions,
  mergeRemote,
} from "./engine";
import { newEvent, defaultSettings, type Row } from "./model";
it("requires explicit absence notification even for a manually missed lesson", () => {
  const zone = "Europe/Moscow";
  const start = DateTime.fromISO("2026-11-09", { zone });
  const event: Row = {
    id: "lesson",
    type: "event",
    payload: {
      ...newEvent("2026-11-09", zone),
      kind: "fixed",
      status: "cancelled",
    },
    revision: 1,
    deleted: false,
    dirty: false,
    mutationId: "test",
  };
  const items = effectiveSchedule(
    expand([event], start, start.plus({ days: 1 })),
  ).effective;
  expect(
    [...requiredActions(items, [], defaultSettings).values()].map(
      (a) => a.kind,
    ),
  ).toEqual(["absence"]);
});
it("does not overwrite unresolved imported versions during a pull", () => {
  const row: Row = {
    id: "x",
    type: "event",
    payload: newEvent("2026-11-09", "Europe/Moscow"),
    revision: 1,
    deleted: false,
    dirty: false,
    mutationId: "test",
  };
  const local = {
    ...row,
    conflict: { ...row, revision: 1 },
    conflictSource: "import" as const,
  };
  expect(mergeRemote(local, { ...row, revision: 2 })).toBe(local);
});
it("includes long recurring events that began before the view window", () => {
  const zone = "Europe/Moscow";
  const start = DateTime.fromISO("2026-11-15", { zone });
  const row: Row = {
    id: "trip",
    type: "event",
    payload: {
      ...newEvent("2026-11-01", zone),
      endDate: "2026-11-20",
      repeat: "weekly",
      weekdays: [7],
    },
    revision: 1,
    deleted: false,
    dirty: false,
    mutationId: "test",
  };
  expect(
    expand([row], start, start.plus({ days: 1 })).map((o) => o.id),
  ).toContain("trip@2026-11-01");
});
