import { DateInput } from "./DateInput";
import { useState } from "react";
import { useDialogFocus } from "./useDialogFocus";
import { DateTime } from "luxon";
import { Plus, X, CalendarDays, Clock3 } from "lucide-react";
import { type PlanEvent, type Row, type Occurrence } from "./model";
import {
  isActivity,
  attendanceMode,
  planVisit,
  activityFormat,
} from "./planning";
import { workBlockers, assertVisitFitsWork } from "./availability";
import { db, save, setStatus } from "./store";
import { expand, conflicts, effectiveSchedule } from "./engine";
import { TimeInput } from "./TimeInput";
const fmt = (n: number, zone: string) =>
  DateTime.fromMillis(n, { zone }).setLocale("ru").toFormat("d LLL HH:mm");
export function AttendanceControls({
  item,
  report,
  blockedByWork = false,
}: {
  item: Occurrence;
  report: (message: string) => void;
  blockedByWork?: boolean;
}) {
  const { event: e } = item;
  const active = !["available", "cancelled"].includes(e.status);
  const mode = attendanceMode(e);
  const change = (status: PlanEvent["status"]) => {
    void setStatus(item.id, status).catch((error) => report(error.message));
  };
  return (
    <div className="attendance-controls">
      {blockedByWork && active && (
        <span className="badge">Нельзя попасть: пересечение с работой</span>
      )}
      {active ? (
        <>
          <span className="badge green">
            {mode === "booking" && e.status === "booked"
              ? "Запись подтверждена"
              : mode === "booking"
                ? "В плане · нужно записаться"
                : "В планах"}
          </span>
          {mode === "booking" && e.status !== "booked" && (
            <button className="primary" onClick={() => change("booked")}>
              Записал(а)сь
            </button>
          )}
          <button
            className="subtle"
            onClick={() =>
              change(
                e.status === "booked" || e.notifyAbsence || e.kind === "fixed"
                  ? "cancelled"
                  : "available",
              )
            }
          >
            Не пойду
          </button>
        </>
      ) : (
        <>
          <span className="badge">
            {e.status === "cancelled"
              ? "Пропускаю"
              : blockedByWork
                ? "Недоступно: пересечение с работой"
                : "Можно пойти"}
          </span>
          <button
            className="primary"
            disabled={blockedByWork}
            onClick={() => change("selected")}
          >
            {e.status === "cancelled" ? "Вернуть в планы" : "Пойду"}
          </button>
        </>
      )}
    </div>
  );
}
export function CatalogView({
  rows,
  items,
  zone,
  selected,
  onEdit,
  report,
}: {
  rows: Row[];
  items: Occurrence[];
  zone: string;
  selected: string;
  onEdit: (event: PlanEvent, id?: string) => void;
  report: (message: string) => void;
}) {
  const [tab, setTab] = useState<"catalog" | "schedule">("catalog"),
    [search, setSearch] = useState(""),
    [date, setDate] = useState("");
  const [visit, setVisit] = useState<Row | null>(null);
  const templates = rows.filter(
    (r) =>
      r.type === "event" &&
      !r.deleted &&
      isActivity(r.payload as PlanEvent) &&
      !(r.payload as PlanEvent).templateId,
  );
  const filtered = templates.filter((r) =>
    `${(r.payload as PlanEvent).title} ${(r.payload as PlanEvent).location}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const scheduled = items.filter(
    (o) =>
      isActivity(o.event) &&
      o.start >= DateTime.now().setZone(zone).startOf("day").toMillis() &&
      (!date || DateTime.fromMillis(o.start, { zone }).toISODate() === date) &&
      `${o.event.title} ${o.event.location}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  return (
    <>
      <div className="card">
        <h2>Здесь хранятся занятия, из которых вы выбираете</h2>
        <p>
          Подходящие по работе занятия видны в календаре. Очные варианты с
          пересечением скрываются, онлайн остаются. Нажмите на подходящее
          занятие и выберите «Пойду». Здесь можно менять расписание и добавлять
          новые занятия. Для бассейна без расписания выберите время посещения.
        </p>
      </div>
      <StudioImportNotice rows={templates} report={report} />
      <div className="section-line">
        <div className="segmented">
          <button
            className={tab === "catalog" ? "chosen" : ""}
            onClick={() => setTab("catalog")}
          >
            Мои занятия · {templates.length}
          </button>
          <button
            className={tab === "schedule" ? "chosen" : ""}
            onClick={() => setTab("schedule")}
          >
            Даты и время
          </button>
        </div>
        <div className="catalog-filters">
          <input
            aria-label="Поиск занятий"
            placeholder="Название или место"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          {tab === "schedule" && (
            <DateInput
              aria-label="Дата занятий"
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          )}
        </div>
      </div>
      <div className="activity-grid">
        {tab === "catalog"
          ? filtered.map((row) => {
              const e = row.payload as PlanEvent,
                flex = e.activityMode === "flexible",
                mode = attendanceMode(e);
              return (
                <article className="card activity-card" key={row.id}>
                  <span className="badge">
                    {flex
                      ? "Без фиксированного расписания"
                      : mode === "regular"
                        ? "Хожу регулярно"
                        : "Есть расписание"}
                  </span>
                  <h2>{e.title}</h2>
                  {!flex && (
                    <p>
                      {e.repeat === "weekly"
                        ? e.weekdays
                            .map(
                              (d) =>
                                ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"][
                                  d - 1
                                ],
                            )
                            .join(", ")
                        : DateTime.fromISO(e.date, { zone: e.zone })
                            .setLocale("ru")
                            .toFormat("d LLL yyyy")}{" "}
                      · {e.time}–{e.endTime}
                      {e.zone !== zone ? ` · ${e.zone}` : ""}
                    </p>
                  )}
                  <p>
                    {activityFormat(e) === "online"
                      ? "Онлайн / дома"
                      : "Нужно выходить из дома"}{" "}
                    · {e.location || "Место не указано"}
                  </p>
                  {e.source && (
                    <>
                      <p>Преподаватель: {e.source.trainer}</p>
                      {e.source.commercial && (
                        <span className="badge">Коммерческий класс</span>
                      )}
                      {!e.source.buffersConfigured && (
                        <p className="footnote">
                          Дорога и подготовка ещё не настроены.
                        </p>
                      )}
                    </>
                  )}
                  {flex && (
                    <p>
                      <Clock3 size={14} /> Само занятие: {e.duration ?? 60} мин.
                      Всего с дорогой и подготовкой:{" "}
                      {(e.duration ?? 60) + e.before + e.after} мин.
                    </p>
                  )}
                  <p className="footnote">
                    {mode === "booking"
                      ? "Нужно записываться на каждое посещение"
                      : mode === "regular"
                        ? "Уже записан(а), отдельная запись не нужна"
                        : "Запись не нужна"}
                    {e.notifyAbsence || (e.kind === "fixed" && e.required)
                      ? " · Напомнить сообщить о пропуске"
                      : ""}
                  </p>
                  <div className="card-actions">
                    <button onClick={() => onEdit(e, row.id)}>Изменить</button>
                    {flex ? (
                      <button className="primary" onClick={() => setVisit(row)}>
                        Запланировать посещение
                      </button>
                    ) : (
                      <button
                        onClick={() => {
                          setSearch(e.title);
                          setTab("schedule");
                        }}
                      >
                        Выбрать дату
                      </button>
                    )}
                  </div>
                </article>
              );
            })
          : scheduled.map((item) => (
              <article className="card activity-card" key={item.id}>
                <h2>{item.event.title}</h2>
                <p>
                  <CalendarDays size={14} /> {fmt(item.start, zone)}–
                  {DateTime.fromMillis(item.end, { zone }).toFormat("HH:mm")}
                </p>
                <p>{item.event.location}</p>
                <p className="footnote">
                  Занято с дорогой: {fmt(item.occupiedStart, zone)} —{" "}
                  {fmt(item.occupiedEnd, zone)}
                </p>
                <AttendanceControls
                  item={item}
                  report={report}
                  blockedByWork={workBlockers(item, items).length > 0}
                />
              </article>
            ))}
      </div>
      {(tab === "catalog" ? filtered.length : scheduled.length) === 0 && (
        <div className="empty-state">
          <h2>
            {templates.length
              ? "Нет занятий с такими условиями"
              : "Добавьте первое занятие"}
          </h2>
          <p>
            {templates.length
              ? "Попробуйте другую дату или название."
              : "Подойдёт и расписание танцев, и испанский, и бассейн без расписания."}
          </p>
        </div>
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
    </>
  );
}
function StudioImportNotice({
  rows,
  report,
}: {
  rows: Row[];
  report: (message: string) => void;
}) {
  const imported = rows.filter(
    (r) => (r.payload as PlanEvent).source?.studio === "Весна",
  );
  const [before, setBefore] = useState(30),
    [after, setAfter] = useState(30),
    [busy, setBusy] = useState(false),
    [opened, setOpened] = useState(false);
  if (!imported.length) return null;
  const sessions = imported.reduce(
    (sum, r) => sum + ((r.payload as PlanEvent).source?.dates.length ?? 0),
    0,
  );
  return (
    <section className="card studio-import-notice">
      <h3>«Весна» · {sessions} дат до 29 ноября</h3>
      <p>
        Запись и отмена — за 2 часа. Подходящие варианты видны в календаре:
        нажмите на занятие и выберите «Пойду».
      </p>
      <details>
        <summary>Источник и даты расписания</summary>
        <p>
          Сохранены опубликованные даты с 8 по 29 ноября 2026. Данные на 30
          ноября недоступны в календаре студии.
        </p>
        <p>
          <a
            href="https://vesna-st.ru/schedule"
            target="_blank"
            rel="noreferrer"
          >
            Расписание студии ↗
          </a>{" "}
          ·{" "}
          <a
            href="https://vesna-st.ru/agreementforadults"
            target="_blank"
            rel="noreferrer"
          >
            Правила записи и отмены: за 2 часа ↗
          </a>
        </p>
        <p>
          Это сохранённое расписание: изменения на сайте студии автоматически не
          подтягиваются.
        </p>
      </details>
      {imported.some(
        (r) => !(r.payload as PlanEvent).source?.buffersConfigured,
      ) && (
        <p className="footnote">
          Пока учитывается только само занятие. Настройте запас на дорогу и
          подготовку.
        </p>
      )}
      <button
        className="subtle"
        onClick={() => {
          if (!opened) {
            setBefore((imported[0].payload as PlanEvent).before);
            setAfter((imported[0].payload as PlanEvent).after);
          }
          setOpened(!opened);
        }}
      >
        {opened
          ? "Скрыть настройку дороги"
          : "Настроить дорогу для всей студии"}
      </button>
      {opened && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setBusy(true);
            void db
              .transaction("rw", db.rows, async () => {
                for (const row of imported) {
                  const current = await db.rows.get(row.id);
                  if (!current || current.deleted) continue;
                  const e = current.payload as PlanEvent;
                  await save(
                    "event",
                    {
                      ...e,
                      before,
                      after,
                      source: { ...e.source!, buffersConfigured: true },
                    },
                    row.id,
                  );
                }
              })
              .then(() => {
                report(
                  "Дорога и подготовка применены ко всем занятиям «Весны».",
                );
                setOpened(false);
              })
              .catch((e) => report(e.message))
              .finally(() => setBusy(false));
          }}
        >
          <div className="form-row">
            <label>
              Дорога и подготовка до (мин)
              <input
                required
                type="number"
                min="0"
                max="1440"
                value={before}
                onChange={(e) => setBefore(Number(e.target.value))}
              />
            </label>
            <label>
              Переодевание и дорога после (мин)
              <input
                required
                type="number"
                min="0"
                max="1440"
                value={after}
                onChange={(e) => setAfter(Number(e.target.value))}
              />
            </label>
          </div>
          <button className="primary" disabled={busy}>
            Применить ко всем занятиям «Весны»
          </button>
        </form>
      )}
    </section>
  );
}
export function VisitPlanner({
  row,
  rows,
  selected,
  onClose,
  report,
}: {
  row: Row;
  rows: Row[];
  selected: string;
  onClose: () => void;
  report: (message: string) => void;
}) {
  const template = row.payload as PlanEvent;
  const [date, setDate] = useState(selected),
    [time, setTime] = useState(""),
    [duration, setDuration] = useState(template.duration ?? 60),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useDialogFocus(true, onClose);
  let planned: PlanEvent | undefined;
  let crossing = 0;
  let occupied = "";
  let blockedByWork = false;
  try {
    if (time) {
      planned = planVisit({ ...template, duration }, row.id, date, time);
      const start = DateTime.fromISO(`${date}T${time}`, {
        zone: template.zone,
      });
      const candidate = expand(
        [
          {
            id: "preview-visit",
            type: "event",
            payload: planned,
            deleted: false,
            revision: 0,
            dirty: false,
            mutationId: "preview",
          },
        ],
        start.startOf("day"),
        start.plus({ days: 2 }),
      )[0];
      if (candidate) {
        const others = expand(
          rows,
          start.minus({ days: 2 }),
          start.plus({ days: 3 }),
        );
        const schedule = effectiveSchedule(others).effective;
        blockedByWork = workBlockers(candidate, schedule).length > 0;
        crossing = conflicts([...schedule, candidate]).filter(
          (c) => c.a.id === candidate.id || c.b.id === candidate.id,
        ).length;
        occupied = `${fmt(candidate.occupiedStart, template.zone)} — ${fmt(candidate.occupiedEnd, template.zone)}`;
      }
    }
  } catch {
    /* The save operation provides the validation error. */
  }
  return (
    <div className="modal-backdrop">
      <section
        className="modal small-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="visit-title"
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setError("");
            setBusy(true);
            void (async () => {
              const e = planVisit(
                { ...template, duration },
                row.id,
                date,
                time,
              );
              await db.transaction("rw", db.rows, async () => {
                assertVisitFitsWork(await db.rows.toArray(), e);
                await save("event", e);
              });
              report("Посещение добавлено в календарь.");
              onClose();
            })()
              .catch((e) => setError(e.message))
              .finally(() => setBusy(false));
          }}
        >
          <div className="modal-header">
            <h2 id="visit-title">{template.title}: когда пойдём?</h2>
            <button
              type="button"
              className="icon-button"
              aria-label="Закрыть планирование посещения"
              onClick={onClose}
            >
              <X size={18} />
            </button>
          </div>
          <div className="modal-body">
            <label>
              Дата
              <DateInput
                aria-label="Дата посещения"
                required
                autoFocus
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
            <label>
              Начало самого занятия · 24 ч
              <TimeInput
                required
                value={time}
                onChange={(e) => setTime(e.target.value)}
              />
            </label>
            <label>
              Само занятие (минуты)
              <input
                required
                type="number"
                min="1"
                max="1440"
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
              />
            </label>
            <p>
              Дорога и подготовка до: {template.before} мин. После:{" "}
              {template.after} мин.
            </p>
            {occupied && (
              <p className="notice">
                В календаре будет занято: {occupied} · {template.zone}
              </p>
            )}
            {blockedByWork && (
              <p className="notice warning" role="alert">
                Нельзя запланировать: занятие или дорога пересекаются с работой.
                Выберите другое время.
              </p>
            )}
            {crossing > 0 && !blockedByWork && (
              <p className="notice warning">
                Есть пересечения с другими планами: {crossing}. Можно выбрать
                другое время или сохранить и разобрать конфликт позже.
              </p>
            )}
            {error && (
              <p className="notice warning" role="alert">
                {error}
              </p>
            )}
          </div>
          <div className="modal-footer">
            <button type="button" onClick={onClose}>
              Отмена
            </button>
            <button className="primary" disabled={busy || blockedByWork}>
              <Plus size={16} />
              Добавить в календарь
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
