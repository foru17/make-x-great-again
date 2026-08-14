// contrib_actives — daily distinct contributing identities + /v1/admin/contrib.
// Real SQLite (node:sqlite) behind a D1-shaped adapter, schema from schema.sql
// (same approach as rule-hit-telemetry.test.ts).
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

  async run(): Promise<{ meta: { changes?: number; last_row_id?: number } }> {
    const r = this.db.prepare(this.sql).run(...(this.args as never[]));
    return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
  }

  async first<T>(): Promise<T | null> {
    const row = this.db.prepare(this.sql).get(...(this.args as never[]));
    return (row as T | undefined) ?? null;
  }

  async all<T>(): Promise<{ results?: T[]; meta?: { changes?: number } }> {
    const rows = this.db.prepare(this.sql).all(...(this.args as never[]));
    return { results: rows as T[], meta: {} };
  }
}

function makeD1(db: DatabaseSync) {
  return {
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
  };
}

const edgeModuleUrl = new URL("../src/index.ts", import.meta.url).href;
const worker = (await import(edgeModuleUrl)).default as {
  fetch(req: Request, env: Record<string, unknown>): Promise<Response>;
};

const ADMIN_TOKEN = "contrib-admin-token";

function makeEnv() {
  const db = new DatabaseSync(":memory:");
  db.exec(schemaSql);
  db.prepare(
    `INSERT INTO keyword_rules (pattern, field, action, verdict_label, category, enabled, created_at)
     VALUES ('约炮','display_name','blacklist','porn_bot','porn',1,?)`,
  ).run(Date.now());
  return { db, env: { DB: makeD1(db), REPORT_SALT: "contrib-salt", ADMIN_TOKEN } };
}

function post(env: Record<string, unknown>, path: string, body: unknown, ip = "203.0.113.50") {
  return worker.fetch(
    new Request(`https://edge.test${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": ip },
      body: JSON.stringify(body),
    }),
    env,
  );
}

test("report and rule-write paths record daily distinct contributors", async () => {
  const { db, env } = makeEnv();

  // Two reports from the same (anonymous) identity → 1 distinct fp, 2 events.
  // Display names hit the seeded keyword rule so the path never reaches the
  // LLM (out of scope here; the LLM client is not mocked in this file).
  const r1 = await post(env, "/v1/report", { handle: "SpamTarget1", displayName: "同城约炮 A" });
  assert.equal(r1.status, 200);
  const r2 = await post(env, "/v1/report", { handle: "SpamTarget2", displayName: "同城约炮 B" });
  assert.equal(r2.status, 200);
  // A duplicate report of the same target must NOT bump the ledger again.
  await post(env, "/v1/report", { handle: "SpamTarget1", displayName: "同城约炮 A" });

  const report = db
    .prepare("SELECT count(DISTINCT fp) d, sum(count) e FROM contrib_actives WHERE kind='report'")
    .get() as { d: number; e: number };
  assert.equal(report.d, 1);
  assert.equal(report.e, 2);

  // Anonymous classify hitting a keyword rule → rule_write_anon.
  const c1 = await post(env, "/v1/classify", { handle: "RuleBot1", displayName: "同城约炮" });
  assert.equal(c1.status, 200);
  const rule = db
    .prepare("SELECT kind, count FROM contrib_actives WHERE kind LIKE 'rule_write%'")
    .get() as { kind: string; count: number };
  assert.equal(rule.kind, "rule_write_anon");
  assert.equal(rule.count, 1);
});

test("/v1/admin/contrib aggregates per day and kind, admin-gated", async () => {
  const { db, env } = makeEnv();
  const day = new Date().toISOString().slice(0, 10);
  const seed = db.prepare(
    "INSERT INTO contrib_actives (day, kind, fp, count, first_at, last_at) VALUES (?,?,?,?,1,1)",
  );
  seed.run(day, "classify", "fp-a", 5);
  seed.run(day, "classify", "fp-b", 2);
  seed.run(day, "report", "fp-a", 1);
  seed.run("2000-01-01", "classify", "fp-old", 9); // outside the window

  const denied = await worker.fetch(new Request("https://edge.test/v1/admin/contrib"), env);
  assert.equal(denied.status, 403);

  const res = await worker.fetch(
    new Request("https://edge.test/v1/admin/contrib?days=7", {
      headers: { "x-admin-token": ADMIN_TOKEN },
    }),
    env,
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    list: { day: string; kind: string; actives: number; events: number }[];
  };
  const classify = body.list.find((r) => r.kind === "classify");
  assert.ok(classify);
  assert.equal(classify.day, day);
  assert.equal(classify.actives, 2);
  assert.equal(classify.events, 7);
  assert.equal(body.list.find((r) => r.kind === "report")?.actives, 1);
  assert.ok(!body.list.some((r) => r.day === "2000-01-01"));
});
