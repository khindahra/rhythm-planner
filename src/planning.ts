import { DateTime } from "luxon";
import { newEvent, type PlanEvent, type Row } from "./model";
import { validateEvent, wall } from "./engine";
export type ShiftChoice = "day" | "night" | "off" | "recovery";
export function calendarStart(date: DateTime, view: "month" | "week") {
  return (view === "month" ? date.startOf("month") : date).startOf("week");
}
export function attendanceMode(e: PlanEvent): "regular" | "booking" | "free" {
  return (
    e.attendanceMode ??
    (e.kind === "fixed" ? "regular" : e.bookingRequired ? "booking" : "free")
  );
}
export const isActivity = (e: PlanEvent) =>
  e.kind === "activity" || e.kind === "fixed";
export { activityFormat } from "./activityFormat";
export function planVisit(
  template: PlanEvent,
  templateId: string,
  date: string,
  time: string,
): PlanEvent {
  if (
    !Number.isInteger(template.duration ?? 60) ||
    (template.duration ?? 60) < 1 ||
    (template.duration ?? 60) > 1440
  )
    throw new Error("Длительность должна быть от 1 до 1440 минут.");
  const start = wall(date, time, template.zone);
  const end = start.plus({ minutes: template.duration ?? 60 });
  if (template.openingTime && template.closingTime) {
    let opening = wall(date, template.openingTime, template.zone);
    let closing = wall(date, template.closingTime, template.zone);
    if (closing <= opening) {
      if (start < opening) opening = opening.minus({ days: 1 });
      else closing = closing.plus({ days: 1 });
    }
    if (start < opening || end > closing)
      throw new Error("Посещение должно полностью помещаться в часы работы.");
  }
  return {
    ...template,
    kind: "activity",
    templateId,
    activityMode: "scheduled",
    repeat: "once",
    date,
    time,
    endTime: end.toFormat("HH:mm"),
    endDate: end.toISODate() !== date ? end.toISODate()! : undefined,
    until: undefined,
    status: "selected",
    bookingConfirmed: false,
  };
}
export function periodRows(
  group: string,
  start: string,
  end: string,
  zone: string,
  choices: Record<string, ShiftChoice>,
  hours: {
    dayStart: string;
    dayEnd: string;
    nightStart: string;
    nightEnd: string;
    sleepHours?: number;
  },
): { id: string; event: PlanEvent }[] {
  const first = DateTime.fromISO(start, { zone }),
    last = DateTime.fromISO(end, { zone });
  if (
    !Number.isFinite(hours.sleepHours ?? 8) ||
    (hours.sleepHours ?? 8) < 1 ||
    (hours.sleepHours ?? 8) > 24
  )
    throw new Error("Укажите примерную длительность сна от 1 до 24 часов.");
  if (
    !first.isValid ||
    !last.isValid ||
    last < first ||
    last.diff(first, "days").days > 366
  )
    throw new Error("Выберите период до 367 дней.");
  const result: { id: string; event: PlanEvent }[] = [
    {
      id: `${group}:period`,
      event: {
        ...newEvent(start, zone),
        kind: "override",
        title: `Смены ${first.toFormat("dd.MM")}–${last.toFormat("dd.MM.yyyy")}`,
        time: "00:00",
        endTime: "00:00",
        endDate: last.plus({ days: 1 }).toISODate()!,
        overrideMode: "suppress",
        overrideScope: "base",
        scheduleGroup: group,
        sleepHours: hours.sleepHours ?? 8,
      },
    },
  ];
  for (let d = first; d <= last; d = d.plus({ days: 1 })) {
    const date = d.toISODate()!,
      choice = choices[date];
    if (!choice) continue;
    const e: PlanEvent = {
      ...newEvent(date, zone),
      kind:
        choice === "off" ? "off" : choice === "recovery" ? "recovery" : "work",
      title:
        choice === "day"
          ? "Дневная смена"
          : choice === "night"
            ? "Ночная смена"
            : choice === "off"
              ? "Выходной"
              : "Отсыпной",
      time:
        choice === "day"
          ? hours.dayStart
          : choice === "night"
            ? hours.nightStart
            : choice === "recovery"
              ? hours.nightEnd
              : "00:00",
      endTime:
        choice === "day"
          ? hours.dayEnd
          : choice === "night"
            ? hours.nightEnd
            : "00:00",
      workLayer: "shift",
      scheduleGroup: group,
      sleepHours: hours.sleepHours ?? 8,
    };
    if (choice === "recovery") {
      const sleepHours = hours.sleepHours ?? 8;
      if (!Number.isFinite(sleepHours) || sleepHours < 1 || sleepHours > 24)
        throw new Error("Укажите примерную длительность сна от 1 до 24 часов.");
      const wake = wall(date, hours.nightEnd, zone).plus({ hours: sleepHours });
      e.endTime = wake.toFormat("HH:mm");
      e.endDate = wake.toISODate() !== date ? wake.toISODate()! : undefined;
      e.sleepHours = sleepHours;
    }
    validateEvent(e);
    result.push({ id: `${group}:${date}`, event: e });
  }
  return result;
}
