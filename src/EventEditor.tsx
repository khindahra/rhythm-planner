import { DateInput } from "./DateInput";
import { useState, useEffect } from "react";
import { X, Check } from "lucide-react";
import { type PlanEvent } from "./model";
import { attendanceMode, isActivity, activityFormat } from "./planning";
import { TimeInput } from "./TimeInput";
import { LeadTimeField } from "./LeadTimeField";
const days = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
export function EventEditor({
  value,
  existing,
  onClose,
  onSave,
  onDelete,
}: {
  value: PlanEvent;
  existing: boolean;
  onClose: () => void;
  onSave: (event: PlanEvent) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [e, set] = useState(value),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [confirmDelete, setConfirmDelete] = useState(false);
  const patch = (part: Partial<PlanEvent>) => set({ ...e, ...part });
  const activity = isActivity(e),
    flexible = activity && e.activityMode === "flexible";
  const mode = attendanceMode(e);
  const base =
    e.kind === "work" && e.repeat === "weekly" && e.workLayer !== "shift";
  useEffect(() => {
    const before = document.activeElement as HTMLElement;
    const modal = document.querySelector(".modal") as HTMLElement;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    modal?.querySelector<HTMLInputElement>("input")?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab") return;
      const fields = Array.from(
        modal.querySelectorAll<HTMLElement>(
          "button:not(:disabled),input,select,textarea",
        ),
      );
      if (event.shiftKey && document.activeElement === fields[0]) {
        event.preventDefault();
        fields.at(-1)?.focus();
      } else if (!event.shiftKey && document.activeElement === fields.at(-1)) {
        event.preventDefault();
        fields[0]?.focus();
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      document.body.style.overflow = previous;
      before?.focus();
    };
  }, []);
  const number = (key: "before" | "after" | "duration", label: string) => (
    <label>
      {label}
      <input
        required
        type="number"
        min={key === "duration" ? 1 : 0}
        max={["before", "after", "duration"].includes(key) ? 1440 : 43200}
        value={e[key] ?? (key === "duration" ? 60 : 0)}
        onChange={(event) =>
          patch({
            [key]: Number(event.target.value),
            ...((key === "before" || key === "after") && e.source
              ? { source: { ...e.source, buffersConfigured: true } }
              : {}),
          })
        }
      />
    </label>
  );
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="editor-title"
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setError("");
            setBusy(true);
            void onSave({
              ...e,
              absenceLead:
                (e.notifyAbsence ?? (e.kind === "fixed" && e.required))
                  ? Math.max(1440, e.absenceLead)
                  : e.absenceLead,
            })
              .catch((error) => setError(error.message))
              .finally(() => setBusy(false));
          }}
        >
          <div className="modal-header">
            <div>
              <div className="eyebrow">
                {base
                  ? "ОБЫЧНАЯ РАБОЧАЯ НЕДЕЛЯ"
                  : activity
                    ? "ЗАНЯТИЕ"
                    : "МОЙ КАЛЕНДАРЬ"}
              </div>
              <h2 id="editor-title">
                {existing
                  ? "Изменить"
                  : base
                    ? "Настроить работу"
                    : activity
                      ? "Добавить занятие"
                      : "Новый план"}
              </h2>
            </div>
            <button
              type="button"
              className="icon-button"
              aria-label="Закрыть редактор"
              onClick={onClose}
            >
              <X size={20} />
            </button>
          </div>
          <div className="modal-body">
            <label>
              Название
              <input
                required
                maxLength={160}
                value={e.title}
                onChange={(event) => patch({ title: event.target.value })}
                placeholder={
                  activity
                    ? "Например, испанский или бассейн"
                    : "Название плана"
                }
              />
            </label>
            {!base && (
              <label>
                Что добавляем
                <select
                  value={activity ? "activity" : e.kind}
                  onChange={(event) =>
                    patch({
                      kind: event.target.value as PlanEvent["kind"],
                      status:
                        event.target.value === "activity"
                          ? "available"
                          : "selected",
                    })
                  }
                >
                  <option value="personal">Личный план</option>
                  <option value="activity">Занятие</option>
                  <option value="work">Работа</option>
                  {["override", "recovery", "off"].includes(e.kind) && (
                    <option value={e.kind}>
                      {e.kind === "override"
                        ? "Изменение работы"
                        : e.kind === "off"
                          ? "Выходной"
                          : "Отсыпной"}
                    </option>
                  )}
                </select>
              </label>
            )}
            {activity && (
              <>
                <label>
                  Где проходит занятие?
                  <select
                    value={activityFormat(e)}
                    onChange={(event) =>
                      patch({
                        activityFormat: event.target
                          .value as PlanEvent["activityFormat"],
                      })
                    }
                  >
                    <option value="in_person">Нужно выходить из дома</option>
                    <option value="online">Онлайн / дома</option>
                  </select>
                </label>
                <p className="footnote">
                  Если занятие или дорога пересекаются с работой, очный вариант
                  скрывается из доступных. Онлайн остаётся в календаре с
                  предупреждением.
                </p>
                <label>
                  У занятия есть расписание?
                  <select
                    value={flexible ? "flexible" : "scheduled"}
                    onChange={(event) =>
                      patch({
                        activityMode: event.target
                          .value as PlanEvent["activityMode"],
                        repeat:
                          event.target.value === "flexible" ? "once" : e.repeat,
                        status:
                          event.target.value === "flexible"
                            ? "available"
                            : mode === "regular"
                              ? "selected"
                              : "available",
                        duration: e.duration ?? 60,
                      })
                    }
                  >
                    <option value="scheduled">
                      Да — фиксированные дни и время
                    </option>
                    <option value="flexible">
                      Нет — сам(а) выбираю, когда прийти
                    </option>
                  </select>
                </label>
                <label>
                  Нужна ли запись?
                  <select
                    value={mode}
                    onChange={(event) => {
                      const next = event.target
                        .value as PlanEvent["attendanceMode"];
                      patch({
                        kind: "activity",
                        attendanceMode: next,
                        bookingRequired: next === "booking",
                        notifyAbsence:
                          next === "regular" ? true : e.notifyAbsence,
                        required: next === "regular",
                        status:
                          !flexible && next === "regular"
                            ? "selected"
                            : "available",
                      });
                    }}
                  >
                    <option value="regular">
                      Уже хожу регулярно — записываться каждый раз не нужно
                    </option>
                    <option value="booking">
                      На каждое посещение нужно записаться
                    </option>
                    <option value="free">
                      Запись не нужна — прихожу, когда решу
                    </option>
                  </select>
                </label>
                <p className="footnote">
                  Испанский обычно подходит под первый вариант, танцы с записью
                  — под второй, бассейн без записи — под третий. Выберите то,
                  как устроено ваше занятие.
                </p>
              </>
            )}
            {!flexible && (
              <>
                <div className="form-row">
                  <label>
                    {e.repeat === "once" ? "Дата" : "Начиная с даты"}
                    <DateInput
                      aria-label={
                        e.repeat === "once" ? "Дата" : "Начиная с даты"
                      }
                      required
                      value={e.date}
                      onChange={(event) => patch({ date: event.target.value })}
                    />
                  </label>
                  <label>
                    {e.repeat === "once"
                      ? "Дата окончания, если другой день"
                      : "Последний день повторений"}
                    <DateInput
                      aria-label={
                        e.repeat === "once"
                          ? "Дата окончания"
                          : "Последний день повторений"
                      }
                      min={e.date}
                      value={(e.repeat === "once" ? e.endDate : e.until) ?? ""}
                      onChange={(event) =>
                        patch(
                          e.repeat === "once"
                            ? { endDate: event.target.value || undefined }
                            : { until: event.target.value || undefined },
                        )
                      }
                    />
                  </label>
                </div>
                <div className="form-row">
                  <label>
                    Начало · 24 ч
                    <TimeInput
                      required
                      value={e.time}
                      onChange={(event) => patch({ time: event.target.value })}
                    />
                  </label>
                  <label>
                    Окончание · 24 ч
                    <TimeInput
                      required
                      value={e.endTime}
                      onChange={(event) =>
                        patch({ endTime: event.target.value })
                      }
                    />
                  </label>
                </div>
                <label>
                  Повторять
                  <select
                    value={e.repeat}
                    onChange={(event) =>
                      patch({
                        repeat: event.target.value as PlanEvent["repeat"],
                      })
                    }
                  >
                    <option value="once">Нет, один раз</option>
                    <option value="weekly">Каждую неделю</option>
                    {e.repeat === "pattern" && (
                      <option value="pattern">
                        Ранее настроенный цикл смен
                      </option>
                    )}
                  </select>
                </label>
                {e.repeat === "weekly" && (
                  <>
                    <div className="weekday-picker">
                      {days.map((d, i) => (
                        <button
                          type="button"
                          key={d}
                          aria-pressed={e.weekdays.includes(i + 1)}
                          className={e.weekdays.includes(i + 1) ? "chosen" : ""}
                          onClick={() =>
                            patch({
                              weekdays: e.weekdays.includes(i + 1)
                                ? e.weekdays.filter((n) => n !== i + 1)
                                : [...e.weekdays, i + 1],
                            })
                          }
                        >
                          {d}
                        </button>
                      ))}
                    </div>
                    {activity && (
                      <p className="footnote">
                        В выбранные дни время одинаковое. Если в среду вечер, а
                        в субботу день, сохраните два расписания с одним
                        названием и разными часами.
                      </p>
                    )}
                  </>
                )}
                {base ? (
                  <p className="footnote">
                    Это обычные рабочие дни. Временные смены вносятся отдельно в
                    разделе «Работа → Смены на конкретный период».
                  </p>
                ) : (
                  <p className="footnote">
                    Время всегда 00:00–23:59. Если конец раньше начала, событие
                    заканчивается на следующий день.
                  </p>
                )}
              </>
            )}
            {flexible && (
              <>
                <p className="notice">
                  Это шаблон в каталоге, а не событие. В календаре он появится,
                  только когда вы выберете день и время посещения.
                </p>
                {number("duration", "Сколько длится само занятие (минуты)")}
                <details>
                  <summary>
                    Часы работы, если хотите ограничить время посещения
                  </summary>
                  <div className="form-row">
                    <label>
                      Открывается
                      <TimeInput
                        value={e.openingTime ?? ""}
                        onChange={(event) =>
                          patch({
                            openingTime: event.target.value || undefined,
                          })
                        }
                      />
                    </label>
                    <label>
                      Закрывается
                      <TimeInput
                        value={e.closingTime ?? ""}
                        onChange={(event) =>
                          patch({
                            closingTime: event.target.value || undefined,
                          })
                        }
                      />
                    </label>
                  </div>
                </details>
              </>
            )}
            {activity && (
              <>
                <div className="form-row">
                  {number("before", "Дорога и подготовка до (мин)")}
                  {number("after", "Душ, переодевание и дорога после (мин)")}
                </div>
                <p className="footnote">
                  {flexible
                    ? `Всего нужно заложить ${(e.duration ?? 60) + e.before + e.after} мин.`
                    : "Календарь учитывает само занятие и оба запаса времени."}
                </p>
                {!flexible && mode !== "regular" && (
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={[
                        "selected",
                        "booking",
                        "booked",
                        "attended",
                      ].includes(e.status)}
                      onChange={(event) =>
                        patch({
                          status: event.target.checked
                            ? "selected"
                            : "available",
                        })
                      }
                    />
                    Планирую пойти во все даты этого расписания
                  </label>
                )}
                {mode === "booking" && (
                  <details open>
                    <summary>Напоминания о записи и отмене</summary>
                    <div className="form-row">
                      <LeadTimeField
                        label="Записаться до занятия"
                        value={e.bookingLead}
                        onChange={(bookingLead) => patch({ bookingLead })}
                      />
                      <LeadTimeField
                        label="Отменить запись до занятия"
                        value={e.cancellationLead}
                        onChange={(cancellationLead) =>
                          patch({ cancellationLead })
                        }
                      />
                    </div>
                  </details>
                )}
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={
                      e.notifyAbsence ?? (e.kind === "fixed" && e.required)
                    }
                    onChange={(event) =>
                      patch({ notifyAbsence: event.target.checked })
                    }
                  />
                  Если пропускаю — напомнить сообщить об этом
                </label>
                {(e.notifyAbsence ?? (e.kind === "fixed" && e.required)) && (
                  <>
                    <LeadTimeField
                      label="Сообщить о пропуске не позднее чем"
                      value={e.absenceLead}
                      min={1440}
                      onChange={(absenceLead) => patch({ absenceLead })}
                    />
                    <p className="footnote">
                      До начала занятия должно оставаться не меньше суток. Можно
                      выбрать более ранний срок.
                    </p>
                  </>
                )}
                <p className="footnote">
                  Посещения можно отмечать отдельно во вкладке «Посещения».
                  Здесь вести отчёт не нужно.
                </p>
              </>
            )}
            {e.kind === "override" && (
              <label>
                Что меняется
                <select
                  value={e.overrideMode}
                  onChange={(event) =>
                    patch({
                      overrideMode: event.target
                        .value as PlanEvent["overrideMode"],
                    })
                  }
                >
                  <option value="replace">Заменить рабочие часы</option>
                  <option value="suppress">Освободить этот период</option>
                </select>
              </label>
            )}
            <label>
              Место
              <input
                maxLength={200}
                value={e.location}
                onChange={(event) => patch({ location: event.target.value })}
              />
            </label>
            <details>
              <summary>Заметки и дополнительные настройки</summary>
              <label>
                Заметки
                <textarea
                  rows={3}
                  value={e.notes}
                  maxLength={4000}
                  onChange={(event) => patch({ notes: event.target.value })}
                />
              </label>
              <label>
                Часовой пояс
                <input
                  required
                  value={e.zone}
                  onChange={(event) => patch({ zone: event.target.value })}
                />
              </label>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={e.enabled}
                  onChange={(event) => patch({ enabled: event.target.checked })}
                />
                Использовать это расписание
              </label>
            </details>
            {error && (
              <div className="notice warning" role="alert">
                {error}
              </div>
            )}
          </div>
          <div className="modal-footer">
            {existing && (
              <button
                type="button"
                className="delete"
                onClick={() => {
                  if (!confirmDelete) {
                    setConfirmDelete(true);
                    return;
                  }
                  void onDelete().catch((error) => setError(error.message));
                }}
              >
                {confirmDelete ? "Точно удалить?" : "Удалить"}
              </button>
            )}
            <button type="button" onClick={onClose}>
              Отмена
            </button>
            <button className="primary" disabled={busy}>
              <Check size={16} />
              Сохранить
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
