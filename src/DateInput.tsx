import { useEffect, useRef, useState } from "react";
import { DateTime } from "luxon";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
interface Props {
  value: string;
  onChange: (event: { target: { value: string } }) => void;
  min?: string;
  max?: string;
  required?: boolean;
  autoFocus?: boolean;
  "aria-label"?: string;
}
/** A Monday-first date picker independent of the browser/OS locale. */
export function DateInput({
  value,
  onChange,
  min,
  max,
  required,
  autoFocus,
  "aria-label": ariaLabel,
}: Props) {
  const show = (iso: string) =>
    iso ? DateTime.fromISO(iso).toFormat("dd.MM.yyyy") : "";
  const [text, setText] = useState(show(value)),
    [opened, setOpened] = useState(false),
    [month, setMonth] = useState(
      (DateTime.fromISO(value).isValid
        ? DateTime.fromISO(value)
        : DateTime.now().setZone("Europe/Moscow")
      ).startOf("month"),
    );
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setText(show(value));
    input.current?.setCustomValidity("");
  }, [value]);
  const select = (iso: string) => {
    setText(show(iso));
    onChange({ target: { value: iso } });
    input.current?.setCustomValidity("");
    setOpened(false);
  };
  const first = month.startOf("week");
  return (
    <div className="date-field">
      <div className="date-text">
        <input
          ref={input}
          type="text"
          inputMode="numeric"
          placeholder="ДД.ММ.ГГГГ"
          aria-label={ariaLabel ?? "Дата"}
          required={required}
          autoFocus={autoFocus}
          pattern="[0-9]{2}\.[0-9]{2}\.[0-9]{4}"
          maxLength={10}
          value={text}
          onChange={(event) => {
            const next = event.target.value;
            setText(next);
            if (!next) {
              onChange({ target: { value: "" } });
              event.target.setCustomValidity("");
              return;
            }
            const date = DateTime.fromFormat(next, "dd.MM.yyyy");
            const iso = date.toISODate();
            const valid =
              date.isValid &&
              date.toFormat("dd.MM.yyyy") === next &&
              iso &&
              (!min || iso >= min) &&
              (!max || iso <= max);
            event.target.setCustomValidity(
              valid
                ? ""
                : "Введите дату в формате ДД.ММ.ГГГГ в допустимом диапазоне.",
            );
            if (valid) onChange({ target: { value: iso! } });
          }}
        />
        <button
          type="button"
          className="icon-button"
          aria-label={opened ? "Закрыть выбор даты" : "Выбрать дату"}
          aria-expanded={opened}
          onClick={() => {
            if (!opened)
              setMonth(
                (DateTime.fromISO(value).isValid
                  ? DateTime.fromISO(value)
                  : DateTime.now().setZone("Europe/Moscow")
                ).startOf("month"),
              );
            setOpened(!opened);
          }}
        >
          <CalendarDays size={16} />
        </button>
      </div>
      {opened && (
        <div
          className="date-picker"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              setOpened(false);
              input.current?.focus();
            }
          }}
        >
          <div className="date-picker-toolbar">
            <button
              type="button"
              aria-label="Предыдущий месяц в выборе даты"
              onClick={() => setMonth(month.minus({ months: 1 }))}
            >
              <ChevronLeft size={15} />
            </button>
            <strong>{month.setLocale("ru").toFormat("LLLL yyyy")}</strong>
            <button
              type="button"
              aria-label="Следующий месяц в выборе даты"
              onClick={() => setMonth(month.plus({ months: 1 }))}
            >
              <ChevronRight size={15} />
            </button>
          </div>
          <div className="date-picker-grid">
            {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((d) => (
              <span key={d}>{d}</span>
            ))}
            {Array.from({ length: 42 }, (_, i) => {
              const d = first.plus({ days: i }),
                iso = d.toISODate()!;
              return (
                <button
                  key={iso}
                  type="button"
                  className={`${d.month !== month.month ? "outside" : ""} ${iso === value ? "chosen" : ""}`}
                  aria-label={d.setLocale("ru").toFormat("d MMMM yyyy")}
                  aria-pressed={iso === value}
                  disabled={Boolean((min && iso < min) || (max && iso > max))}
                  onClick={() => select(iso)}
                >
                  {d.day}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
