import { DateInput } from "./DateInput";
import { useState } from "react";
import { DateTime } from "luxon";
import { type Row, type PlanEvent } from "./model";
import { type ShiftChoice } from "./planning";
import { saveShiftPeriod } from "./shiftPeriods";
import { db, save } from "./store";
import { TimeInput } from "./TimeInput";
const choicesList: { value: ShiftChoice; label: string }[] = [
  { value: "day", label: "Дневная" },
  { value: "night", label: "Ночная" },
  { value: "off", label: "Выходной" },
  { value: "recovery", label: "Отсыпной" },
];
export function WorkSettings({
  rows,
  zone,
  edit,
  report,
}: {
  rows: Row[];
  zone: string;
  edit: (event: PlanEvent, id?: string) => void;
  report: (message: string) => void;
}) {
  const today = DateTime.now().setZone(zone).toISODate()!;
  const [opened, setOpened] = useState(false);
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(`${today.slice(0, 4)}-12-31`);
  const [group, setGroup] = useState(`shifts:${crypto.randomUUID()}`);
  const [selected, setSelected] = useState<ShiftChoice | "clear">("day");
  const [days, setDays] = useState<Record<string, ShiftChoice>>({});
  const [clearedDraft, setClearedDraft] = useState<Record<
    string,
    ShiftChoice
  > | null>(null);
  const [hours, setHours] = useState({
    dayStart: "08:30",
    dayEnd: "20:30",
    nightStart: "20:30",
    nightEnd: "08:30",
    sleepHours: 8,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const events = rows.filter((r) => r.type === "event" && !r.deleted);
  const periods = events.filter(
    (r) =>
      (r.payload as PlanEvent).overrideScope === "base" &&
      (r.payload as PlanEvent).scheduleGroup,
  );
  const bases = events.filter((r) => {
    const e = r.payload as PlanEvent;
    return e.kind === "work" && e.repeat === "weekly" && !e.scheduleGroup;
  });
  const dates: DateTime[] = [];
  const first = DateTime.fromISO(start, { zone }),
    last = DateTime.fromISO(end, { zone });
  if (
    first.isValid &&
    last.isValid &&
    last >= first &&
    last.diff(first, "days").days <= 366
  )
    for (let d = first; d <= last; d = d.plus({ days: 1 })) dates.push(d);
  const begin = (row?: Row) => {
    setError("");
    setClearedDraft(null);
    setSelected("day");
    setOpened(true);
    if (!row) {
      setGroup(`shifts:${crypto.randomUUID()}`);
      setStart(today);
      setEnd(`${today.slice(0, 4)}-12-31`);
      setDays({});
      return;
    }
    const e = row.payload as PlanEvent;
    setHours((h) => ({ ...h, sleepHours: e.sleepHours ?? 8 }));
    setGroup(e.scheduleGroup!);
    setStart(e.date);
    setEnd(
      DateTime.fromISO(e.endDate!, { zone: e.zone })
        .minus({ days: 1 })
        .toISODate()!,
    );
    const next: Record<string, ShiftChoice> = {};
    for (const r of events) {
      const event = r.payload as PlanEvent;
      if (event.scheduleGroup !== e.scheduleGroup || event.kind === "override")
        continue;
      next[event.date] =
        event.kind === "off"
          ? "off"
          : event.kind === "recovery"
            ? "recovery"
            : event.title === "Ночная смена"
              ? "night"
              : "day";
      if (event.kind === "recovery" && event.time !== "00:00")
        setHours((h) => ({
          ...h,
          nightEnd: event.time,
          sleepHours:
            event.sleepHours ??
            DateTime.fromISO(
              `${event.endDate || event.date}T${event.endTime}`,
              { zone: event.zone },
            )
              .plus(
                event.endTime <= event.time && !event.endDate
                  ? { days: 1 }
                  : {},
              )
              .diff(
                DateTime.fromISO(`${event.date}T${event.time}`, {
                  zone: event.zone,
                }),
                "hours",
              ).hours,
        }));
      if (event.kind === "work")
        setHours((h) =>
          event.title === "Ночная смена"
            ? { ...h, nightStart: event.time, nightEnd: event.endTime }
            : { ...h, dayStart: event.time, dayEnd: event.endTime },
        );
    }
    setDays(next);
  };
  return (
    <section className="card work-settings">
      <h2>Работа</h2>
      <div className="work-step">
        <span className="step-number">1</span>
        <div>
          <h3>Обычная неделя — например, 5/2</h3>
          <p>Рабочие дни и часы, когда нет временного сменного графика.</p>
          {bases.length ? (
            bases.map((row) => (
              <div className="record-line" key={row.id}>
                <span>
                  {(row.payload as PlanEvent).title}
                  <small>
                    {(row.payload as PlanEvent).weekdays
                      .map(
                        (d) =>
                          ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"][d - 1],
                      )
                      .join(", ")}{" "}
                    · {(row.payload as PlanEvent).time}–
                    {(row.payload as PlanEvent).endTime}
                  </small>
                </span>
                <button onClick={() => edit(row.payload as PlanEvent, row.id)}>
                  Изменить
                </button>
              </div>
            ))
          ) : (
            <button
              onClick={() =>
                edit({
                  kind: "work",
                  title: "Обычная рабочая неделя",
                  date: today,
                  time: "09:00",
                  endTime: "18:00",
                  zone,
                  repeat: "weekly",
                  weekdays: [1, 2, 3, 4, 5],
                  pattern: ["day", "day", "off", "off"],
                  category: "",
                  location: "",
                  notes: "",
                  before: 0,
                  after: 0,
                  status: "selected",
                  bookingRequired: false,
                  bookingLead: 1440,
                  cancellationLead: 720,
                  absenceLead: 1440,
                  required: true,
                  enabled: true,
                  overrideMode: "replace",
                  workLayer: "base",
                })
              }
            >
              Настроить обычную неделю
            </button>
          )}
        </div>
      </div>
      <div className="work-step">
        <span className="step-number">2</span>
        <div>
          <h3>Смены на конкретный период</h3>
          <p>
            Выберите период и отметьте известные смены и выходные. После ночной
            сон добавится автоматически. Остальные даты остаются по обычному
            графику.
          </p>
          <button onClick={() => begin()}>Внести известные смены</button>
          {periods.map((row) => (
            <div className="record-line" key={row.id}>
              <span>
                {(row.payload as PlanEvent).title}
                <small>
                  {(row.payload as PlanEvent).enabled
                    ? "Учитывает смены и сон после ночных"
                    : "Выключен"}
                </small>
              </span>
              <button onClick={() => begin(row)}>Открыть график</button>
              <button
                onClick={() => {
                  void db
                    .transaction("rw", db.rows, async () => {
                      for (const r of events.filter(
                        (r) =>
                          (r.payload as PlanEvent).scheduleGroup ===
                          (row.payload as PlanEvent).scheduleGroup,
                      ))
                        await save(
                          "event",
                          {
                            ...(r.payload as PlanEvent),
                            enabled: !(row.payload as PlanEvent).enabled,
                          },
                          r.id,
                        );
                    })
                    .catch((e) => report(e.message));
                }}
              >
                {(row.payload as PlanEvent).enabled
                  ? "Вернуть обычную неделю"
                  : "Включить смены"}
              </button>
            </div>
          ))}
        </div>
      </div>
      {opened && (
        <form
          className="shift-planner"
          onSubmit={(event) => {
            event.preventDefault();
            setError("");
            setBusy(true);
            void (async () => {
              await saveShiftPeriod(group, start, end, zone, days, hours);
              setOpened(false);
              report(
                "Смены сохранены. После ночных учтён сон, остальные даты — по обычному графику.",
              );
            })()
              .catch((e) => setError(e.message))
              .finally(() => setBusy(false));
          }}
        >
          <div className="form-row">
            <label>
              С какой даты
              <DateInput
                aria-label="С какой даты"
                required
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </label>
            <label>
              По какую дату включительно
              <DateInput
                aria-label="По какую дату включительно"
                required
                min={start}
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
            </label>
          </div>
          <div className="form-row">
            <label>
              Дневная: начало
              <TimeInput
                required
                value={hours.dayStart}
                onChange={(e) =>
                  setHours({ ...hours, dayStart: e.target.value })
                }
              />
            </label>
            <label>
              Дневная: конец
              <TimeInput
                required
                value={hours.dayEnd}
                onChange={(e) => setHours({ ...hours, dayEnd: e.target.value })}
              />
            </label>
            <label>
              Ночная: начало
              <TimeInput
                required
                value={hours.nightStart}
                onChange={(e) =>
                  setHours({ ...hours, nightStart: e.target.value })
                }
              />
            </label>
            <label>
              Ночная: конец
              <TimeInput
                required
                value={hours.nightEnd}
                onChange={(e) =>
                  setHours({ ...hours, nightEnd: e.target.value })
                }
              />
            </label>
          </div>
          <p className="footnote">
            Все часы в формате 00:00–23:59. Ночная смена заканчивается на
            следующий день. После каждой ночной календарь автоматически добавит
            примерный сон — отдельно отмечать отсыпной не нужно.
          </p>
          <label>
            Отсыпной: сколько часов заложить на сон
            <input
              type="number"
              min="1"
              max="24"
              step="0.5"
              required
              value={hours.sleepHours}
              onChange={(e) =>
                setHours({ ...hours, sleepHours: Number(e.target.value) })
              }
            />
          </label>
          <p className="footnote">
            Отсыпной: 00:00–{hours.nightEnd} работа, затем примерно{" "}
            {hours.sleepHours} ч сна — до{" "}
            {DateTime.fromISO(`${start}T${hours.nightEnd}`, { zone })
              .plus({ hours: hours.sleepHours || 8 })
              .toFormat("HH:mm")}
            . С начала ночной до пробуждения время занято. После сна вечер
            доступен для планов. Это ориентир, длительность можно менять.
          </p>
          <div className="shift-tools">
            {choicesList.map((c) => (
              <button
                type="button"
                key={c.value}
                aria-pressed={selected === c.value}
                className={`shift-tool ${c.value} ${selected === c.value ? "chosen" : ""}`}
                onClick={() => setSelected(c.value)}
              >
                {c.label}
              </button>
            ))}
            <button
              type="button"
              aria-pressed={selected === "clear"}
              className={`shift-tool clear ${selected === "clear" ? "chosen" : ""}`}
              onClick={() => setSelected("clear")}
            >
              Очистить день
            </button>
          </div>
          <p>
            Выберите тип выше и нажимайте только на даты, где график меняется.
            Незакрашенные даты — обычный график, а после ночной — сон. Повторное
            нажатие на ту же смену убирает отметку. «Очистить день» стирает
            любую отметку.
          </p>
          <div className="button-wrap">
            <button
              type="button"
              onClick={() => {
                setClearedDraft(null);
                setDays(
                  Object.fromEntries(
                    dates.map((d, i) => [
                      d.toISODate()!,
                      i % 4 < 2 ? "day" : "off",
                    ]),
                  ),
                );
              }}
            >
              Заполнить 2 дневные / 2 выходных
            </button>
            <button
              type="button"
              onClick={() => {
                setClearedDraft(null);
                setDays(
                  Object.fromEntries(dates.map((d) => [d.toISODate()!, "off"])),
                );
              }}
            >
              Все дни — выходные
            </button>
            <button
              type="button"
              disabled={!Object.keys(days).length}
              onClick={() => {
                setClearedDraft({ ...days });
                setDays({});
                setError("");
              }}
            >
              Очистить все отметки
            </button>
            {clearedDraft && (
              <button
                type="button"
                onClick={() => {
                  setDays(clearedDraft);
                  setClearedDraft(null);
                }}
              >
                Отменить очистку
              </button>
            )}
          </div>
          <p className="footnote">
            Заполнение 2/2 начинается с двух дневных смен в первый день периода.
            Это только заготовка: исправьте любые даты до сохранения.
          </p>
          <div className="shift-date-grid">
            {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((n) => (
              <span key={n} className="weekday">
                {n}
              </span>
            ))}
            {Array.from(
              { length: (first.isValid ? first.weekday : 1) - 1 },
              (_, i) => (
                <span key={`blank${i}`} />
              ),
            )}
            {dates.map((d) => {
              const iso = d.toISODate()!,
                choice = days[iso];
              const autoSleep =
                !choice && days[d.minus({ days: 1 }).toISODate()!] === "night";
              return (
                <button
                  type="button"
                  key={iso}
                  aria-label={`${d.toFormat("dd.MM.yyyy")}: ${choicesList.find((c) => c.value === choice)?.label ?? (autoSleep ? "сон после ночной, автоматически" : "обычный график")}`}
                  className={`shift-date ${choice ?? "unset"}`}
                  onClick={() => {
                    setClearedDraft(null);
                    setError("");
                    setDays((previous) => {
                      const next = { ...previous };
                      if (selected === "clear" || previous[iso] === selected)
                        delete next[iso];
                      else next[iso] = selected;
                      return next;
                    });
                  }}
                >
                  <strong>{d.toFormat("dd.MM")}</strong>
                  <small>
                    {choicesList.find((c) => c.value === choice)?.label ??
                      (autoSleep ? "Сон · авто" : "Обычный")}
                  </small>
                </button>
              );
            })}
          </div>
          <p className="footnote">
            Изменено дней: {dates.filter((d) => days[d.toISODate()!]).length}.
            Сон после ночных добавится автоматически. Остальные даты — по
            обычному графику. Можно сохранить даже одно изменение.
          </p>
          {error && (
            <div className="notice warning" role="alert">
              {error}
            </div>
          )}
          <div className="button-wrap">
            <button className="primary" disabled={busy || !dates.length}>
              Сохранить смены
            </button>
            <button type="button" onClick={() => setOpened(false)}>
              Закрыть без сохранения
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
