import { DateTime } from "luxon";
import { type Occurrence, type PlanEvent, type Row } from "./model";
import { expand, effectiveSchedule, occupied, overlaps } from "./engine";
import { isActivity, activityFormat } from "./planning";
import { onlineDuringWork } from "./activityFormat";

export function workBlockers(item: Occurrence, schedule: Occurrence[]) {
  if (!isActivity(item.event) || activityFormat(item.event) === "online")
    return [];
  return schedule.filter(
    (other) =>
      other.event.kind === "work" &&
      !["available", "cancelled"].includes(other.event.status) &&
      overlaps(occupied(item), occupied(other)),
  );
}
export function conflictingPlans(item: Occurrence, schedule: Occurrence[]) {
  if (!isActivity(item.event)) return [];
  return schedule.filter(
    (other) =>
      other.sourceId !== item.sourceId &&
      !["available", "cancelled"].includes(other.event.status) &&
      !["off", "override"].includes(other.event.kind) &&
      !onlineDuringWork(item.event, other.event) &&
      overlaps(occupied(item), occupied(other)),
  );
}
export function visibleCalendarItems(
  items: Occurrence[],
  showOptions = true,
  showUnavailable = false,
  hideConflicting = false,
) {
  return items.filter(
    (item) =>
      item.event.status !== "cancelled" &&
      (!isActivity(item.event) ||
        item.event.status !== "available" ||
        (showOptions &&
          (!hideConflicting || conflictingPlans(item, items).length === 0) &&
          (showUnavailable || workBlockers(item, items).length === 0))),
  );
}
export function assertNoWorkOverlap(item: Occurrence, schedule: Occurrence[]) {
  if (workBlockers(item, schedule).length)
    throw new Error(
      "Нельзя попасть на занятие: само занятие или дорога пересекаются с работой. Выберите другое время.",
    );
}
export function assertVisitFitsWork(rows: Row[], event: PlanEvent) {
  const start = DateTime.fromISO(event.date, { zone: event.zone });
  const candidate = expand(
    [
      {
        id: "check-visit",
        type: "event",
        payload: event,
        deleted: false,
        dirty: false,
        revision: 0,
        mutationId: "check",
      },
    ],
    start,
    start.plus({ days: 2 }),
  )[0];
  if (candidate)
    assertNoWorkOverlap(
      candidate,
      effectiveSchedule(
        expand(rows, start.minus({ days: 2 }), start.plus({ days: 3 })),
      ).effective,
    );
}
export function assertOccurrenceCanBeSelected(rows: Row[], id: string) {
  const source = rows.find(
    (row) =>
      row.id === id.split("@")[0] && row.type === "event" && !row.deleted,
  );
  if (!source || !isActivity(source.payload as PlanEvent)) return;
  const start = DateTime.fromISO(id.slice(id.lastIndexOf("@") + 1), {
    zone: (source.payload as PlanEvent).zone,
  });
  const schedule = effectiveSchedule(
    expand(rows, start.minus({ days: 2 }), start.plus({ days: 3 })),
  ).effective;
  const item = schedule.find((o) => o.id === id);
  if (item) assertNoWorkOverlap(item, schedule);
}
