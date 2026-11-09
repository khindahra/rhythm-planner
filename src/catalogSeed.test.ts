import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";
import { DateTime } from "luxon";
import bundle from "./data/vesna-2026-11.json";
import raw from "../imports/vesna-schedule-2026-11-raw.json";
import { db, selectAccount, save, remove } from "./store";
import { installStudioCatalog } from "./catalogSeed";
import { expand, requiredActions } from "./engine";
import { type PlanEvent, defaultSettings, newEvent } from "./model";
const zone = "Europe/Moscow",
  from = DateTime.fromISO("2026-11-08", { zone }),
  to = DateTime.fromISO("2026-12-02", { zone });
beforeEach(async () => {
  await selectAccount("studio-import-test");
  await db.rows.clear();
  await db.meta.clear();
});
describe("owner-requested catalog import", () => {
  it("matches the published dates exactly without inventing recurrence dates", async () => {
    await installStudioCatalog(db);
    const items = expand(await db.rows.toArray(), from, to);
    const published = [
      ...new Map(raw.weeks.flat().map((e) => [e.id, e])).values(),
    ]
      .map((e) => {
        const date = e.header.match(/(\d{2})\/(\d{2})/)!;
        return { date: `2026-${date[2]}-${date[1]}`, e };
      })
      .filter(({ date }) => date >= "2026-11-08" && date <= "2026-11-30");
    const expected = published
      .map(({ date, e }) => `${date}|${e.title}|${e.time}`)
      .sort();
    const actual = items
      .map(
        (o) =>
          `${DateTime.fromMillis(o.start, { zone }).toISODate()}|${o.event.title}|${DateTime.fromMillis(o.start, { zone }).toFormat("HH:mm")} - ${DateTime.fromMillis(o.end, { zone }).toFormat("HH:mm")}`,
      )
      .sort();
    expect(actual).toEqual(expected);
    expect(items).toHaveLength(139);
    expect(
      items.some(
        (o) =>
          DateTime.fromMillis(o.start, { zone }).toISODate() === "2026-11-30",
      ),
    ).toBe(false);
  });
  it("keeps studio options unselected and does not create booking actions before a visit is chosen", async () => {
    await installStudioCatalog(db);
    const rows = await db.rows.toArray(),
      items = expand(rows, from, to);
    expect(items.every((o) => o.event.status === "available")).toBe(true);
    expect(requiredActions(items, [], defaultSettings).size).toBe(0);
    expect(rows.every((r) => r.dirty)).toBe(true);
    expect(
      rows.every(
        (r) =>
          (r.payload as PlanEvent).bookingLead === 120 &&
          (r.payload as PlanEvent).cancellationLead === 120 &&
          (r.payload as PlanEvent).before === 30 &&
          (r.payload as PlanEvent).after === 30,
      ),
    ).toBe(true);
  });
  it("updates only previously unconfigured studio buffers without replacing user changes", async () => {
    const event = {
      ...bundle.rows[0].event,
      title: "Edited studio title",
      before: 0,
      after: 0,
      source: { ...bundle.rows[0].event.source, buffersConfigured: false },
    } as PlanEvent;
    await save("event", event, bundle.rows[0].id);
    await installStudioCatalog(db);
    expect((await db.rows.get(bundle.rows[0].id))?.payload).toMatchObject({
      title: "Edited studio title",
      before: 30,
      after: 30,
      source: { buffersConfigured: true },
    });
  });
  it("preserves personal events, existing edits, and deleted imported schedules across repeated loads", async () => {
    await save(
      "event",
      { ...newEvent("2026-11-11", zone), title: "My existing Spanish" },
      "personal-spanish",
    );
    await save(
      "event",
      { ...newEvent("2026-11-11", zone), title: "My edited class" },
      bundle.rows[0].id,
    );
    await installStudioCatalog(db);
    await remove(bundle.rows[1].id);
    await installStudioCatalog(db);
    expect((await db.rows.get("personal-spanish"))?.payload).toMatchObject({
      title: "My existing Spanish",
    });
    expect((await db.rows.get(bundle.rows[0].id))?.payload).toMatchObject({
      title: "My edited class",
    });
    expect((await db.rows.get(bundle.rows[1].id))?.deleted).toBe(true);
    expect(await db.rows.count()).toBe(bundle.rows.length + 1);
  });
});
