import { DateTime } from "luxon";
import { onlineDuringWork, activityFormat } from "./activityFormat";
import {
  type Action,
  type Collision,
  type Occurrence,
  type PlanEvent,
  type RemoteRow,
  type Row,
  type Settings,
} from "./model";
export function wall(date: string, time: string, zone: string): DateTime {
  const value = DateTime.fromISO(`${date}T${time}`, { zone });
  if (
    !value.isValid ||
    value.toFormat("yyyy-MM-dd HH:mm") !== `${date} ${time}`
  )
    throw new Error(
      "Несуществующее местное время. Проверьте дату и часовой пояс.",
    );
  if (value.getPossibleOffsets().length > 1)
    throw new Error(
      "Неоднозначное время при переводе часов. Выберите другое время.",
    );
  return value;
}
export function validateEvent(e: PlanEvent) {
  if (e.activityMode === "flexible") {
    if (Boolean(e.openingTime) !== Boolean(e.closingTime))
      throw new Error("Укажите оба часа работы или оставьте оба поля пустыми.");
    if (e.openingTime) wall(e.date, e.openingTime, e.zone);
    if (e.closingTime) wall(e.date, e.closingTime, e.zone);
  }
  const start = wall(e.date, e.time, e.zone);
  wall(e.endDate || e.date, e.endTime, e.zone);
  if (e.until && e.until < e.date)
    throw new Error("Конец повторения раньше начала.");
  if (e.endDate && e.endDate < e.date)
    throw new Error("Конец события раньше начала.");
  if (e.endDate && e.endDate === e.date && e.endTime <= e.time)
    throw new Error(
      "Укажите следующий день для ночного события или очистите дату окончания.",
    );
  if (e.repeat === "weekly" && !e.weekdays.length)
    throw new Error("Выберите дни недели.");
  if (!start.isValid) throw new Error("Некорректная дата.");
}
function isNightWork(o: Occurrence) {
  if (
    o.id.endsWith(":night-tail") ||
    ["available", "cancelled"].includes(o.event.status)
  )
    return false;
  if (
    o.event.kind !== "work" &&
    !(o.event.kind === "override" && o.event.overrideMode === "replace")
  )
    return false;
  const start = DateTime.fromMillis(o.start, { zone: o.event.zone }),
    end = DateTime.fromMillis(o.end, { zone: o.event.zone });
  return (
    (end.toISODate() !== start.toISODate() &&
      end.toMillis() > end.startOf("day").toMillis()) ||
    (start.toISODate() === end.toISODate() && start.hour < 6 && end.hour < 12)
  );
}
function sleepHoursFor(o: Occurrence, context: { event: PlanEvent }[]) {
  return (
    o.event.sleepHours ??
    (o.event.scheduleGroup
      ? context.find(
          (c) =>
            c.event.kind === "override" &&
            c.event.scheduleGroup === o.event.scheduleGroup,
        )?.event.sleepHours
      : undefined) ??
    8
  );
}
export function expand(
  rows: Row[],
  from: DateTime,
  to: DateTime,
): Occurrence[] {
  const result: Occurrence[] = [];
  const context = rows
    .filter((r) => r.type === "event" && !r.deleted)
    .map((r) => ({ event: r.payload as PlanEvent }));
  for (const row of rows.filter((r) => r.type === "event" && !r.deleted)) {
    const e = row.payload as PlanEvent;
    if (!e.enabled || e.activityMode === "flexible") continue;
    if (e.workLayer === "shift" && e.scheduleGroup) {
      const owner = rows.find(
        (r) =>
          r.type === "event" &&
          (r.payload as PlanEvent).kind === "override" &&
          (r.payload as PlanEvent).overrideScope === "base" &&
          (r.payload as PlanEvent).scheduleGroup === e.scheduleGroup,
      );
      if (owner && (owner.deleted || !(owner.payload as PlanEvent).enabled))
        continue;
    }
    // A period is an editing range. Its enabled date choices alone replace the base week.
    if (
      e.kind === "override" &&
      e.overrideScope === "base" &&
      e.scheduleGroup
    ) {
      const children = rows.filter(
        (r) =>
          r.type === "event" &&
          !r.deleted &&
          (r.payload as PlanEvent).workLayer === "shift" &&
          (r.payload as PlanEvent).scheduleGroup === e.scheduleGroup &&
          (r.payload as PlanEvent).date >= e.date &&
          (!e.endDate || (r.payload as PlanEvent).date < e.endDate),
      );
      const choices = expand(
        children,
        from.setZone(e.zone).startOf("day"),
        to.setZone(e.zone).startOf("day").plus({ days: 1 }),
      );
      const windows = new Map<string, Occurrence>();
      for (const choice of choices) {
        const day = DateTime.fromMillis(choice.start, { zone: e.zone }).startOf(
          "day",
        );
        const date = day.toISODate()!;
        const start = day.toMillis(),
          end = Math.max(
            day.plus({ days: 1 }).toMillis(),
            choice.end,
            windows.get(date)?.end ?? 0,
          );
        if (start < to.toMillis() && end > from.toMillis())
          windows.set(date, {
            id: `${row.id}@${date}`,
            sourceId: row.id,
            event: e,
            start,
            end,
            occupiedStart: start,
            occupiedEnd: end,
          });
      }
      result.push(...windows.values());
      continue;
    }
    const origin = DateTime.fromISO(e.date, { zone: e.zone });
    // Include a preceding day for overnight windows; long one-off events retain their true origin.
    const lookback =
      (e.endDate
        ? Math.max(
            0,
            DateTime.fromISO(e.endDate).diff(DateTime.fromISO(e.date), "days")
              .days,
          )
        : 0) +
      Math.ceil(e.after / 1440) +
      3;
    let date =
      e.repeat === "once"
        ? origin
        : DateTime.max(
            origin,
            from.setZone(e.zone).startOf("day").minus({ days: lookback }),
          );
    const stop = to.setZone(e.zone).plus({ days: 2 }).startOf("day");
    for (; date <= stop; date = date.plus({ days: 1 })) {
      const iso = date.toISODate()!;
      if (e.until && iso > e.until) break;
      if (e.repeat === "once" && iso !== e.date) break;
      if (e.repeat === "weekly" && !e.weekdays.includes(date.weekday)) continue;
      let actual = { ...e };
      if (e.repeat === "pattern") {
        const index =
          Math.round(
            date.startOf("day").diff(origin.startOf("day"), "days").days,
          ) % e.pattern.length;
        const mode = e.pattern[index];
        actual = {
          ...e,
          kind:
            mode === "recovery" ? "recovery" : mode === "off" ? "off" : "work",
          title:
            mode === "day"
              ? "Дневная смена"
              : mode === "night"
                ? "Ночная смена"
                : mode === "off"
                  ? "Выходной"
                  : "Отсыпной",
          time:
            mode === "day"
              ? "08:30"
              : mode === "night"
                ? "20:30"
                : mode === "recovery"
                  ? "08:30"
                  : "00:00",
          endTime:
            mode === "day" ? "20:30" : mode === "night" ? "08:30" : "00:00",
        };
        if (mode === "recovery") {
          const wake = wall(iso, "08:30", e.zone).plus({
            hours: e.sleepHours ?? 8,
          });
          actual.endTime = wake.toFormat("HH:mm");
          actual.endDate =
            wake.toISODate() !== iso ? wake.toISODate()! : undefined;
        }
      }
      // Old all-day recovery marks become a timed post-night sleep without rewriting saved data.
      const legacyRest =
        actual.kind === "recovery" &&
        actual.time === "00:00" &&
        actual.endTime === "00:00" &&
        !actual.endDate;
      if (legacyRest) {
        const nights = rows.filter(
          (r) =>
            r.type === "event" &&
            !r.deleted &&
            (r.payload as PlanEvent).enabled &&
            (r.payload as PlanEvent).kind === "work" &&
            (r.payload as PlanEvent).scheduleGroup === e.scheduleGroup &&
            (r.payload as PlanEvent).endTime <= (r.payload as PlanEvent).time,
        );
        const previousDate = date.minus({ days: 1 }).toISODate();
        const night =
          nights.find((r) => (r.payload as PlanEvent).date === previousDate) ??
          nights[0];
        actual.time = night ? (night.payload as PlanEvent).endTime : "08:30";
        const wake = wall(iso, actual.time, e.zone).plus({
          hours: e.sleepHours ?? 8,
        });
        actual.endTime = wake.toFormat("HH:mm");
        actual.endDate =
          wake.toISODate() !== iso ? wake.toISODate()! : undefined;
        actual.title = "Отсыпной";
      }
      let start: DateTime, end: DateTime;
      try {
        start = wall(iso, actual.time, e.zone);
        const durationDays = actual.endDate
          ? DateTime.fromISO(actual.endDate).diff(
              DateTime.fromISO(
                legacyRest ||
                  (e.repeat === "pattern" && actual.kind === "recovery")
                  ? iso
                  : e.date,
              ),
              "days",
            ).days
          : 0;
        end = wall(
          date.plus({ days: durationDays }).toISODate()!,
          actual.endTime,
          e.zone,
        );
        if (end <= start)
          end = wall(
            date.plus({ days: durationDays + 1 }).toISODate()!,
            actual.endTime,
            e.zone,
          );
      } catch {
        continue;
      } // DST gaps are shown in the UI as a recurrence warning.
      const id = `${row.id}@${iso}`;
      const state = rows.find((r) => r.id === `occ:${id}` && !r.deleted);
      if (state)
        actual.status = (
          state.payload as { status: PlanEvent["status"] }
        ).status;
      if (state)
        actual.bookingConfirmed = (
          state.payload as { bookingConfirmed?: boolean }
        ).bookingConfirmed;
      const item: Occurrence = {
        id,
        sourceId: row.id,
        event: actual,
        start: start.toMillis(),
        end: end.toMillis(),
        occupiedStart: start.minus({ minutes: e.before }).toMillis(),
        occupiedEnd: end.plus({ minutes: e.after }).toMillis(),
      };
      if (isNightWork(item))
        item.event.sleepHours = sleepHoursFor(item, context);
      if (
        item.occupiedStart < to.toMillis() &&
        (item.occupiedEnd > from.toMillis() ||
          (isNightWork(item) &&
            Math.max(
              end.startOf("day").plus({ days: 1 }).toMillis(),
              end.plus({ hours: sleepHoursFor(item, context) }).toMillis(),
            ) > from.toMillis()))
      )
        result.push(item);
      // A marked post-night day includes the remaining work, even if yesterday is outside the entered period.
      // Overlapping work from an explicitly entered night is unioned later, so it never counts twice.
      if (
        actual.kind === "recovery" &&
        (actual.workLayer === "shift" || e.repeat === "pattern" || legacyRest)
      ) {
        const midnight = date.startOf("day").toMillis();
        if (
          start.toMillis() > midnight &&
          midnight < to.toMillis() &&
          start.toMillis() > from.toMillis()
        )
          result.push({
            id: `${id}:night-tail`,
            sourceId: row.id,
            event: {
              ...actual,
              kind: "work",
              title: "Ночная смена",
              repeat: "once",
              time: "00:00",
              endTime: actual.time,
              endDate: undefined,
              before: 0,
              after: 0,
              workLayer: "shift",
            },
            start: midnight,
            end: start.toMillis(),
            occupiedStart: midnight,
            occupiedEnd: start.toMillis(),
          });
      }
      if (e.repeat === "once") break;
    }
  }
  return result;
}
export function overlaps(
  a: { start: number; end: number },
  b: { start: number; end: number },
) {
  return a.start < b.end && b.start < a.end;
}
export function effectiveSchedule(all: Occurrence[]): {
  effective: Occurrence[];
  originals: Occurrence[];
} {
  const overrides = all
    .filter((o) => o.event.kind === "override" || o.event.repeat === "pattern")
    .sort((a, b) => a.id.localeCompare(b.id));
  const windowFor = (o: Occurrence) =>
    o.event.repeat === "pattern"
      ? {
          start: DateTime.fromMillis(o.start, { zone: o.event.zone })
            .startOf("day")
            .toMillis(),
          end: Math.max(
            DateTime.fromMillis(o.start, { zone: o.event.zone })
              .startOf("day")
              .plus({ days: 1 })
              .toMillis(),
            o.end,
          ),
        }
      : o;
  const originals: Occurrence[] = [];
  const effective: Occurrence[] = [];
  for (const item of all.filter((o) => !overrides.includes(o))) {
    if (!["work", "recovery", "off"].includes(item.event.kind)) {
      effective.push(item);
      continue;
    }
    let pieces = [item];
    for (const over of overrides) {
      if (item.sourceId === over.sourceId && item.id.endsWith(":night-tail"))
        continue;
      if (
        over.event.overrideScope === "base" &&
        item.event.workLayer === "shift"
      )
        continue;
      const window = windowFor(over);
      if (overlaps(item, window))
        originals.push({ ...item, original: true, replacedBy: over.id });
      pieces = pieces.flatMap((p) =>
        !overlaps(p, window)
          ? [p]
          : [
              ...(p.start < window.start
                ? [
                    {
                      ...p,
                      id: `${p.id}:left:${over.id}`,
                      end: window.start,
                      occupiedEnd: Math.min(p.occupiedEnd, window.start),
                    },
                  ]
                : []),
              ...(p.end > window.end
                ? [
                    {
                      ...p,
                      id: `${p.id}:right:${over.id}`,
                      start: window.end,
                      occupiedStart: Math.max(p.occupiedStart, window.end),
                    },
                  ]
                : []),
            ],
      );
    }
    effective.push(...pieces);
  }
  // Later stable IDs win when overrides overlap, with the same non-destructive clipping.
  overrides.forEach((over, i) => {
    if (over.event.overrideMode === "suppress") return;
    let parts: Occurrence[] = [
      {
        ...over,
        event: {
          ...over.event,
          kind: over.event.kind === "override" ? "work" : over.event.kind,
        },
      },
    ];
    overrides
      .slice(i + 1)
      .filter(
        (next) => next.event.repeat !== "pattern" || next.event.kind === "work",
      )
      .forEach((next) => {
        parts = parts.flatMap((p) =>
          !overlaps(p, next)
            ? [p]
            : [
                ...(p.start < next.start
                  ? [{ ...p, end: next.start, occupiedEnd: next.start }]
                  : []),
                ...(p.end > next.end
                  ? [{ ...p, start: next.end, occupiedStart: next.end }]
                  : []),
              ],
        );
      });
    effective.push(...parts);
  });
  const withSleep = addSleepAfterNights(effective, all, originals);
  // Union working intervals so overlapping work layers never count twice.
  const work = withSleep
    .filter((o) => o.event.kind === "work")
    .sort((a, b) => a.start - b.start);
  const union: Occurrence[] = [];
  for (const o of work) {
    const last = union.at(-1);
    if (last && overlaps(last, o)) {
      union[union.length - 1] = {
        ...last,
        end: Math.max(last.end, o.end),
        occupiedStart: Math.min(last.occupiedStart, o.occupiedStart),
        occupiedEnd: Math.max(last.occupiedEnd, o.occupiedEnd),
        event: {
          ...last.event,
          title:
            last.event.title === o.event.title
              ? last.event.title
              : `${last.event.title} + ${o.event.title}`,
        },
      };
    } else union.push(o);
  }
  return {
    effective: [
      ...withSleep.filter((o) => o.event.kind !== "work"),
      ...union,
    ].sort((a, b) => a.start - b.start),
    originals,
  };
}
function addSleepAfterNights(
  items: Occurrence[],
  context: Occurrence[],
  originals: Occurrence[],
) {
  const nights = items.filter(isNightWork).sort((a, b) => b.end - a.end);
  const days = new Map<
    string,
    { start: number; end: number; replacement: string }
  >();
  const sleep: Occurrence[] = [];
  for (const night of nights) {
    const start = DateTime.fromMillis(night.end, { zone: night.event.zone });
    const key = `${night.event.zone}:${start.toISODate()}`;
    if (days.has(key)) continue;
    const explicit = items.find(
      (o) =>
        o.event.kind === "recovery" &&
        DateTime.fromMillis(o.start, { zone: night.event.zone }).toISODate() ===
          start.toISODate(),
    );
    const hours = sleepHoursFor(night, context);
    const end = explicit
      ? DateTime.fromMillis(explicit.end, { zone: night.event.zone })
      : start.plus({ hours });
    const id = `${night.id}:sleep`;
    days.set(key, {
      start: start.startOf("day").toMillis(),
      end: Math.max(
        start.startOf("day").plus({ days: 1 }).toMillis(),
        end.toMillis(),
      ),
      replacement: explicit?.id ?? id,
    });
    if (explicit) continue;
    sleep.push({
      id,
      sourceId: night.sourceId,
      derivedFromNight: true,
      event: {
        ...night.event,
        kind: "recovery",
        title: "Отсыпной",
        date: start.toISODate()!,
        time: start.toFormat("HH:mm"),
        endTime: end.toFormat("HH:mm"),
        endDate:
          end.toISODate() !== start.toISODate() ? end.toISODate()! : undefined,
        repeat: "once",
        status: "selected",
        sleepHours: hours,
        before: 0,
        after: 0,
        bookingRequired: false,
        notifyAbsence: false,
        required: false,
        workLayer: "shift",
      },
      start: start.toMillis(),
      end: end.toMillis(),
      occupiedStart: start.toMillis(),
      occupiedEnd: end.toMillis(),
    });
  }
  const remaining = items.flatMap((item) => {
    // An automatically inferred post-night day replaces the ordinary week; explicit shifts stay visible.
    if (
      item.event.kind !== "work" ||
      isNightWork(item) ||
      item.event.workLayer === "shift" ||
      (item.event.workLayer !== "base" && item.event.repeat !== "weekly")
    )
      return [item];
    let parts = [item];
    for (const window of days.values()) {
      if (overlaps(item, window))
        originals.push({
          ...item,
          original: true,
          replacedBy: window.replacement,
        });
      parts = parts.flatMap((p) =>
        !overlaps(p, window)
          ? [p]
          : [
              ...(p.start < window.start
                ? [
                    {
                      ...p,
                      id: `${p.id}:left:${window.replacement}`,
                      end: window.start,
                      occupiedEnd: Math.min(p.occupiedEnd, window.start),
                    },
                  ]
                : []),
              ...(p.end > window.end
                ? [
                    {
                      ...p,
                      id: `${p.id}:right:${window.replacement}`,
                      start: window.end,
                      occupiedStart: Math.max(p.occupiedStart, window.end),
                    },
                  ]
                : []),
            ],
      );
    }
    return parts;
  });
  return [...remaining, ...sleep];
}
export const occupied = (o: Occurrence) => ({
  start: o.occupiedStart,
  end: o.occupiedEnd,
});
export function conflicts(items: Occurrence[]): Collision[] {
  const active = items.filter(
    (o) =>
      !["cancelled", "available"].includes(o.event.status) &&
      !["off"].includes(o.event.kind),
  );
  const out: Collision[] = [];
  for (let i = 0; i < active.length; i++)
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i],
        b = active[j];
      if (a.sourceId === b.sourceId || !overlaps(occupied(a), occupied(b)))
        continue;
      const severity =
        a.event.kind === "recovery" ||
        b.event.kind === "recovery" ||
        onlineDuringWork(a.event, b.event)
          ? "info"
          : "hard";
      out.push({ id: [a.id, b.id].sort().join("|"), a, b, severity });
    }
  return out;
}
export function requiredActions(
  items: Occurrence[],
  collisions: Collision[],
  settings: Settings,
): Map<string, Action> {
  const actions = new Map<string, Action>();
  function add(
    o: Occurrence,
    kind: Action["kind"],
    title: string,
    lead: number,
    key = o.id,
  ) {
    const due = new Date(o.start - lead * 60000).toISOString();
    actions.set(`action:${kind}:${key}`, {
      kind,
      occurrenceId: o.id,
      title,
      due,
      notifyAt: new Date(Date.parse(due) - settings.lead * 60000).toISOString(),
      status: "pending",
    });
  }
  for (const o of items) {
    if (
      (o.event.kind === "fixed" || o.event.kind === "activity") &&
      (o.event.notifyAbsence ??
        (o.event.kind === "fixed" && o.event.required)) &&
      o.event.status === "cancelled"
    )
      add(
        o,
        "absence",
        `Сообщить о пропуске: ${o.event.title}`,
        Math.max(1440, o.event.absenceLead),
      );
    if (
      o.event.kind === "activity" &&
      o.event.bookingRequired &&
      ["selected", "booking"].includes(o.event.status) &&
      (activityFormat(o.event) === "online" ||
        !items.some(
          (other) =>
            other.event.kind === "work" &&
            !["available", "cancelled"].includes(other.event.status) &&
            overlaps(occupied(o), occupied(other)),
        ))
    )
      add(o, "booking", `Записаться: ${o.event.title}`, o.event.bookingLead);
    if (
      o.event.kind === "activity" &&
      o.event.status === "cancelled" &&
      o.event.bookingRequired &&
      o.event.bookingConfirmed !== false
    )
      add(
        o,
        "cancellation",
        `Отменить запись: ${o.event.title}`,
        o.event.cancellationLead,
      );
  }
  for (const c of collisions.filter((c) => c.severity === "hard")) {
    add(
      c.a,
      "conflict",
      `Разобрать конфликт: ${c.a.event.title} / ${c.b.event.title}`,
      0,
      c.id,
    );
    for (const o of [c.a, c.b])
      if (
        (o.event.kind === "fixed" || o.event.kind === "activity") &&
        (o.event.notifyAbsence ??
          (o.event.kind === "fixed" && o.event.required))
      )
        add(
          o,
          "absence",
          `Сообщить о пропуске: ${o.event.title}`,
          Math.max(1440, o.event.absenceLead),
        );
  }
  return actions;
}
export function reconcileActionRows(
  existing: Row[],
  required: Map<string, Action>,
  schedule?: Occurrence[],
): { id: string; payload: Action }[] {
  const changes: { id: string; payload: Action }[] = [];
  if (schedule) {
    const ids = new Set(schedule.map((o) => o.id));
    for (const row of existing) {
      const action = row.payload as Action;
      if (
        row.type !== "action" ||
        row.deleted ||
        action.status === "completed" ||
        required.has(row.id)
      )
        continue;
      const inScope =
        action.kind === "conflict"
          ? row.id.startsWith("action:conflict:") &&
            row.id.slice("action:conflict:".length).split("|").length === 2 &&
            row.id
              .slice("action:conflict:".length)
              .split("|")
              .every((id) => ids.has(id))
          : ["absence", "booking"].includes(action.kind) &&
            ids.has(action.occurrenceId);
      if (inScope)
        changes.push({
          id: row.id,
          payload: {
            ...action,
            status: "completed",
            completedAt: new Date().toISOString(),
            resolvedAutomatically: true,
          },
        });
    }
  }
  required.forEach((payload, id) => {
    const row = existing.find((r) => r.id === id && !r.deleted);
    const saved = row?.payload as Action | undefined;
    if (!saved || saved.resolvedAutomatically) changes.push({ id, payload });
    else if (
      saved.status !== "completed" &&
      (saved.due !== payload.due ||
        saved.notifyAt !== payload.notifyAt ||
        saved.title !== payload.title)
    )
      changes.push({
        id,
        payload: {
          ...payload,
          status: saved.status,
          snoozeUntil: saved.snoozeUntil,
        },
      });
  });
  return changes;
}
export function actionState(a: Action, now = Date.now()) {
  if (a.status === "completed") return "completed";
  if (a.status === "snoozed" && Date.parse(a.snoozeUntil || "") > now)
    return "snoozed";
  return Date.parse(a.due) < now ? "overdue" : "pending";
}
function canonicalPayload(payload: Row["payload"]) {
  return JSON.stringify(payload, (_key, value) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, value[key]]),
        )
      : value,
  );
}

export function sameRecord(a: RemoteRow, b: RemoteRow) {
  return (
    a.type === b.type &&
    a.deleted === b.deleted &&
    canonicalPayload(a.payload) === canonicalPayload(b.payload)
  );
}

export function mergeRemote(local: Row | undefined, remote: RemoteRow): Row {
  if (local?.conflict) {
    if (remote.updated_at) {
      if (local.conflictSource === "import") {
        if (
          !local.dirty &&
          local.revision === remote.revision &&
          sameRecord(local, remote)
        )
          return { ...local, updated_at: remote.updated_at };
      } else if (
        local.conflict.revision === remote.revision &&
        sameRecord(local.conflict, remote)
      ) {
        return { ...local, conflict: remote };
      }
    }
    return local;
  }
  if (local?.dirty) {
    if (local.revision === remote.revision) return local;
    if (sameRecord(local, remote))
      return { ...remote, dirty: false, mutationId: crypto.randomUUID() };
    return { ...local, conflict: remote };
  }
  return { ...remote, dirty: false, mutationId: crypto.randomUUID() };
}
