import bundle from "./data/vesna-2026-11.json";
import { eventSchema, type Row } from "./model";
import { validateEvent } from "./engine";
import type { PlannerDB } from "./store";
/** One-time import explicitly requested by the owner; preserves all existing rows and edits. */
export async function installStudioCatalog(localDB: PlannerDB) {
  const marker = `catalog-import:${bundle.id}`;
  const validated = bundle.rows.map((row) => {
    const event = eventSchema.parse(row.event);
    validateEvent(event);
    return { id: row.id, event };
  });
  let added = 0;
  await localDB.transaction("rw", localDB.rows, localDB.meta, async () => {
    if (await localDB.meta.get(marker)) return;
    for (const row of validated) {
      const existing = await localDB.rows.get(row.id);
      if (existing) {
        const e = existing.payload as import("./model").PlanEvent;
        if (
          !existing.deleted &&
          !existing.conflict &&
          e.source?.studio === "Весна" &&
          !e.source.buffersConfigured
        ) {
          await localDB.rows.put({
            ...existing,
            payload: {
              ...e,
              before: 30,
              after: 30,
              notes: e.notes.replace(
                "Дорога и подготовка пока не настроены.",
                "Дорога и подготовка: по 30 минут до и после (настройка пользователя).",
              ),
              source: { ...e.source, buffersConfigured: true },
            },
            dirty: true,
            mutationId: crypto.randomUUID(),
          });
        }
        continue;
      }
      await localDB.rows.put({
        id: row.id,
        type: "event",
        payload: row.event,
        revision: 0,
        deleted: false,
        dirty: true,
        mutationId: crypto.randomUUID(),
      } satisfies Row);
      added++;
    }
    await localDB.meta.put({ key: marker, value: new Date().toISOString() });
  });
  return added;
}
export const studioImportInfo = {
  sessionCount: bundle.sessionCount,
  scheduleCount: bundle.rows.length,
  through: bundle.through,
  source: bundle.source,
};
