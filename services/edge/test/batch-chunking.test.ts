// Regression (2026-07-28): /v1/admin/category-batch handed D1 one oversized
// batch. A 98-item call (196 statements) came back {"ok":true,"processed":98}
// having written NOTHING — no category updates, no review_log rows, no error.
// The endpoint reported success by echoing the request size, so 98 accounts
// silently kept the wrong category. Every per-item batch is now chunked, and
// the response reports rows actually changed.
import assert from "node:assert/strict";
import { test } from "node:test";

const edgeModuleUrl = new URL("../src/index.ts", import.meta.url).href;
const worker = (await import(edgeModuleUrl)).default as {
  fetch(req: Request, env: Record<string, unknown>): Promise<Response>;
};

class Stmt {
  args: unknown[] = [];
  constructor(readonly sql: string) {}
  bind(...args: unknown[]) {
    this.args = args;
    return this;
  }
  async first<T>(): Promise<T | null> {
    return null;
  }
  async all<T>(): Promise<{ results?: T[] }> {
    return { results: [] };
  }
  async run() {
    return { meta: { changes: 1 } };
  }
}

class DB {
  /** One entry per batch() call — its statement count. */
  batchSizes: number[] = [];
  constructor(private readonly accountChanges = 1) {}
  prepare(sql: string) {
    return new Stmt(sql);
  }
  async batch(stmts: Stmt[]) {
    this.batchSizes.push(stmts.length);
    return stmts.map((stmt) => ({
      meta: { changes: stmt.sql.includes("INSERT INTO review_log") ? 1 : this.accountChanges },
    }));
  }
  async dump() {
    return new Uint8Array();
  }
  async exec() {
    return { meta: { changes: 0 } };
  }
}

const HDRS = { "x-admin-token": "admin", "content-type": "application/json" };
const items = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ handle: `spam${i}`, xUserId: String(1000 + i) }));

test("category-batch chunks its statements and reports rows actually updated", async () => {
  const db = new DB();
  const res = await worker.fetch(
    new Request("https://edge.test/v1/admin/category-batch", {
      method: "POST",
      headers: HDRS,
      body: JSON.stringify({ category: "porn", items: items(98) }),
    }),
    { DB: db, ADMIN_TOKEN: "admin" },
  );
  assert.equal(res.status, 200);
  const j = (await res.json()) as { processed: number; updated: number };
  assert.equal(j.processed, 98);
  // 98 UPDATEs + 98 log INSERTs = 196 statements; every batch must stay ≤100.
  assert.ok(db.batchSizes.length > 1, "196 statements must not go out as one batch");
  assert.ok(
    db.batchSizes.every((n) => n <= 100),
    `oversized batch: ${db.batchSizes.join(",")}`,
  );
  assert.equal(db.batchSizes.reduce((a, b) => a + b, 0), 196);
  // 196 changes − 98 log rows = 98 accounts touched.
  assert.equal(j.updated, 98);
});

test("category-batch does not report unmatched accounts as updated", async () => {
  const db = new DB(0);
  const res = await worker.fetch(
    new Request("https://edge.test/v1/admin/category-batch", {
      method: "POST",
      headers: HDRS,
      body: JSON.stringify({ category: "porn", items: items(3) }),
    }),
    { DB: db, ADMIN_TOKEN: "admin" },
  );

  assert.equal(res.status, 200);
  const body = (await res.json()) as { processed: number; updated: number };
  assert.equal(body.processed, 3);
  assert.equal(body.updated, 0);
});

test("whitelist, decide, and agent promotion batches all stay bounded", async () => {
  for (const [path, body] of [
    ["/v1/admin/whitelist-batch", { items: items(60) }],
    ["/v1/admin/decide-batch", { action: "approve", items: items(60) }],
    [
      "/v1/admin/agent-promote-batch",
      {
        target: "blacklist",
        items: items(60).map(({ handle, xUserId }) => ({ handle, x_user_id: xUserId })),
      },
    ],
  ] as const) {
    const db = new DB();
    const res = await worker.fetch(
      new Request(`https://edge.test${path}`, {
        method: path === "/v1/admin/whitelist-batch" ? "DELETE" : "POST",
        headers: HDRS,
        body: JSON.stringify(body),
      }),
      { DB: db, ADMIN_TOKEN: "admin" },
    );
    assert.equal(res.status, 200, path);
    assert.ok(
      db.batchSizes.every((n) => n <= 100),
      `${path} oversized batch: ${db.batchSizes.join(",")}`,
    );
  }
});
