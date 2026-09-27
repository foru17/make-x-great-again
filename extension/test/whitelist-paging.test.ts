// Whitelist sync must page through /v1/whitelist until a short page — a bare
// single fetch once stored only the server's default page (500 rows) as the
// whole whitelist (2026-08-14: 2135 whitelisted, clients held 500 → FP
// protection silently dropped for the other 1635 accounts).
import assert from "node:assert/strict";
import test from "node:test";

function mockChrome() {
  const store = new Map<string, unknown>();
  const root = globalThis as unknown as { chrome?: unknown };
  const previous = root.chrome;
  root.chrome = {
    storage: {
      local: {
        get: async (keys: string | string[]) => {
          const list = Array.isArray(keys) ? keys : [keys];
          return Object.fromEntries(list.map((k) => [k, store.get(k)]));
        },
        set: async (obj: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(obj)) store.set(k, v);
        },
      },
      onChanged: { addListener: () => {} },
    },
  };
  return {
    store,
    restore: () => {
      if (previous === undefined) delete root.chrome;
      else root.chrome = previous;
    },
  };
}

test("whitelist sync pages until a short page and stores the full set", async () => {
  const { store, restore } = mockChrome();
  const originalFetch = globalThis.fetch;
  const wlCalls: string[] = [];
  const page1 = Array.from({ length: 2000 }, (_, i) => ({
    x_user_id: String(1000 + i),
    handle: `u${i}`,
    last_scored: i + 1,
  }));
  const page2 = Array.from({ length: 135 }, (_, i) => ({
    x_user_id: String(9000 + i),
    handle: `w${i}`,
    last_scored: 3000 + i,
  }));
  globalThis.fetch = (async (url: RequestInfo | URL) => {
    const u = String(url);
    if (u.includes("/v1/whitelist")) {
      wlCalls.push(u);
      const since = Number(new URL(u).searchParams.get("since"));
      const page = since === 0 ? page1 : since === 2000 ? page2 : [];
      return new Response(
        JSON.stringify({
          list: page,
          count: page.length,
          latestAt: page.length ? page[page.length - 1]!.last_scored : since,
        }),
        { status: 200 },
      );
    }
    if (u.includes("/v1/list/meta")) {
      return new Response(
        JSON.stringify({ version: "v-current", artifacts: { lite: "/v1/artifacts/lite-x.json" } }),
        { status: 200 },
      );
    }
    throw new Error(`unexpected fetch ${u}`);
  }) as typeof fetch;

  try {
    const { LIST_KEY, WL_KEY, syncList } = await import("../lib/list-sync");
    // Stored list already matches the served version → the sync is a
    // whitelist-refresh + meta check only (no lite download to mock).
    store.set(LIST_KEY, {
      version: "v-current",
      fetchedAt: 1,
      count: 1,
      entries: [["1", "seed", "pph"]],
    });
    const result = await syncList(false);
    assert.equal(result.white, 2135);
    const stored = store.get(WL_KEY) as { count: number; entries: [string, string][] };
    assert.equal(stored.count, 2135);
    assert.equal(stored.entries.length, 2135);
    assert.equal(stored.entries[0]![1], "u0");
    assert.equal(stored.entries[2134]![1], "w134");
    // Exactly two pages: the short second page ends the loop.
    assert.equal(wlCalls.length, 2);
    assert.match(wlCalls[0]!, /since=0&limit=2000/);
    assert.match(wlCalls[1]!, /since=2000&limit=2000/);
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});
