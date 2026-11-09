import "fake-indexeddb/auto";
import { beforeEach, afterEach, describe, it, expect } from "vitest";
import {
  db,
  save,
  remove,
  setStatus,
  finishAction,
  importBackup,
  selectAccount,
  resolve,
} from "./store";
import { defaultSettings, newEvent, type Action } from "./model";
import { reconcileActionRows } from "./engine";
beforeEach(async () => {
  await selectAccount("test");
  await db.rows.clear();
});
afterEach(() => db.close());
describe("IndexedDB lifecycle", () => {
  it("retires a deselected class conflict even when work owns the action, and reopens it if needed again", async () => {
    const occurrenceId = "class@2026-11-09";
    const id = `action:conflict:work@2026-11-09|${occurrenceId}`;
    const action: Action = {
      kind: "conflict",
      title: "Конфликт",
      occurrenceId: "work@2026-11-09",
      due: "2026-11-09T09:00:00Z",
      notifyAt: "2026-11-09T08:00:00Z",
      status: "pending",
    };
    await save("action", action, id);
    await setStatus(occurrenceId, "available");
    const saved = (await db.rows.get(id))!;
    expect(saved.payload).toMatchObject({
      status: "completed",
      resolvedAutomatically: true,
    });
    expect(reconcileActionRows([saved], new Map([[id, action]]))).toEqual([
      { id, payload: action },
    ]);
  });
  it("reopens a booking reminder when a declined visit is chosen again", async () => {
    const occurrenceId = "class@2026-11-09",
      id = `action:booking:${occurrenceId}`;
    const action: Action = {
      kind: "booking",
      title: "Записаться",
      occurrenceId,
      due: "2026-11-09T09:00:00Z",
      notifyAt: "2026-11-09T08:00:00Z",
      status: "pending",
    };
    await save("action", action, id);
    await setStatus(occurrenceId, "available");
    expect((await db.rows.get(id))?.payload).toMatchObject({
      status: "completed",
    });
    await setStatus(occurrenceId, "selected");
    expect((await db.rows.get(id))?.payload).toMatchObject({
      status: "pending",
    });
  });
  it("persists a local-first mutation across reopen", async () => {
    await save("event", newEvent("2026-11-09", "Europe/Moscow"), "one");
    await db.close();
    await db.open();
    const row = await db.rows.get("one");
    expect(row?.dirty).toBe(true);
    expect(row?.revision).toBe(0);
  });
  it("retains soft-deleted data for sync", async () => {
    await save("event", newEvent("2026-11-09", "Europe/Moscow"), "one");
    await remove("one");
    const row = await db.rows.get("one");
    expect(row?.deleted).toBe(true);
    expect(row?.payload).toBeDefined();
  });
  it("completes booking and occurrence status atomically", async () => {
    const a: Action = {
      kind: "booking",
      title: "Запись",
      occurrenceId: "event@2026-11-09",
      due: new Date().toISOString(),
      notifyAt: new Date().toISOString(),
      status: "pending",
    };
    await save("action", a, "action");
    await finishAction((await db.rows.get("action"))!);
    await db.close();
    await db.open();
    expect((await db.rows.get("action"))?.payload).toMatchObject({
      status: "completed",
    });
    expect((await db.rows.get("occ:event@2026-11-09"))?.payload).toEqual({
      status: "booked",
      bookingConfirmed: true,
    });
  });
  it("maintains separate account stores", async () => {
    await setStatus("event", "booked");
    await selectAccount("other-test");
    expect(await db.rows.get("occ:event")).toBeUndefined();
    await selectAccount("test");
    expect(await db.rows.get("occ:event")).toBeDefined();
  });
  it("rebases a chosen local edit onto the remote revision", async () => {
    await save("event", newEvent("2026-11-09", "Europe/Moscow"), "one");
    const row = (await db.rows.get("one"))!;
    await db.rows.put({
      ...row,
      conflict: { ...row, deleted: true, revision: 4 },
    });
    await resolve("one", "local");
    const resolved = await db.rows.get("one");
    expect(resolved?.revision).toBe(4);
    expect(resolved?.deleted).toBe(false);
    expect(resolved?.dirty).toBe(true);
    expect(resolved?.conflict).toBeUndefined();
  });
  it("imports settings with reordered keys without a version conflict", async () => {
    await save("settings", defaultSettings, "settings");
    const original = (await db.rows.get("settings"))!;
    const { zone, lead, repeatMinutes } = defaultSettings;
    const rows = [{ ...original, payload: { repeatMinutes, lead, zone } }];
    await importBackup(
      new File(
        [JSON.stringify({ format: "rhythm", version: 1, rows })],
        "backup.json",
      ),
    );
    expect(await db.rows.get("settings")).toEqual(original);
  });
  it("clears equivalent conflicts from older builds when reopening an account", async () => {
    await save("settings", defaultSettings, "settings");
    const original = (await db.rows.get("settings"))!;
    const { zone, lead, repeatMinutes } = defaultSettings;
    await db.rows.put({
      ...original,
      conflictSource: "import",
      conflict: { ...original, payload: { repeatMinutes, lead, zone } },
    });
    await selectAccount("test");
    expect(await db.rows.get("settings")).toEqual(original);
  });
});
