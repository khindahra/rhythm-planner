import Dexie, { type Table } from "dexie";
import { createClient } from "@supabase/supabase-js";
import {
  type Action,
  type Payload,
  type Row,
  type RemoteRow,
  type Settings,
  defaultSettings,
  eventSchema,
} from "./model";
import { mergeRemote, sameRecord, validateEvent } from "./engine";
import { assertOccurrenceCanBeSelected } from "./availability";
export class PlannerDB extends Dexie {
  rows!: Table<Row, string>;
  meta!: Table<{ key: string; value: string }, string>;
  constructor(name: string) {
    super(name);
    this.version(1).stores({ rows: "id,type", meta: "key" });
  }
}
export let db = new PlannerDB("rhythm-guest");
export const cloud =
  import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY
    ? createClient(
        import.meta.env.VITE_SUPABASE_URL,
        import.meta.env.VITE_SUPABASE_ANON_KEY,
      )
    : null;
export async function selectAccount(id?: string) {
  db.close();
  db = new PlannerDB(`rhythm-${id || "guest"}`);
  await db.open();
  // Older builds could flag identical JSON objects with different key orders.
  await db.rows
    .filter((row) => !!row.conflict)
    .modify((row) => {
      const other = row.conflict;
      if (!other || !sameRecord(row, other)) return false;
      if (row.conflictSource !== "import") {
        row.revision = other.revision;
        row.updated_at = other.updated_at;
        row.dirty = false;
      }
      delete row.conflict;
      delete row.conflictSource;
    });
}
export async function save(
  type: Row["type"],
  payload: Payload,
  id = crypto.randomUUID() as string,
) {
  await db.transaction("rw", db.rows, async () => {
    const old = await db.rows.get(id);
    await db.rows.put({
      id,
      type,
      payload,
      deleted: false,
      revision: old?.revision || 0,
      updated_at: new Date().toISOString(),
      dirty: true,
      mutationId: crypto.randomUUID(),
      conflict: old?.conflict,
      conflictSource: old?.conflictSource,
    });
  });
  return id;
}
export async function remove(id: string) {
  await db.transaction("rw", db.rows, async () => {
    const old = await db.rows.get(id);
    if (old)
      await db.rows.put({
        ...old,
        deleted: true,
        updated_at: new Date().toISOString(),
        dirty: true,
        mutationId: crypto.randomUUID(),
      });
  });
}
export async function setStatus(
  occurrenceId: string,
  status:
    "available" | "selected" | "booking" | "booked" | "attended" | "cancelled",
) {
  await db.transaction("rw", db.rows, async () => {
    const previous = await db.rows.get(`occ:${occurrenceId}`);
    if (status === "selected" || status === "booking")
      assertOccurrenceCanBeSelected(await db.rows.toArray(), occurrenceId);
    const source = await db.rows.get(occurrenceId.split("@")[0]);
    const bookingConfirmed =
      status === "booked" ||
      (previous?.payload as import("./model").OccurrenceState | undefined)
        ?.bookingConfirmed === true ||
      (source?.payload as import("./model").PlanEvent | undefined)?.status ===
        "booked";
    await save(
      "occurrence",
      { status, bookingConfirmed },
      `occ:${occurrenceId}`,
    );
    if (status === "available" || status === "cancelled") {
      const actions = await db.rows.where("type").equals("action").toArray();
      for (const row of actions) {
        const action = row.payload as Action;
        if (
          !row.deleted &&
          action.kind === "conflict" &&
          action.status !== "completed" &&
          row.id
            .slice("action:conflict:".length)
            .split("|")
            .includes(occurrenceId)
        )
          await save(
            "action",
            {
              ...action,
              status: "completed",
              completedAt: new Date().toISOString(),
              resolvedAutomatically: true,
            },
            row.id,
          );
      }
    }
    if (status === "selected" || status === "booking") {
      const action = await db.rows.get(`action:booking:${occurrenceId}`);
      if (
        action &&
        !action.deleted &&
        (action.payload as Action).status === "completed"
      )
        await save(
          "action",
          {
            ...(action.payload as Action),
            status: "pending",
            completedAt: undefined,
            snoozeUntil: undefined,
            resolvedAutomatically: undefined,
          },
          action.id,
        );
    }
    if (
      status === "available" ||
      status === "cancelled" ||
      status === "booked"
    ) {
      const action = await db.rows.get(`action:booking:${occurrenceId}`);
      if (
        action &&
        !action.deleted &&
        (action.payload as Action).status !== "completed"
      )
        await save(
          "action",
          {
            ...(action.payload as Action),
            status: "completed",
            completedAt: new Date().toISOString(),
          },
          action.id,
        );
    }
  });
}
export async function finishAction(row: Row) {
  const a = row.payload as Action;
  await db.transaction("rw", db.rows, async () => {
    await save(
      "action",
      { ...a, status: "completed", completedAt: new Date().toISOString() },
      row.id,
    );
    if (a.kind === "booking") await setStatus(a.occurrenceId, "booked");
  });
}
export async function resolve(id: string, choice: "local" | "remote" | "both") {
  await db.transaction("rw", db.rows, async () => {
    const local = await db.rows.get(id);
    if (!local?.conflict) return;
    const remote = local.conflict;
    const fromBackup = local.conflictSource === "import";
    if (choice === "both" && local.type === "event")
      await save("event", local.payload);
    await db.rows.put({
      ...(choice === "local" ? local : remote),
      revision: fromBackup ? local.revision : remote.revision,
      conflict: undefined,
      conflictSource: undefined,
      dirty: fromBackup
        ? choice !== "local" || local.dirty
        : choice === "local",
      mutationId: crypto.randomUUID(),
    });
  });
}
let running: Promise<void> | undefined;
export function sync(): Promise<void> {
  if (running) return running;
  running = runSync().finally(() => {
    running = undefined;
  });
  return running;
}
async function runSync() {
  if (!cloud)
    throw new Error(
      "Облако не настроено. Данные сохраняются на этом устройстве.",
    );
  const client = cloud,
    localDB = db;
  const {
    data: { session },
  } = await client.auth.getSession();
  if (!session) throw new Error("Войдите в аккаунт для синхронизации.");
  if (localDB.name !== `rhythm-${session.user.id}`)
    throw new Error("Аккаунт изменился. Повторите синхронизацию.");
  for (const row of (await localDB.rows.toArray()).filter(
    (r) => r.dirty && !r.conflict,
  )) {
    const { data, error } = await client.rpc("apply_change", {
      p_id: row.id,
      p_type: row.type,
      p_payload: row.payload,
      p_deleted: row.deleted,
      p_expected: row.revision,
      p_mutation: row.mutationId,
    });
    if (error) throw error;
    const remote = data.row as RemoteRow;
    await localDB.transaction("rw", localDB.rows, async () => {
      const latest = await localDB.rows.get(row.id);
      if (!latest) return;
      if (!data.ok) {
        await localDB.rows.put(mergeRemote(latest, remote));
        return;
      }
      // An edit made while the request was in flight must remain queued.
      await localDB.rows.put(
        latest.mutationId === row.mutationId
          ? {
              ...remote,
              updated_at: remote.updated_at ?? latest.updated_at,
              conflict: latest.conflict,
              conflictSource: latest.conflictSource,
              dirty: false,
              mutationId: row.mutationId,
            }
          : { ...latest, revision: remote.revision },
      );
    });
  }
  // Complete paginated pull includes tombstones. Never filter by a device's clock.
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await client
      .from("planner_records")
      .select("id,type,payload,deleted,revision,updated_at")
      .eq("user_id", session.user.id)
      .order("id")
      .range(offset, offset + 499);
    if (error) throw error;
    await localDB.transaction("rw", localDB.rows, async () => {
      for (const remote of data as RemoteRow[])
        await localDB.rows.put(
          mergeRemote(await localDB.rows.get(remote.id), remote),
        );
    });
    if (data.length < 500) break;
  }
  await localDB.meta.put({ key: "lastSync", value: new Date().toISOString() });
}
export async function exportBackup() {
  const data = {
    format: "rhythm",
    version: 1,
    exportedAt: new Date().toISOString(),
    rows: await db.rows.toArray(),
  };
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = `rhythm-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function importBackup(file: File) {
  if (file.size > 10_000_000) throw new Error("Файл больше 10 МБ.");
  const backup = JSON.parse(await file.text());
  if (
    backup.format !== "rhythm" ||
    backup.version !== 1 ||
    !Array.isArray(backup.rows)
  )
    throw new Error("Неподдерживаемый формат резервной копии.");
  const rows = backup.rows as Row[];
  for (const r of rows) {
    if (
      typeof r.id !== "string" ||
      r.id.length > 500 ||
      typeof r.deleted !== "boolean"
    )
      throw new Error("Повреждённая запись.");
    if (r.type === "event") {
      eventSchema.parse(r.payload);
      validateEvent(r.payload as import("./model").PlanEvent);
    } else if (r.type === "action") {
      const a = r.payload as Action;
      if (
        !["booking", "cancellation", "absence", "conflict"].includes(a.kind) ||
        !["pending", "completed", "snoozed"].includes(a.status) ||
        !Number.isFinite(Date.parse(a.due)) ||
        typeof a.title !== "string" ||
        typeof a.occurrenceId !== "string" ||
        !Number.isFinite(Date.parse(a.notifyAt))
      )
        throw new Error("Повреждённое действие.");
    } else if (r.type === "attendance") {
      const a = r.payload as import("./model").Attendance;
      if (
        typeof a.title !== "string" ||
        !a.title.trim() ||
        a.title.length > 160 ||
        !/^\d{4}-\d{2}-\d{2}$/.test(a.date) ||
        !Number.isFinite(Date.parse(a.date))
      )
        throw new Error("Повреждённая отметка посещения.");
    } else if (r.type === "settings") {
      const s = r.payload as Settings;
      if (
        !s.zone ||
        !Number.isFinite(s.lead) ||
        s.lead < 0 ||
        !Number.isFinite(s.repeatMinutes) ||
        s.repeatMinutes < 15
      )
        throw new Error("Повреждённые настройки.");
      new Intl.DateTimeFormat("ru", { timeZone: s.zone });
    } else if (r.type === "occurrence") {
      if (
        ![
          "available",
          "selected",
          "booking",
          "booked",
          "attended",
          "cancelled",
        ].includes((r.payload as { status: string }).status)
      )
        throw new Error("Повреждённый статус.");
    } else throw new Error("Неизвестный тип записи.");
  }
  // Atomic merge: differing local records are preserved as visible conflicts.
  await db.transaction("rw", db.rows, async () => {
    for (const r of rows) {
      const old = await db.rows.get(r.id);
      if (old && !sameRecord(old, r)) {
        await db.rows.put({
          ...old,
          conflictSource: "import",
          conflict: {
            id: r.id,
            type: r.type,
            payload: r.payload,
            deleted: r.deleted,
            revision: old.revision,
            updated_at: r.updated_at,
          },
        });
      } else if (!old)
        await db.rows.put({
          ...r,
          revision: 0,
          dirty: true,
          mutationId: crypto.randomUUID(),
          conflict: undefined,
          conflictSource: undefined,
        });
    }
  });
}
export async function enablePush() {
  if (!cloud) throw new Error("Сначала настройте облако.");
  if (!("serviceWorker" in navigator) || !("PushManager" in window))
    throw new Error(
      "Push недоступен. На iPad установите приложение на домашний экран.",
    );
  const key = import.meta.env.VITE_VAPID_PUBLIC_KEY;
  if (!key) throw new Error("Не настроен публичный ключ VAPID.");
  const {
    data: { session },
  } = await cloud.auth.getSession();
  if (!session) throw new Error("Войдите в аккаунт.");
  if ((await Notification.requestPermission()) !== "granted")
    throw new Error("Разрешение на уведомления не получено.");
  const registration = await navigator.serviceWorker.ready;
  const padded = key.replace(/-/g, "+").replace(/_/g, "/");
  const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
  const subscription =
    (await registration.pushManager.getSubscription()) ||
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: bytes,
    }));
  const { error } = await cloud.from("push_subscriptions").upsert(
    {
      user_id: session.user.id,
      endpoint: subscription.endpoint,
      subscription: subscription.toJSON(),
    },
    { onConflict: "user_id,endpoint" },
  );
  if (error) throw error;
}
export { defaultSettings };
