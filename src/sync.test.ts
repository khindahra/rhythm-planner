import "fake-indexeddb/auto";
import { vi, it, expect, beforeEach } from "vitest";
const mock = vi.hoisted(() => ({
  rpc: vi.fn(),
  getSession: vi.fn(),
  pull: vi.fn(),
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: { getSession: mock.getSession },
    rpc: mock.rpc,
    from: () => ({
      select: () => ({ eq: () => ({ order: () => ({ range: mock.pull }) }) }),
    }),
  }),
}));
vi.stubEnv("VITE_SUPABASE_URL", "https://test.supabase.co");
vi.stubEnv("VITE_SUPABASE_ANON_KEY", "public-test-key");
const store = await import("./store");
const { selectAccount, save, remove, sync } = store;
const { newEvent } = await import("./model");
beforeEach(async () => {
  vi.clearAllMocks();
  await selectAccount("sync-test");
  await store.db.rows.clear();
  mock.getSession.mockResolvedValue({
    data: { session: { user: { id: "sync-test" } } },
  });
  mock.pull.mockResolvedValue({ data: [], error: null });
});
const event = () => newEvent("2026-11-09", "Europe/Moscow");
it("retries network failures using the same idempotency mutation key", async () => {
  await save("event", event(), "x");
  const original = (await store.db.rows.get("x"))!;
  mock.rpc.mockResolvedValueOnce({ error: new Error("Offline") });
  await expect(sync()).rejects.toThrow("Offline");
  expect((await store.db.rows.get("x"))?.dirty).toBe(true);
  mock.rpc.mockResolvedValueOnce({
    data: { ok: true, row: { ...original, revision: 1 } },
  });
  await sync();
  expect(mock.rpc.mock.calls[0][1].p_mutation).toBe(
    mock.rpc.mock.calls[1][1].p_mutation,
  );
  expect((await store.db.rows.get("x"))?.dirty).toBe(false);
});
it("preserves a new local edit made during an in-flight sync", async () => {
  await save("event", event(), "x");
  const original = (await store.db.rows.get("x"))!;
  let deliver!: (v: unknown) => void;
  let started!: () => void;
  const ready = new Promise<void>((r) => {
    started = r;
  });
  mock.rpc.mockImplementationOnce(() => {
    started();
    return new Promise((r) => {
      deliver = r;
    });
  });
  const pending = sync();
  await ready;
  await save("event", { ...event(), title: "Edited during request" }, "x");
  deliver({ data: { ok: true, row: { ...original, revision: 1 } } });
  await pending;
  const latest = await store.db.rows.get("x");
  expect(latest?.payload).toMatchObject({ title: "Edited during request" });
  expect(latest?.dirty).toBe(true);
  expect(latest?.revision).toBe(1);
});
it("retains both sides of a remote deletion conflict", async () => {
  await save("event", event(), "x");
  const local = (await store.db.rows.get("x"))!;
  mock.rpc.mockResolvedValue({
    data: { ok: false, row: { ...local, deleted: true, revision: 2 } },
  });
  const updated_at = "2026-11-09T12:00:00Z";
  mock.pull.mockResolvedValue({
    data: [{ ...local, deleted: true, revision: 2, updated_at }],
  });
  await sync();
  expect((await store.db.rows.get("x"))?.deleted).toBe(false);
  expect((await store.db.rows.get("x"))?.conflict?.deleted).toBe(true);
  expect((await store.db.rows.get("x"))?.conflict?.updated_at).toBe(updated_at);
});
it("uploads tombstones instead of deleting remote rows", async () => {
  await save("event", event(), "x");
  await remove("x");
  const deleted = (await store.db.rows.get("x"))!;
  mock.rpc.mockResolvedValue({
    data: { ok: true, row: { ...deleted, revision: 1 } },
  });
  await sync();
  expect(mock.rpc.mock.calls[0][1].p_deleted).toBe(true);
  expect((await store.db.rows.get("x"))?.deleted).toBe(true);
  expect((await store.db.rows.get("x"))?.dirty).toBe(false);
});
it("serializes concurrent sync attempts", async () => {
  await save("event", event(), "x");
  const original = (await store.db.rows.get("x"))!;
  mock.rpc.mockResolvedValue({
    data: { ok: true, row: { ...original, revision: 1 } },
  });
  await Promise.all([sync(), sync()]);
  expect(mock.rpc).toHaveBeenCalledTimes(1);
});
