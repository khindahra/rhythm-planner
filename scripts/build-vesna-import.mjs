import fs from "node:fs";
const raw = JSON.parse(
  fs.readFileSync(
    new URL("../imports/vesna-schedule-2026-11-raw.json", import.meta.url),
    "utf8",
  ),
);
const parsed = [
  ...new Map(raw.weeks.flat().map((entry) => [entry.id, entry])).values(),
]
  .map((entry) => {
    const match = entry.header.match(/(\d{2})\/(\d{2})/);
    if (!match) throw new Error("Missing calendar date");
    const times = entry.time.match(/(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})/);
    if (!times || !entry.title || !entry.id)
      throw new Error("Incomplete published session");
    const date = `${raw.year}-${match[2]}-${match[1]}`;
    const weekday = ((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
    return {
      ...entry,
      date,
      weekday,
      start: times[1],
      end: times[2],
      commercial: entry.icons.some((icon) => icon.includes("fa-money")),
    };
  })
  .filter((entry) => entry.date >= "2026-11-08" && entry.date <= "2026-11-30")
  .sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.start.localeCompare(b.start) ||
      a.title.localeCompare(b.title, "ru"),
  );
const groups = new Map();
for (const entry of parsed) {
  const key = JSON.stringify([
    entry.title,
    entry.weekday,
    entry.start,
    entry.end,
    entry.room,
    entry.trainer,
    entry.preEntry,
    entry.commercial,
  ]);
  const group = groups.get(key) ?? [];
  group.push(entry);
  groups.set(key, group);
}
const rows = [];
for (const entries of groups.values()) {
  const runs = [];
  for (const entry of entries) {
    const last = runs.at(-1);
    if (
      last &&
      Date.parse(entry.date) - Date.parse(last.at(-1).date) === 7 * 86400000
    )
      last.push(entry);
    else runs.push([entry]);
  }
  for (const run of runs) {
    const first = run[0],
      last = run.at(-1);
    const notes = [
      `Источник расписания: ${raw.source}`,
      `Преподаватель: ${first.trainer}`,
      `Проверенные даты: ${run.map((e) => e.date).join(", ")}`,
      first.commercial
        ? "Коммерческий класс — дополнительная оплата по правилам студии."
        : "",
      `Запись и отмена — не позднее чем за 2 часа до занятия. Правила: https://vesna-st.ru/agreementforadults`,
      `Дорога и подготовка: по 30 минут до и после (настройка пользователя).`,
    ]
      .filter(Boolean)
      .join("\n");
    rows.push({
      id: `vesna:${first.id}`,
      event: {
        kind: "activity",
        title: first.title,
        date: first.date,
        time: first.start,
        endTime: first.end,
        zone: "Europe/Moscow",
        repeat: run.length > 1 ? "weekly" : "once",
        weekdays: [first.weekday],
        until: last.date,
        pattern: ["day", "night", "recovery", "off"],
        category: "",
        location: `Весна · ${first.room}`,
        notes,
        before: 30,
        after: 30,
        status: "available",
        bookingRequired: first.preEntry,
        bookingLead: 120,
        cancellationLead: 120,
        absenceLead: 1440,
        required: false,
        enabled: true,
        overrideMode: "replace",
        activityMode: "scheduled",
        attendanceMode: first.preEntry ? "booking" : "free",
        notifyAbsence: false,
        bookingConfirmed: false,
        source: {
          url: raw.source,
          rulesUrl: "https://vesna-st.ru/agreementforadults",
          studio: "Весна",
          trainer: first.trainer,
          room: first.room,
          commercial: first.commercial,
          capturedAt: raw.capturedAt,
          sessionIds: run.map((e) => e.id),
          dates: run.map((e) => e.date),
          buffersConfigured: true,
        },
      },
    });
  }
}
const bundle = {
  id: "vesna-2026-11-v2",
  source: raw.source,
  capturedAt: raw.capturedAt,
  from: "2026-11-08",
  through: "2026-11-29",
  unavailableDates: ["2026-11-30"],
  sessionCount: parsed.length,
  activityCount: new Set(parsed.map((e) => e.title)).size,
  rows,
};
fs.mkdirSync(new URL("../src/data/", import.meta.url), { recursive: true });
fs.writeFileSync(
  new URL("../src/data/vesna-2026-11.json", import.meta.url),
  JSON.stringify(bundle, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    sessions: bundle.sessionCount,
    activities: bundle.activityCount,
    schedules: rows.length,
    through: bundle.through,
  }),
);
