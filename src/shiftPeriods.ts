import { periodRows, type ShiftChoice } from "./planning";
import { type PlanEvent } from "./model";
import { db, save, remove } from "./store";
export async function saveShiftPeriod(
  group: string,
  start: string,
  end: string,
  zone: string,
  days: Record<string, ShiftChoice>,
  hours: {
    dayStart: string;
    dayEnd: string;
    nightStart: string;
    nightEnd: string;
    sleepHours?: number;
  },
) {
  const next = periodRows(group, start, end, zone, days, hours);
  await db.transaction("rw", db.rows, async () => {
    const ids = new Set(next.map((row) => row.id));
    const existing = await db.rows.where("type").equals("event").toArray();
    for (const old of existing)
      if (
        !old.deleted &&
        (old.payload as PlanEvent).scheduleGroup === group &&
        !ids.has(old.id)
      )
        await remove(old.id);
    for (const row of next) await save("event", row.event, row.id);
  });
}
