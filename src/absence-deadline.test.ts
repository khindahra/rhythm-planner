import { it, expect } from "vitest";
import { DateTime } from "luxon";
import { newEvent, defaultSettings, type PlanEvent, type Row } from "./model";
import { expand, conflicts, requiredActions } from "./engine";
const zone = "Europe/Moscow";
const from = DateTime.fromISO("2026-11-11", { zone });
const row = (id: string, event: PlanEvent): Row => ({
  id,
  type: "event",
  payload: event,
  deleted: false,
  dirty: false,
  revision: 1,
  mutationId: "test",
});
function lesson(status: PlanEvent["status"], absenceLead: number) {
  return row("spanish", {
    ...newEvent("2026-11-11", zone),
    kind: "activity",
    title: "Испанский",
    activityFormat: "in_person",
    time: "19:00",
    endTime: "20:00",
    notifyAbsence: true,
    status,
    absenceLead,
  });
}
it("keeps the latest absence deadline a full day before a conflicting lesson even for older short leads", () => {
  const spanish = lesson("selected", 60);
  const work = row("work", {
    ...newEvent("2026-11-11", zone),
    kind: "work",
    time: "18:00",
    endTime: "21:00",
  });
  const items = expand([spanish, work], from, from.plus({ days: 1 }));
  const action = [
    ...requiredActions(items, conflicts(items), defaultSettings).values(),
  ].find((a) => a.kind === "absence")!;
  expect(
    DateTime.fromISO(action.due).setZone(zone).toFormat("yyyy-MM-dd HH:mm"),
  ).toBe("2026-11-10 19:00");
  expect(
    DateTime.fromISO(action.notifyAt)
      .setZone(zone)
      .toFormat("yyyy-MM-dd HH:mm"),
  ).toBe("2026-11-09 19:00");
  expect((spanish.payload as PlanEvent).absenceLead).toBe(60);
});
it("uses the same full-day deadline when a lesson is explicitly skipped", () => {
  const items = expand([lesson("cancelled", 0)], from, from.plus({ days: 1 }));
  const action = [
    ...requiredActions(items, [], { ...defaultSettings, lead: 0 }).values(),
  ][0];
  expect(Date.parse(action.due)).toBe(items[0].start - 24 * 3600000);
  expect(action.notifyAt).toBe(action.due);
});
it("preserves earlier absence deadlines and keeps booking deadlines configurable", () => {
  const skipped = lesson("cancelled", 2880);
  const dance = row("dance", {
    ...newEvent("2026-11-11", zone),
    kind: "activity",
    bookingRequired: true,
    bookingLead: 60,
  });
  const items = expand([skipped, dance], from, from.plus({ days: 1 }));
  const actions = [...requiredActions(items, [], defaultSettings).values()];
  expect(Date.parse(actions.find((a) => a.kind === "absence")!.due)).toBe(
    items[0].start - 48 * 3600000,
  );
  expect(Date.parse(actions.find((a) => a.kind === "booking")!.due)).toBe(
    items[1].start - 3600000,
  );
});
