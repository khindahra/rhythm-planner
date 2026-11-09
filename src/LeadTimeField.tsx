import { useState } from "react";
const presets = [
  0, 15, 30, 60, 120, 360, 720, 1440, 2880, 4320, 10080, 20160, 43200,
];
function plural(n: number, one: string, few: string, many: string) {
  const tens = n % 100,
    units = n % 10;
  return tens >= 11 && tens <= 14
    ? many
    : units === 1
      ? one
      : units >= 2 && units <= 4
        ? few
        : many;
}
export function humanDuration(minutes: number): string {
  if (minutes === 1440) return "сутки";
  if (minutes === 2880) return "двое суток";
  if (minutes === 4320) return "трое суток";
  if (minutes === 10080) return "неделю";
  if (minutes === 20160) return "2 недели";
  if (minutes === 43200) return "месяц (30 дней)";
  const days = Math.floor(minutes / 1440),
    hours = Math.floor((minutes % 1440) / 60),
    rest = minutes % 60;
  return [
    days ? `${days} ${plural(days, "день", "дня", "дней")}` : "",
    hours ? `${hours} ${plural(hours, "час", "часа", "часов")}` : "",
    rest ? `${rest} ${plural(rest, "минуту", "минуты", "минут")}` : "",
  ]
    .filter(Boolean)
    .join(" ");
}
export function LeadTimeField({
  label,
  value,
  onChange,
  min = 0,
  max = 43200,
  repeat = false,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  repeat?: boolean;
}) {
  const effective = Math.max(min, Math.min(max, value));
  const [custom, setCustom] = useState(false);
  const [unit, setUnit] = useState(
    effective > 0 && effective % 1440 === 0
      ? 1440
      : effective > 0 && effective % 60 === 0
        ? 60
        : 1,
  );
  const [count, setCount] = useState(
    effective /
      (effective > 0 && effective % 1440 === 0
        ? 1440
        : effective > 0 && effective % 60 === 0
          ? 60
          : 1),
  );
  const options = [...new Set([...presets, effective])]
    .filter((n) => n >= min && n <= max)
    .sort((a, b) => a - b);
  const caption = (n: number) =>
    n === 0
      ? "В момент крайнего срока"
      : repeat
        ? `Раз в ${humanDuration(n)}`
        : `За ${humanDuration(n)}`;
  return (
    <div className="lead-time-field">
      <label>
        <span>{label}</span>
        <select
          aria-label={label}
          value={custom ? "custom" : effective}
          onChange={(event) => {
            if (event.target.value === "custom") {
              const u =
                effective > 0 && effective % 1440 === 0
                  ? 1440
                  : effective > 0 && effective % 60 === 0
                    ? 60
                    : 1;
              setUnit(u);
              setCount(effective / u);
              setCustom(true);
            } else {
              setCustom(false);
              onChange(Number(event.target.value));
            }
          }}
        >
          {options.map((n) => (
            <option key={n} value={n}>
              {caption(n)}
            </option>
          ))}
          <option value="custom">Свой срок…</option>
        </select>
      </label>
      {custom && (
        <div className="form-row custom-lead">
          <label>
            Количество
            <input
              aria-label={`${label}: количество`}
              required
              type="number"
              step="1"
              min={Math.ceil(min / unit)}
              max={Math.floor(max / unit)}
              value={count}
              onChange={(event) => {
                const n = Number(event.target.value);
                setCount(n);
                if (Number.isInteger(n) && n * unit >= min && n * unit <= max)
                  onChange(n * unit);
              }}
            />
          </label>
          <label>
            Единица времени
            <select
              aria-label={`${label}: единица времени`}
              value={unit}
              onChange={(event) => {
                const next = Number(event.target.value);
                setUnit(next);
                if (count * next >= min && count * next <= max)
                  onChange(count * next);
              }}
            >
              <option value="1440">Дни</option>
              <option value="60">Часы</option>
              <option value="1">Минуты</option>
            </select>
          </label>
        </div>
      )}
    </div>
  );
}
