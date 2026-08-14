// /v1/whitelist paging: the default page must exceed the real whitelist size
// (deployed clients fetch with no params), and since/limit must page cleanly.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

const schemaSql = readFileSync(new URL("../schema.sql", import.meta.url), "utf8");

class SqliteStmt {
  private args: unknown[] = [];

  constructor(
    private db: DatabaseSync,
    private sql: string,
  ) {}

  bind(...args: unknown[]): SqliteStmt {
    this.args = args;
    return this;
  }

  async run(): Promise<{ meta: { changes?: number } }> {
    const r = this.db.prepare(this.sql).run(...(this.args as never[]));
    return { meta: { changes: Number(r.changes) } };
  }

  async first<T>(): Promise<T | null> {
    return ((this.db.prepare(this.sql).get(...(this.args as never[])) as T) ?? null) as T | null;
  }

  async all<T>(): Promise<{ results?: T[] }> {
    return { results: this.db.prepare(this.sql).all(...(this.args as never[])) as T[] };
  }
}

const edgeModuleUrl = new URL("../src/index.ts", import.meta.url).href;
const worker = (await import(edgeModuleUrl)).default as {
  fetch(req: Request, env: Record<string, unknown>): Promise<Response>;
};

test("default whitelist page covers a 2000+ set; since/limit pages the rest", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec(schemaSql);
  db.exec(
    `INSERT INTO accounts (handle, verdict_label, confidence, reasons, status, source, last_scored, first_seen)
     SELECT 'wl' || value, 'legit', 1, '["seed"]', 'whitelisted', 'seed', value, value
       FROM (WITH RECURSIVE seq(value) AS (SELECT 1 UNION ALL SELECT value+1 FROM seq WHERE value < 2600)
             SELECT value FROM seq)`,
  );
  const env = {
    DB: {
      prepare: (sql: string) => new SqliteStmt(db, sql),
      batch: async (stmts: SqliteStmt[]) => {
        const out = [];
        for (const s of stmts) out.push(await s.run());
        return out;
      },
      dump: async () => new Uint8Array(),
      exec: async (sql: string) => {
        db.exec(sql);
        return { meta: {} };
      },
    },
  };

  const full = await worker.fetch(new Request("https://edge.test/v1/whitelist"), env);
  assert.equal(full.status, 200);
  const fullBody = (await full.json()) as { count: number; latestAt: number };
  assert.equal(fullBody.count, 2600); // default page ≥ the whole current set
  assert.equal(fullBody.latestAt, 2600);

  const p1 = (await (
    await worker.fetch(new Request("https://edge.test/v1/whitelist?limit=2000"), env)
  ).json()) as { count: number; latestAt: number };
  assert.equal(p1.count, 2000);
  const p2 = (await (
    await worker.fetch(
      new Request(`https://edge.test/v1/whitelist?since=${p1.latestAt}&limit=2000`, {}),
      env,
    )
  ).json()) as { count: number; list: { handle: string }[] };
  assert.equal(p2.count, 600); // no overlap, no gap
});
