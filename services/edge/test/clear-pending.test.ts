import assert from "node:assert/strict";
import { test } from "node:test";

const edgeModuleUrl = new URL("../src/index.ts", import.meta.url).href;
const worker = (await import(edgeModuleUrl)).default as {
  fetch(req: Request, env: Record<string, unknown>): Promise<Response>;
};

class Stmt {
  args: unknown[] = [];

  constructor(
    readonly db: DB,
    readonly sql: string,
  ) {}

  bind(...args: unknown[]) {
    this.args = args;
    return this;
  }

  async first<T>(): Promise<T | null> {
    this.db.queries.push(this);
    if (this.sql.includes("count(*)") && this.sql.includes("status='auto_pending_review'")) {
      return { n: this.db.pending } as T;
    }
    return null;
  }

  async all<T>(): Promise<{ results?: T[] }> {
    this.db.queries.push(this);
    return { results: [] };
  }

  async run() {
    this.db.queries.push(this);
    return { meta: { changes: 0 } };
  }
}

class DB {
  queries: Stmt[] = [];
  batches: Stmt[][] = [];

  constructor(public pending: number) {}

  prepare(sql: string) {
    return new Stmt(this, sql);
  }

  async batch(stmts: Stmt[]) {
    this.batches.push(stmts);
    const update = stmts.find((stmt) => stmt.sql.includes("UPDATE accounts"));
    const limit = Number(update?.args[0] ?? 0);
    const changed = Math.min(this.pending, limit);
    this.pending -= changed;
    return stmts.map((stmt) => ({
      meta: { changes: stmt === update ? changed : 1 },
    }));
  }

  async dump() {
    return new Uint8Array();
  }

  async exec() {
    return { meta: { changes: 0 } };
  }
}

const headers = {
  "x-admin-token": "admin",
  "content-type": "application/json",
};
const env = (db: DB) => ({ DB: db, ADMIN_TOKEN: "admin" });

test("clear-pending requires admin authentication", async () => {
  const res = await worker.fetch(
    new Request("https://edge.test/v1/admin/clear-pending", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    }),
    env(new DB(12)),
  );
  assert.equal(res.status, 403);
});

test("clear-pending defaults to a read-only exact raw count", async () => {
  const db = new DB(238_020);
  const res = await worker.fetch(
    new Request("https://edge.test/v1/admin/clear-pending", {
      method: "POST",
      headers,
      body: "{}",
    }),
    env(db),
  );
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    ok: true,
    dryRun: true,
    pendingBefore: 238_020,
    processed: 0,
    pendingAfter: 238_020,
    done: false,
    cap: 5_000,
  });
  assert.equal(db.batches.length, 0);
});

test("clear-pending rejects writes without the explicit confirmation", async () => {
  const db = new DB(20);
  const res = await worker.fetch(
    new Request("https://edge.test/v1/admin/clear-pending", {
      method: "POST",
      headers,
      body: JSON.stringify({ dryRun: false, cleanupId: "pending-reset" }),
    }),
    env(db),
  );
  assert.equal(res.status, 400);
  assert.equal(db.batches.length, 0);
  assert.equal(db.pending, 20);
});

test("clear-pending updates only the pending partition and writes one aggregate audit row", async () => {
  const db = new DB(6_234);
  const res = await worker.fetch(
    new Request("https://edge.test/v1/admin/clear-pending", {
      method: "POST",
      headers,
      body: JSON.stringify({
        dryRun: false,
        limit: 5_000,
        cleanupId: "2026-09-01-pending-reset",
        confirm: "CLEAR_PENDING_REVIEW",
      }),
    }),
    env(db),
  );
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    ok: true,
    dryRun: false,
    pendingBefore: 6_234,
    processed: 5_000,
    pendingAfter: 1_234,
    done: false,
    cap: 5_000,
  });

  const [batch] = db.batches;
  assert.equal(batch?.length, 2);
  const update = batch?.[0];
  assert.ok(update?.sql.includes("SET status='rejected'"));
  assert.equal(update?.sql.match(/status='auto_pending_review'/g)?.length, 2);
  assert.deepEqual(update?.args, [5_000]);
  assert.ok(!update?.sql.includes("human_confirmed"));
  assert.ok(!update?.sql.includes("whitelisted"));
  assert.ok(!update?.sql.includes("agent_pending"));

  const audit = batch?.[1];
  assert.ok(audit?.sql.includes("INSERT INTO review_log"));
  assert.equal(audit?.args[2], "reject_pending_batch");
  assert.match(String(audit?.args[4]), /cleanup=2026-09-01-pending-reset/);
});

test("clear-pending enforces its 5000-row batch ceiling", async () => {
  const db = new DB(10_000);
  const res = await worker.fetch(
    new Request("https://edge.test/v1/admin/clear-pending", {
      method: "POST",
      headers,
      body: JSON.stringify({ dryRun: true, limit: 5_001 }),
    }),
    env(db),
  );
  assert.equal(res.status, 400);
  assert.equal(db.batches.length, 0);
});
