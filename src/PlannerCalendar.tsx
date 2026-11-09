import { useEffect, useMemo, useRef, useState } from "react";
import { DateTime } from "luxon";
import {
  ChevronLeft,
  ChevronRight,
  X,
  Plus,
  AlertTriangle,
} from "lucide-react";
import type { Occurrence, PlanEvent, Row } from "./model";
import { calendarStart, isActivity, activityFormat } from "./planning";
import {
  workBlockers,
  visibleCalendarItems,
  conflictingPlans,
} from "./availability";
import {
  calendarTime,
  calendarWindow,
  calendarDayTime,
  calendarTitle,
  calendarWarnings,
  daySegments,
  isOption,
  layoutSegments,
  type CalendarWarning,
} from "./calendar";
import { AttendanceControls, VisitPlanner } from "./CatalogView";
import { useDialogFocus } from "./useDialogFocus";
import "./planner-calendar.css";

const hourHeight = 72;
const isDayOff = (o: Occurrence) => o.event.kind === "off";
const background = (o: Occurrence) =>
  ["work", "recovery"].includes(o.event.kind);
type Props = {
  items: Occurrence[];
  rows: Row[];
  zone: string;
  view: "week" | "month";
  setView: (v: "week" | "month") => void;
  cursor: DateTime;
  setCursor: (d: DateTime) => void;
  selected: string;
  setSelected: (d: string) => void;
  onEdit: (event: PlanEvent, id: string) => void;
  onAdd: (date: string) => void;
  onWorkSettings: () => void;
  report: (s: string) => void;
};
export function PlannerCalendar({
  items,
  rows,
  zone,
  view,
  setView,
  cursor,
  setCursor,
  selected,
  setSelected,
  onEdit,
  onAdd,
  onWorkSettings,
  report,
}: Props) {
  const [showOptions, setShowOptions] = useState(true),
    [hideConflicting, setHideConflicting] = useState(false),
    [showUnavailable, setShowUnavailable] = useState(false),
    [focusedId, setFocusedId] = useState<string | null>(null),
    [visit, setVisit] = useState<Row | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const start = calendarStart(cursor, view);
  const warnings = useMemo(() => calendarWarnings(items), [items]);
  const blocked = useMemo(
    () =>
      new Set(
        items.filter((o) => workBlockers(o, items).length > 0).map((o) => o.id),
      ),
    [items],
  );
  const unavailableCount = items.filter(
    (o) => isOption(o) && blocked.has(o.id),
  ).length;
  const conflictingCount = useMemo(
    () =>
      items.filter((o) => isOption(o) && conflictingPlans(o, items).length > 0)
        .length,
    [items],
  );
  const visible = visibleCalendarItems(
    items,
    showOptions,
    showUnavailable,
    hideConflicting,
  );
  const events = visible.filter((o) => !isDayOff(o));
  const daysOff = visible.filter(isDayOff);
  const offFor = (day: DateTime) =>
    daysOff.find(
      (o) =>
        o.start < day.plus({ days: 1 }).toMillis() && o.end > day.toMillis(),
    );
  const shadedDay = (day: DateTime) => day.weekday >= 6 || Boolean(offFor(day));
  const dates = Array.from({ length: view === "week" ? 7 : 42 }, (_, i) =>
    start.plus({ days: i }),
  );
  const focused = items.find((o) => o.id === focusedId);
  const selectedDate = DateTime.fromISO(selected, { zone });
  const selectedOff = offFor(selectedDate);
  const agenda = daySegments(events, selectedDate)
    .map((s) => s.item)
    .sort((a, b) => calendarWindow(a).start - calendarWindow(b).start);
  useEffect(() => {
    if (view === "week" && scroll.current)
      scroll.current.scrollTop = 8 * hourHeight;
  }, [view, start.toISO()]);
  const navigate = (next: DateTime) => {
    setCursor(next);
    setSelected(calendarStart(next, view).toISODate()!);
  };
  const open = (o: Occurrence, day?: DateTime) => {
    if (day) setSelected(day.toISODate()!);
    setFocusedId(o.id);
  };
  const eventClass = (o: Occurrence) => {
    const warn = warnings.get(o.id) || [];
    return `planner-event ${o.event.kind === "work" ? "calendar-work" : o.event.kind === "recovery" ? "calendar-sleep" : ""} ${isOption(o) ? "calendar-option" : "calendar-planned"} ${warn.some((w) => w.severity === "hard" && !w.potential) ? "calendar-conflict" : warn.length ? "calendar-warning" : ""} ${isOption(o) && blocked.has(o.id) ? "calendar-unavailable" : ""}`;
  };
  const content = (o: Occurrence, day: DateTime) => (
    <>
      <strong>{calendarDayTime(o, day)}</strong>
      <span>{calendarTitle(o)}</span>
      {isOption(o) && blocked.has(o.id) ? (
        <small>× Недоступно: работа</small>
      ) : (
        !!warnings.get(o.id)?.length && (
          <small>
            ⚠{" "}
            {warnings.get(o.id)?.some((w) => w.severity === "hard")
              ? isOption(o)
                ? "Пересечение"
                : "Проверить конфликт"
              : "Совпадает по времени"}
          </small>
        )
      )}
    </>
  );
  const label = (o: Occurrence, day: DateTime) =>
    `${calendarDayTime(o, day)} ${calendarTitle(o)}${isOption(o) ? (blocked.has(o.id) ? " · недоступно из-за работы" : " · можно пойти") : ""}${warnings.get(o.id)?.length ? " · есть пересечение" : ""}`;
  return (
    <section className="outlook-calendar">
      <div className="calendar-toolbar">
        <div className="date-heading">
          <div>
            <h2>
              {view === "week"
                ? `${start.toFormat("dd.MM")} — ${start.plus({ days: 6 }).toFormat("dd.MM.yyyy")}`
                : cursor.setLocale("ru").toFormat("LLLL yyyy")}
            </h2>
            <p className="calendar-rules">24 ч · с понедельника · {zone}</p>
          </div>
          <div className="arrows">
            <button
              className="icon-button"
              aria-label="Предыдущий период"
              onClick={() =>
                navigate(
                  cursor.minus(view === "week" ? { weeks: 1 } : { months: 1 }),
                )
              }
            >
              <ChevronLeft size={17} />
            </button>
            <button
              className="icon-button"
              aria-label="Следующий период"
              onClick={() =>
                navigate(
                  cursor.plus(view === "week" ? { weeks: 1 } : { months: 1 }),
                )
              }
            >
              <ChevronRight size={17} />
            </button>
          </div>
          <button
            className="subtle"
            onClick={() => {
              const now = DateTime.now().setZone(zone);
              setCursor(now);
              setSelected(now.toISODate()!);
            }}
          >
            Сегодня
          </button>
        </div>
        <div className="segmented">
          <button
            className={view === "week" ? "chosen" : ""}
            onClick={() => setView("week")}
          >
            Неделя
          </button>
          <button
            className={view === "month" ? "chosen" : ""}
            onClick={() => setView("month")}
          >
            Месяц
          </button>
        </div>
      </div>
      <div className="calendar-options">
        <label>
          <input
            type="checkbox"
            checked={showOptions}
            onChange={(e) => setShowOptions(e.target.checked)}
          />{" "}
          Все доступные занятия
        </label>
        <label>
          <input
            type="checkbox"
            checked={hideConflicting}
            disabled={!showOptions}
            onChange={(e) => setHideConflicting(e.target.checked)}
          />
          Скрыть занятия с пересечениями
        </label>
        <span>
          {!showOptions
            ? "Показаны только ваши планы."
            : hideConflicting
              ? `Скрыто вариантов: ${conflictingCount}. Учитываются дорога и сон. Ваши планы остаются видимыми.`
              : "Нажмите на занятие → «Пойду». Пересечения учитывают дорогу и подготовку. Время блока — весь занятый интервал."}
        </span>
        {showOptions && !hideConflicting && unavailableCount > 0 && (
          <button
            className="subtle"
            aria-pressed={showUnavailable}
            onClick={() => setShowUnavailable(!showUnavailable)}
          >
            {showUnavailable
              ? `Скрыть недоступные (${unavailableCount})`
              : `Недоступны из-за работы: ${unavailableCount} · показать`}
          </button>
        )}
      </div>
      <p className="calendar-scroll-hint">
        Дни ↔ · время ↕ — прокручивайте календарь
      </p>
      {rows.some(
        (r) =>
          r.type === "event" &&
          !r.deleted &&
          (r.payload as PlanEvent).activityMode === "flexible" &&
          !(r.payload as PlanEvent).templateId,
      ) && (
        <div className="flexible-options">
          <span>Без расписания:</span>
          {rows
            .filter(
              (r) =>
                r.type === "event" &&
                !r.deleted &&
                (r.payload as PlanEvent).enabled &&
                (r.payload as PlanEvent).activityMode === "flexible" &&
                !(r.payload as PlanEvent).templateId,
            )
            .map((row) => (
              <button key={row.id} onClick={() => setVisit(row)}>
                {(row.payload as PlanEvent).title} · выбрать время
              </button>
            ))}
        </div>
      )}
      {view === "week" ? (
        <div
          className="week-scroll"
          ref={scroll}
          tabIndex={0}
          aria-label="Недельный календарь. Прокрутка по часам и дням"
        >
          <div className="week-canvas">
            <div className="week-header">
              <div>Время</div>
              {dates.map((d) => (
                <button
                  key={d.toISODate()}
                  className={`${selected === d.toISODate() ? "active-date" : ""} ${shadedDay(d) ? "day-off" : ""}`}
                  aria-label={`${d.setLocale("ru").toFormat("d MMMM yyyy")}${offFor(d) ? " · выходной" : ""}`}
                  onClick={() => setSelected(d.toISODate()!)}
                >
                  <span>
                    {d.setLocale("ru").toFormat("ccc")}{" "}
                    <strong>{d.toFormat("dd.MM")}</strong>
                  </span>
                  {offFor(d) && <span className="day-off-label">Выходной</span>}
                </button>
              ))}
            </div>
            <div className="week-body" style={{ height: 24 * hourHeight }}>
              <div className="hour-axis">
                {Array.from({ length: 24 }, (_, h) => (
                  <span key={h} style={{ top: h * hourHeight }}>
                    {String(h).padStart(2, "0")}:00
                  </span>
                ))}
              </div>
              {dates.map((d) => (
                <div
                  className={`week-day ${shadedDay(d) ? "day-off" : ""}`}
                  key={d.toISODate()}
                  style={{ backgroundSize: `100% ${hourHeight}px` }}
                >
                  {daySegments(visible.filter(background), d).map((s) => (
                    <button
                      key={s.item.id}
                      className={eventClass(s.item)}
                      style={{
                        top: (s.startMinute / 60) * hourHeight,
                        height: Math.max(
                          46,
                          ((s.endMinute - s.startMinute) / 60) * hourHeight,
                        ),
                      }}
                      title={label(s.item, d)}
                      aria-label={label(s.item, d)}
                      onClick={() => open(s.item, d)}
                    >
                      {content(s.item, d)}
                    </button>
                  ))}
                  {layoutSegments(
                    daySegments(
                      events.filter((o) => !background(o)),
                      d,
                    ),
                    (46 / hourHeight) * 60,
                  ).map((s) => (
                    <button
                      key={s.item.id}
                      className={eventClass(s.item)}
                      style={{
                        top: (s.startMinute / 60) * hourHeight,
                        height:
                          Math.max(
                            46,
                            ((s.endMinute - s.startMinute) / 60) * hourHeight,
                          ) - 2,
                        left: `calc(${(s.column / s.columns) * 100}% + 3px)`,
                        width: `calc(${100 / s.columns}% - 6px)`,
                      }}
                      title={label(s.item, d)}
                      aria-label={label(s.item, d)}
                      onClick={() => open(s.item, d)}
                    >
                      {content(s.item, d)}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="month-scroll">
          <div className="planner-month">
            {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((d) => (
              <div className="month-heading" key={d}>
                {d}
              </div>
            ))}
            {dates.map((d) => (
              <div
                className={`planner-month-day ${d.month !== cursor.month ? "outside-month" : ""} ${shadedDay(d) ? "day-off" : ""}`}
                key={d.toISODate()}
              >
                <div className="month-day-heading">
                  <button
                    className="month-date"
                    aria-label={`${d.setLocale("ru").toFormat("d MMMM yyyy")}${offFor(d) ? " · выходной" : ""}`}
                    onClick={() => setSelected(d.toISODate()!)}
                  >
                    {d.day}
                  </button>
                  {offFor(d) && <span className="day-off-label">Выходной</span>}
                </div>
                {daySegments(events, d).map(({ item }) => (
                  <button
                    className={eventClass(item)}
                    key={item.id}
                    onClick={() => open(item, d)}
                    aria-label={label(item, d)}
                  >
                    {content(item, d)}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="planner-legend">
        <span>
          <i className="key-off" /> Выходной
        </span>
        <span>
          <i className="key-sleep" /> Сон (примерно)
        </span>
        <span>
          <i className="key-work" /> Работа
        </span>
        <span>
          <i className="key-planned" /> В планах
        </span>
        <span>
          <i className="key-option" /> Можно пойти
        </span>
        <span>
          <i className="key-warning" /> Пересечение варианта
        </span>
        <span>
          <i className="key-conflict" /> Конфликт планов
        </span>
      </div>
      <div className="calendar-agenda">
        <div className="section-line">
          <h2>{selectedDate.setLocale("ru").toFormat("cccc, d MMMM")}</h2>
          <button onClick={() => onAdd(selected)}>
            <Plus size={15} />
            Добавить событие
          </button>
        </div>
        {selectedOff && (
          <p className="day-off-note">
            Выходной по графику{" "}
            <button
              className="text-button"
              onClick={() => {
                const row = rows.find((r) => r.id === selectedOff.sourceId);
                if (row) onEdit(row.payload as PlanEvent, row.id);
              }}
            >
              Изменить отметку
            </button>
          </p>
        )}
        <div className="calendar-agenda-grid">
          {agenda.length ? (
            agenda.map((o) => (
              <article className="card" key={o.id}>
                <button className="agenda-open" onClick={() => open(o)}>
                  {calendarDayTime(o, selectedDate)} {calendarTitle(o)}
                </button>
                {o.event.location && <p>{o.event.location}</p>}
                <WarningList warnings={warnings.get(o.id) || []} zone={zone} />
                {isActivity(o.event) && (
                  <AttendanceControls
                    item={o}
                    report={report}
                    blockedByWork={blocked.has(o.id)}
                  />
                )}
              </article>
            ))
          ) : (
            <p>На этот день событий нет.</p>
          )}
        </div>
      </div>
      {focused && (
        <CalendarDetails
          item={focused}
          warnings={warnings.get(focused.id) || []}
          zone={zone}
          blockedByWork={blocked.has(focused.id)}
          report={report}
          onClose={() => setFocusedId(null)}
          onEdit={() => {
            if (focused.derivedFromNight) {
              setFocusedId(null);
              onWorkSettings();
              return;
            }
            const row = rows.find((r) => r.id === focused.sourceId);
            if (row) {
              setFocusedId(null);
              onEdit(row.payload as PlanEvent, row.id);
            }
          }}
        />
      )}
      {visit && (
        <VisitPlanner
          row={visit}
          rows={rows}
          selected={selected}
          onClose={() => setVisit(null)}
          report={report}
        />
      )}
    </section>
  );
}
function WarningList({
  warnings,
  zone,
}: {
  warnings: CalendarWarning[];
  zone: string;
}) {
  return (
    <>
      {warnings.map((w) => (
        <p
          className={`calendar-warning-text ${!w.potential && w.severity === "hard" ? "actual" : ""}`}
          key={w.other.id}
        >
          <AlertTriangle size={14} />
          <span>
            {w.severity === "info"
              ? w.other.event.kind === "recovery"
                ? "Во время сна"
                : "Онлайн-занятие во время работы"
              : w.potential
                ? "Пересекается с"
                : "Конфликт с"}
            : {calendarTime(w.other, zone)} {calendarTitle(w.other)}
          </span>
        </p>
      ))}
    </>
  );
}
function CalendarDetails({
  item,
  warnings,
  zone,
  onClose,
  onEdit,
  report,
  blockedByWork,
}: {
  item: Occurrence;
  warnings: CalendarWarning[];
  zone: string;
  onClose: () => void;
  onEdit: () => void;
  report: (s: string) => void;
  blockedByWork: boolean;
}) {
  useDialogFocus(true, onClose);
  const fmt = (n: number) =>
    DateTime.fromMillis(n, { zone })
      .setLocale("ru")
      .toFormat("ccc, d LLL HH:mm");
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        className="modal calendar-details"
        role="dialog"
        aria-modal="true"
        aria-labelledby="calendar-details-title"
      >
        <div className="modal-heading">
          <h2 id="calendar-details-title">{calendarTitle(item)}</h2>
          <button
            className="icon-button"
            aria-label="Закрыть"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>
        <div className="calendar-detail-body">
          <strong>{calendarTime(item, zone)}</strong>
          {isActivity(item.event) &&
            (item.event.before > 0 || item.event.after > 0) && (
              <p>Весь занятый интервал с дорогой и подготовкой.</p>
            )}
          <p>
            {isActivity(item.event) && "Само занятие: "}
            {fmt(item.start)} — {fmt(item.end)}
          </p>
          {item.event.kind === "recovery" && (
            <p>
              Примерное время сна после ночной смены. Длительность можно
              поправить в графике смен.
            </p>
          )}
          {item.event.location && <p>{item.event.location}</p>}
          {isActivity(item.event) && (
            <p>
              {activityFormat(item.event) === "online"
                ? "Онлайн / дома · можно совместить с работой"
                : "Нужно выходить из дома"}
            </p>
          )}
          {item.event.source?.trainer && (
            <p>Преподаватель: {item.event.source.trainer}</p>
          )}
          {(item.event.before > 0 || item.event.after > 0) && (
            <p>
              С дорогой и подготовкой: {fmt(item.occupiedStart)} —{" "}
              {fmt(item.occupiedEnd)}.
            </p>
          )}
          <WarningList warnings={warnings} zone={zone} />
          {isActivity(item.event) && (
            <AttendanceControls
              item={item}
              report={report}
              blockedByWork={blockedByWork}
            />
          )}
          <p className="muted">
            {blockedByWork
              ? isOption(item)
                ? "Сейчас недоступно из-за работы. При изменении графика вариант появится снова."
                : "Посещение пересекается с работой. Его можно убрать из планов кнопкой «Не пойду»."
              : isOption(item)
                ? "Это доступный вариант. «Пойду» добавит его в ваши планы."
                : item.event.kind === "work"
                  ? item.event.title
                  : "В ваших планах."}
          </p>
          {item.event.notes && (
            <details>
              <summary>Подробнее</summary>
              <p>{item.event.notes}</p>
            </details>
          )}
          <button onClick={onEdit}>
            {item.derivedFromNight
              ? "Настроить сон после смены"
              : "Изменить расписание"}
          </button>
        </div>
      </section>
    </div>
  );
}
