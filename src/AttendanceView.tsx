import { DateInput } from "./DateInput";
import { useState } from "react";
import { DateTime } from "luxon";
import { Plus, ChevronLeft, ChevronRight, X } from "lucide-react";
import { type Row, type PlanEvent, type Attendance } from "./model";
import { save, remove } from "./store";
import { isActivity } from "./planning";
import { useDialogFocus } from "./useDialogFocus";
export const activityKey = (title: string) =>
  title.trim().toLocaleLowerCase("ru");
const palette = [
  "#b8d992",
  "#a9baff",
  "#e6b58a",
  "#ceabea",
  "#80c9c4",
  "#e397ab",
];
export function activityColor(title: string) {
  let hash = 0;
  for (const c of activityKey(title))
    hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  return palette[hash % palette.length];
}
export function monthCounts(rows: Row[], month: string) {
  const result = new Map<string, { title: string; count: number }>();
  for (const row of rows) {
    if (row.type !== "attendance" || row.deleted) continue;
    const a = row.payload as Attendance;
    if (!a.date.startsWith(month)) continue;
    const key = activityKey(a.title);
    const entry = result.get(key) ?? { title: a.title, count: 0 };
    entry.count++;
    result.set(key, entry);
  }
  return [...result.values()].sort((a, b) =>
    a.title.localeCompare(b.title, "ru"),
  );
}
export async function markAttendance(title: string, date: string) {
  const clean = title.trim();
  if (!clean || clean.length > 160)
    throw new Error("Укажите название занятия длиной до 160 символов.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !DateTime.fromISO(date).isValid)
    throw new Error("Проверьте дату посещения.");
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(activityKey(clean)),
  );
  const key = Array.from(new Uint8Array(hash), (n) =>
    n.toString(16).padStart(2, "0"),
  ).join("");
  const id = `attendance:${key}@${date}`;
  await save("attendance", { title: clean, date }, id);
}
export function AttendanceView({
  rows,
  zone,
  report,
}: {
  rows: Row[];
  zone: string;
  report: (message: string) => void;
}) {
  const today = DateTime.now().setZone(zone);
  const [month, setMonth] = useState(today.startOf("month"));
  const [week, setWeek] = useState(today.startOf("week"));
  const [filter, setFilter] = useState("all");
  const [date, setDate] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  useDialogFocus(Boolean(date), () => setDate(""));
  const names = [
    ...new Set([
      ...rows
        .filter(
          (r) =>
            r.type === "event" &&
            !r.deleted &&
            isActivity(r.payload as PlanEvent),
        )
        .map((r) => (r.payload as PlanEvent).title),
      ...rows
        .filter((r) => r.type === "attendance" && !r.deleted)
        .map((r) => (r.payload as Attendance).title),
    ]),
  ]
    .sort((a, b) => a.localeCompare(b, "ru"))
    .filter(
      (n, i, a) =>
        a.findIndex((other) => activityKey(other) === activityKey(n)) === i,
    );
  const counts = monthCounts(rows, month.toFormat("yyyy-MM"));
  const total = counts.reduce((sum, c) => sum + c.count, 0);
  const changeMonth = (delta: number) => {
    const next = month.plus({ months: delta });
    setMonth(next);
    setWeek(next.startOf("week"));
  };
  return (
    <>
      <div className="card attendance-intro">
        <h2>Планы — в календаре. Здесь — где вы были.</h2>
        <p>
          Нажмите «Отметить» у нужного дня и выберите занятие. Каждое название
          получает свой цвет. Отметки не меняют планы и напоминания.
        </p>
      </div>
      <div className="section-line">
        <div className="date-heading">
          <button
            aria-label="Предыдущий месяц посещений"
            className="icon-button"
            onClick={() => changeMonth(-1)}
          >
            <ChevronLeft size={18} />
          </button>
          <h2>{month.setLocale("ru").toFormat("LLLL yyyy")}</h2>
          <button
            aria-label="Следующий месяц посещений"
            className="icon-button"
            onClick={() => changeMonth(1)}
          >
            <ChevronRight size={18} />
          </button>
        </div>
        <span>
          Всего за месяц: <strong>{total}</strong>
        </span>
      </div>
      <div
        className="attendance-tabs"
        role="tablist"
        aria-label="Посещения по занятиям"
      >
        <button
          role="tab"
          aria-selected={filter === "all"}
          className={filter === "all" ? "chosen" : ""}
          onClick={() => setFilter("all")}
        >
          Все занятия · {total}
        </button>
        {names.map((name) => (
          <button
            key={name}
            role="tab"
            aria-selected={filter === activityKey(name)}
            className={filter === activityKey(name) ? "chosen" : ""}
            style={
              { "--activity-color": activityColor(name) } as React.CSSProperties
            }
            onClick={() => setFilter(activityKey(name))}
          >
            <i />
            {name} ·{" "}
            {counts.find((c) => activityKey(c.title) === activityKey(name))
              ?.count ?? 0}
          </button>
        ))}
      </div>
      <div className="section-line">
        <div className="date-heading">
          <button
            aria-label="Предыдущая неделя посещений"
            className="icon-button"
            onClick={() => setWeek(week.minus({ weeks: 1 }))}
          >
            <ChevronLeft size={17} />
          </button>
          <span>
            {week.setLocale("ru").toFormat("d LLL")} —{" "}
            {week.plus({ days: 6 }).setLocale("ru").toFormat("d LLL yyyy")}
          </span>
          <button
            aria-label="Следующая неделя посещений"
            className="icon-button"
            onClick={() => setWeek(week.plus({ weeks: 1 }))}
          >
            <ChevronRight size={17} />
          </button>
        </div>
        <button
          onClick={() => {
            setWeek(today.startOf("week"));
            setMonth(today.startOf("month"));
          }}
        >
          Эта неделя
        </button>
      </div>
      <div className="attendance-week">
        {Array.from({ length: 7 }, (_, i) => {
          const day = week.plus({ days: i }),
            iso = day.toISODate()!;
          const entries = rows.filter(
            (r) =>
              r.type === "attendance" &&
              !r.deleted &&
              (r.payload as Attendance).date === iso &&
              (filter === "all" ||
                activityKey((r.payload as Attendance).title) === filter),
          );
          return (
            <section className="attendance-day" key={iso}>
              <h3>
                {day.setLocale("ru").toFormat("ccc")}{" "}
                <span>{day.toFormat("dd.MM")}</span>
              </h3>
              {entries.map((row) => {
                const a = row.payload as Attendance;
                return (
                  <div
                    key={row.id}
                    className="attendance-mark"
                    style={
                      {
                        "--activity-color": activityColor(a.title),
                      } as React.CSSProperties
                    }
                  >
                    <span>{a.title}</span>
                    <button
                      aria-label={`Убрать отметку ${a.title} ${a.date}`}
                      title="Убрать отметку — её можно поставить снова"
                      onClick={() => {
                        void remove(row.id).catch((e) => report(e.message));
                      }}
                    >
                      <X size={12} />
                    </button>
                  </div>
                );
              })}
              <button
                className="attendance-add"
                onClick={() => {
                  setDate(iso);
                  setTitle(
                    filter === "all"
                      ? ""
                      : (names.find((n) => activityKey(n) === filter) ?? ""),
                  );
                }}
              >
                <Plus size={14} />
                Отметить
              </button>
            </section>
          );
        })}
      </div>
      <div className="attendance-summary">
        {counts
          .filter((c) => filter === "all" || activityKey(c.title) === filter)
          .map((c) => (
            <div
              className="card"
              key={c.title}
              style={
                {
                  "--activity-color": activityColor(c.title),
                } as React.CSSProperties
              }
            >
              <span>
                <i />
                {c.title}
              </span>
              <strong>{c.count}</strong>
              <small>посещений за месяц</small>
            </div>
          ))}
      </div>
      {total === 0 && (
        <p className="footnote">
          За этот месяц отметок пока нет. Ничего не добавляется автоматически.
        </p>
      )}
      {date && (
        <div className="modal-backdrop">
          <section
            className="modal small-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="attendance-title"
            onKeyDown={(e) => {
              if (e.key === "Escape") setDate("");
            }}
          >
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setBusy(true);
                void markAttendance(title, date)
                  .then(() => {
                    setDate("");
                    report("Посещение отмечено.");
                  })
                  .catch((e) => report(e.message))
                  .finally(() => setBusy(false));
              }}
            >
              <div className="modal-header">
                <h2 id="attendance-title">Отметить посещение</h2>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Закрыть отметку посещения"
                  onClick={() => setDate("")}
                >
                  <X size={18} />
                </button>
              </div>
              <div className="modal-body">
                <label>
                  Где были?
                  <input
                    required
                    autoFocus
                    maxLength={160}
                    list="attendance-names"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Выберите или введите название"
                  />
                  <datalist id="attendance-names">
                    {names.map((n) => (
                      <option key={n} value={n} />
                    ))}
                  </datalist>
                </label>
                <label>
                  Дата
                  <DateInput
                    aria-label="Дата отметки"
                    required
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                  />
                </label>
                <p className="footnote">
                  Одна отметка на занятие в день. Повторное нажатие не создаст
                  дубль.
                </p>
              </div>
              <div className="modal-footer">
                <button type="button" onClick={() => setDate("")}>
                  Отмена
                </button>
                <button disabled={busy} className="primary">
                  Отметить
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </>
  );
}
