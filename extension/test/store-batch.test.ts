import assert from "node:assert/strict";
import { test } from "node:test";
import type { LocalStats } from "../lib/stats";
import type { BlockRecord, Stats } from "../lib/store";

type StorageData = Record<string, unknown>;
type ChangeListener = (
  changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
  area: string,
) => void;

const data: StorageData = {};
const setCalls = new Map<string, number>();
const changeListeners: ChangeListener[] = [];
let failingSetKey: string | null = null;

const clone = <T>(value: T): T => structuredClone(value);
const later = <T>(value: T): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), 2));

function select(keys: unknown): StorageData {
  if (keys === null) return clone(data);
  const names =
    typeof keys === "string"
      ? [keys]
      : Array.isArray(keys)
        ? keys
        : Object.keys((keys as StorageData | undefined) ?? {});
  return Object.fromEntries(
    names.filter((key) => key in data).map((key) => [key, clone(data[key])]),
  );
}

function reset(next: StorageData = {}) {
  for (const key of Object.keys(data)) delete data[key];
  Object.assign(data, clone(next));
  setCalls.clear();
  failingSetKey = null;
}

const chromeStub = {
  storage: {
    local: {
      get(keys: unknown, callback?: (got: StorageData) => void) {
        const snapshot = select(keys);
        if (callback) {
          setTimeout(() => callback(snapshot), 2);
          return;
        }
        return later(snapshot);
      },
      set(items: StorageData, callback?: () => void) {
        const snapshot = clone(items);
        const commit = async () => {
          await later(undefined);
          const keys = Object.keys(snapshot);
          if (keys.some((key) => key === failingSetKey)) {
            throw new Error(`set failed: ${failingSetKey}`);
          }
          const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {};
          for (const key of keys) {
            changes[key] = { oldValue: clone(data[key]), newValue: clone(snapshot[key]) };
            data[key] = clone(snapshot[key]);
            setCalls.set(key, (setCalls.get(key) ?? 0) + 1);
          }
          for (const listener of changeListeners) listener(changes, "local");
        };
        if (callback) {
          void commit().then(callback);
          return;
        }
        return commit();
      },
    },
    onChanged: {
      addListener(listener: ChangeListener) {
        changeListeners.push(listener);
      },
    },
  },
};

class FakeLockManager {
  requests = 0;
  private chains = new Map<string, Promise<unknown>>();

  request<T>(name: string, callback: () => T | Promise<T>): Promise<T> {
    this.requests++;
    const previous = this.chains.get(name) ?? Promise.resolve();
    const run = previous.then(callback, callback);
    this.chains.set(name, run.catch(() => {}));
    return run;
  }
}

const root = globalThis as unknown as { chrome?: unknown };
const previousChrome = root.chrome;
const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
root.chrome = chromeStub;

const store = await import("../lib/store");
const blocklist = await import("../lib/blocklist");
const localStats = await import("../lib/stats");

const record = (id: string): BlockRecord => ({
  id,
  handle: `user-${id}`,
  source: "auto",
  ts: 1,
});

function setNavigator(locks?: FakeLockManager) {
  Object.defineProperty(globalThis, "navigator", {
    value: locks ? { locks } : {},
    configurable: true,
    writable: true,
  });
}

test("storage batches and RMW locks", async (t) => {
  try {
    await t.test("addBlockRecords writes one deduplicated batch", async () => {
      setNavigator();
      reset({ "xss:blocklist:v2": [record("existing")] });
      await store.addBlockRecords([
        record("existing"),
        record("new-a"),
        record("new-a"),
        record("new-b"),
      ]);

      const rows = data["xss:blocklist:v2"] as BlockRecord[];
      assert.deepEqual(
        rows.map((row) => row.id),
        ["existing", "new-a", "new-b"],
      );
      assert.equal(setCalls.get("xss:blocklist:v2"), 1);
    });

    await t.test("fallback promise chain preserves concurrent records", async () => {
      setNavigator();
      reset({ "xss:blocklist:v2": [] });
      await Promise.all(
        Array.from({ length: 12 }, (_, index) => store.addBlockRecord(record(`f-${index}`))),
      );
      assert.equal((data["xss:blocklist:v2"] as BlockRecord[]).length, 12);
    });

    await t.test("Web Locks branch preserves concurrent records", async () => {
      const locks = new FakeLockManager();
      setNavigator(locks);
      reset({ "xss:blocklist:v2": [] });
      await Promise.all(
        Array.from({ length: 12 }, (_, index) => store.addBlockRecord(record(`w-${index}`))),
      );
      assert.equal((data["xss:blocklist:v2"] as BlockRecord[]).length, 12);
      assert.equal(locks.requests, 12);
    });

    await t.test("both stats stores accumulate concurrent increments", async () => {
      setNavigator();
      reset({
        "xss:stats": { detections: 0, cacheHits: 0, blocks: 0, byLabel: {} },
        mxga_stats_v1: { scanned: 0, hitPublic: 0, blocked: 0, firstUsedAt: 1 },
      });
      await Promise.all(
        Array.from({ length: 10 }, () => [
          store.bumpStats({ blocks: 1 }),
          localStats.bumpStatBy("blocked", 1),
        ]).flat(),
      );
      assert.equal((data["xss:stats"] as Stats).blocks, 10);
      assert.equal((data.mxga_stats_v1 as LocalStats).blocked, 10);
    });

    await t.test("addBlockedMany deduplicates and updates the sync fast path", async () => {
      setNavigator();
      reset({ "xss:blocked": ["old"] });
      const pending = blocklist.addBlockedMany(["new-a", "new-a", "new-b"]);
      assert.equal(blocklist.isBlockedSync("new-a"), true);
      assert.equal(blocklist.isBlockedSync("new-b"), true);
      await pending;
      assert.deepEqual(new Set(data["xss:blocked"] as string[]), new Set(["old", "new-a", "new-b"]));
      assert.equal(setCalls.get("xss:blocked"), 1);
    });

    await t.test("strict batch surfaces set failures while the single wrapper does not", async () => {
      setNavigator();
      reset({ "xss:blocklist:v2": [] });
      failingSetKey = "xss:blocklist:v2";
      await assert.rejects(store.addBlockRecords([record("strict")]));
      await assert.doesNotReject(store.addBlockRecord(record("legacy-wrapper")));
      assert.deepEqual(data["xss:blocklist:v2"], []);
    });
  } finally {
    if (previousChrome === undefined) delete root.chrome;
    else root.chrome = previousChrome;
    if (previousNavigator) Object.defineProperty(globalThis, "navigator", previousNavigator);
    else delete (globalThis as { navigator?: unknown }).navigator;
  }
});
