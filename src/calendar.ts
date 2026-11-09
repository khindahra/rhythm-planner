import { DateTime } from "luxon";
import type { Occurrence } from "./model";
import { conflicts, occupied, overlaps } from "./engine";
import { isActivity } from "./planning";
import { onlineDuringWork } from "./activityFormat";

export const isOption = (o: Occurrence) =>
  isActivity(o.event) && o.event.status === "available";
export const calendarTitle = (o: Occurrence) =>
  o.event.kind === "work"
    ? "Работа"
    : o.event.kind === "recovery"
      ? "Сон (примерно)"
      : o.event.title;
export const calendarWindow = (o: Occurrence) =>
  isActivity(o.event) ? occupied(o) : { start: o.start, end: o.end };
export function calendarDayTime(o: Occurrence, day: DateTime) {
  const range = calendarWindow(o);
  const next = day.plus({ days: 1 }).toMillis();
  return `${range.start <= day.toMillis() ? "00:00" : DateTime.fromMillis(range.start, { zone: day.zoneName! }).toFormat("HH:mm")}–${range.end >= next ? "24:00" : DateTime.fromMillis(range.end, { zone: day.zoneName! }).toFormat("HH:mm")}`;
}
export function calendarTime(o: Occurrence, zone: string) {
  const range = calendarWindow(o);
  const start = DateTime.fromMillis(range.start, { zone }),
    end = DateTime.fromMillis(range.end, { zone });
  const days = Math.round(
    end.startOf("day").diff(start.startOf("day"), "days").days,
  );
  return `${start.toFormat("HH:mm")}–${end.toFormat("HH:mm")}${days ? ` (+${days} дн.)` : ""}`;
}
export interface CalendarWarning {
  other: Occurrence;
  severity: "hard" | "info";
  potential: boolean;
}
// Display-only warnings for options must never become booking or conflict reminders.
export function calendarWarnings(items: Occurrence[]) {
  const map = new Map<string, CalendarWarning[]>();
  const add = (
    o: Occurrence,
    other: Occurrence,
    severity: "hard" | "info",
    potential: boolean,
  ) =>
    map.set(o.id, [...(map.get(o.id) || []), { other, severity, potential }]);
  for (const c of conflicts(items)) {
    add(c.a, c.b, c.severity, false);
    add(c.b, c.a, c.severity, false);
  }
  const commitments = items.filter(
    (o) =>
      !isOption(o) && o.event.status !== "cancelled" && o.event.kind !== "off",
  );
  for (const option of items.filter(isOption))
    for (const other of commitments) {
      if (
        option.sourceId !== other.sourceId &&
        overlaps(occupied(option), occupied(other))
      )
        add(
          option,
          other,
          other.event.kind === "recovery" ||
            onlineDuringWork(option.event, other.event)
            ? "info"
            : "hard",
          true,
        );
    }
  return map;
}
export interface DaySegment {
  item: Occurrence;
  startMinute: number;
  endMinute: number;
  column: number;
  columns: number;
}
export function daySegments(items: Occurrence[], day: DateTime): DaySegment[] {
  const next = day.plus({ days: 1 });
  return items
    .filter(
      (o) =>
        calendarWindow(o).start < next.toMillis() &&
        calendarWindow(o).end > day.toMillis(),
    )
    .map((item) => {
      const range = calendarWindow(item);
      const a = DateTime.fromMillis(Math.max(range.start, day.toMillis()), {
        zone: day.zoneName!,
      });
      const b = DateTime.fromMillis(Math.min(range.end, next.toMillis()), {
        zone: day.zoneName!,
      });
      const startMinute = a.hour * 60 + a.minute;
      return {
        item,
        startMinute,
        endMinute:
          range.end >= next.toMillis()
            ? 1440
            : Math.max(startMinute + 1, b.hour * 60 + b.minute),
        column: 0,
        columns: 1,
      };
    })
    .sort(
      (a, b) =>
        a.startMinute - b.startMinute ||
        a.endMinute - b.endMinute ||
        a.item.id.localeCompare(b.item.id),
    );
}
export function layoutSegments(segments: DaySegment[], minimumMinutes = 0) {
  const sorted = segments
    .map((s) => ({ ...s }))
    .sort(
      (a, b) =>
        a.startMinute - b.startMinute ||
        b.endMinute - a.endMinute ||
        a.item.id.localeCompare(b.item.id),
    );
  let group: DaySegment[] = [],
    ends: number[] = [],
    groupEnd = -1;
  const finish = () => {
    for (const s of group) s.columns = ends.length;
    group = [];
    ends = [];
  };
  for (const s of sorted) {
    if (s.startMinute >= groupEnd) finish();
    let lane = ends.findIndex((end) => end <= s.startMinute);
    if (lane < 0) lane = ends.length;
    s.column = lane;
    ends[lane] = Math.max(s.endMinute, s.startMinute + minimumMinutes);
    groupEnd = Math.max(...ends);
    group.push(s);
  }
  finish();
  return sorted;
}
