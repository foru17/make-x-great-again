// /v1/rule-hits ingest + /v1/admin/rule-hits stats/promote.
//
// Uses a REAL SQLite database (node:sqlite) behind a D1-shaped adapter — the
// endpoints lean on ON CONFLICT upserts, GROUP BY aggregates and the
// lower(handle) expression index, which a substring-matching mock cannot
// exercise faithfully. Schema comes straight from schema.sql, so drift
// between test DB and production DDL is impossible.
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

const ADMIN_TOKEN = "test-admin-token";

function makeEnv(overrides: Record<string, unknown> = {}) {
  const db = new DatabaseSync(":memory:");
  db.exec(schemaSql);
  const now = Date.now();
  const seed = db.prepare(
    `INSERT INTO keyword_rules (pattern, field, action, verdict_label, category, enabled, created_at)
     VALUES (?,?,?,?,?,?,?)`,
  );
  seed.run("约炮", "display_name", "blacklist", "porn_bot", "porn", 1, now);
  seed.run("quark.cn", "tweet", "blacklist", "spam", "resource", 1, now);
  seed.run("retired-pattern", "any", "blacklist", "spam", null, 0, now); // disabled
  seed.run("goodword", "any", "whitelist", "legit", null, 1, now); // non-blacklist
  return {
    db,
    env: {
      DB: makeD1(db),
      REPORT_SALT: "unit-test-salt",
      ADMIN_TOKEN,
      ...overrides,
    },
  };
}

function postHits(
  env: Record<string, unknown>,
  hits: unknown[],
  ip = "203.0.113.7",
): Promise<Response> {
  return worker.fetch(
    new Request("https://edge.test/v1/rule-hits", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": ip },
      body: JSON.stringify({ hits }),
    }),
    env,
  );
}

// getKeywordRules holds a module-level 30s cache shared across tests, so
// every env in this file seeds the SAME rule set and the cache stays truthful.

test("rule-hits: malformed body is rejected", async () => {
  const { env } = makeEnv();
  const res = await worker.fetch(
    new Request("https://edge.test/v1/rule-hits", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.9" },
      body: "not json",
    }),
    env,
  );
  assert.equal(res.status, 400);

  const empty = await postHits(env, []);
  assert.equal(empty.status, 400);

  const badHandle = await postHits(env, [{ pattern: "约炮", handle: "not a handle!" }]);
  assert.equal(badHandle.status, 400);
});

test("rule-hits: fails closed without REPORT_SALT", async () => {
  const { env } = makeEnv({ REPORT_SALT: undefined });
  const res = await postHits(env, [{ pattern: "约炮", handle: "SpamBot1" }]);
  assert.equal(res.status, 503);
});

test("rule-hits: stores known-rule hits, drops unknown/disabled/dupe rows, never touches moderation tables", async () => {
  const { env, db } = makeEnv();
  const res = await postHits(env, [
    { pattern: "约炮", handle: "SpamBot1", xUserId: "123456", category: "lies" },
    { pattern: "约炮", handle: "spambot1" }, // dupe of the row above (case-insensitive)
    { pattern: "retired-pattern", handle: "SpamBot2" }, // disabled rule
    { pattern: "goodword", handle: "SpamBot3" }, // whitelist rule — not reportable
    { pattern: "never-existed", handle: "SpamBot4" },
  ]);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { ok: boolean; stored: number; dropped: number };
  assert.equal(body.ok, true);
  assert.equal(body.stored, 1);
  assert.equal(body.dropped, 4);

  const row = db
    .prepare("SELECT * FROM rule_hit_stats WHERE pattern='约炮'")
    .get() as Record<string, unknown>;
  assert.equal(row.handle, "spambot1");
  assert.equal(row.x_user_id, "123456");
  // Stored category comes from the RULE, not the client's advisory field.
  assert.equal(row.category, "porn");
  assert.equal(row.count, 1);

  // Isolation red line: ingest must not create moderation rows.
  assert.equal(db.prepare("SELECT count(*) n FROM accounts").get()!.n, 0);
  assert.equal(db.prepare("SELECT count(*) n FROM reports").get()!.n, 0);
  assert.equal(db.prepare("SELECT count(*) n FROM review_log").get()!.n, 0);
});

test("rule-hits: same (day,pattern,handle) upserts count and keeps first uid", async () => {
  const { env, db } = makeEnv();
  await postHits(env, [{ pattern: "约炮", handle: "SpamBot1", xUserId: "111" }]);
  const second = await postHits(env, [{ pattern: "约炮", handle: "SPAMBOT1" }]);
  assert.equal(((await second.json()) as { stored: number }).stored, 1);
  const row = db
    .prepare("SELECT count, x_user_id FROM rule_hit_stats WHERE pattern='约炮'")
    .get() as { count: number; x_user_id: string };
  assert.equal(row.count, 2);
  assert.equal(row.x_user_id, "111");
});

test("rule-hits: per-IP rate limit closes after 12 requests/hour", async () => {
  const { env } = makeEnv();
  for (let i = 0; i < 12; i++) {
    const res = await postHits(env, [{ pattern: "约炮", handle: `Bot${i}` }], "198.51.100.5");
    assert.equal(res.status, 200, `request ${i + 1} should pass`);
  }
  const blocked = await postHits(env, [{ pattern: "约炮", handle: "BotX" }], "198.51.100.5");
  assert.equal(blocked.status, 429);
  // A different IP is unaffected.
  const other = await postHits(env, [{ pattern: "约炮", handle: "BotY" }], "198.51.100.6");
  assert.equal(other.status, 200);
});

test("rule-hits: daily row fuse accepts and discards", async () => {
  const { env, db } = makeEnv();
  const day = new Date().toISOString().slice(0, 10);
  // Simulate a full day bucket (fuse threshold 50k) without 50k inserts by
  // seeding count(*) via a temp view? No — insert directly in a loop is too
  // slow; instead drop the fuse by seeding exactly the threshold worth of
  // rows in one exec using a recursive CTE.
  db.exec(
    `INSERT INTO rule_hit_stats (day, pattern, handle, count, first_seen, last_seen)
     SELECT '${day}', 'seed', 'h' || value, 1, 0, 0
       FROM (WITH RECURSIVE seq(value) AS (SELECT 1 UNION ALL SELECT value+1 FROM seq WHERE value < 50000)
             SELECT value FROM seq)`,
  );
  const res = await postHits(env, [{ pattern: "约炮", handle: "Overflow" }]);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { stored: number; dropped: number };
  assert.equal(body.stored, 0);
  assert.equal(body.dropped, 1);
  assert.equal(
    db.prepare("SELECT count(*) n FROM rule_hit_stats WHERE handle='overflow'").get()!.n,
    0,
  );
});

test("admin rule-hits: aggregate + per-rule accounts + explicit promote", async () => {
  const { env, db } = makeEnv();
  await postHits(env, [
    { pattern: "约炮", handle: "SpamBot1", xUserId: "111" },
    { pattern: "约炮", handle: "SpamBot2" },
    { pattern: "quark.cn", handle: "PanBot1" },
  ]);
  await postHits(env, [{ pattern: "约炮", handle: "SpamBot1", xUserId: "111" }], "203.0.113.8");
  // SpamBot2 already known to moderation — promote must skip it.
  db.prepare(
    `INSERT INTO accounts (handle, x_user_id, verdict_label, confidence, reasons, status, source, last_scored, first_seen)
     VALUES ('spambot2', NULL, 'spam', 0.9, '["seed"]', 'human_confirmed', 'seed', 1, 1)`,
  ).run();

  const unauthorized = await worker.fetch(new Request("https://edge.test/v1/admin/rule-hits"), env);
  assert.equal(unauthorized.status, 403);

  const agg = await worker.fetch(
    new Request("https://edge.test/v1/admin/rule-hits?days=7", {
      headers: { "x-admin-token": ADMIN_TOKEN },
    }),
    env,
  );
  assert.equal(agg.status, 200);
  const aggBody = (await agg.json()) as {
    list: { pattern: string; hits: number; accounts: number; category: string | null }[];
  };
  const porn = aggBody.list.find((r) => r.pattern === "约炮");
  assert.ok(porn);
  assert.equal(porn.hits, 3); // 2 sightings of bot1 + 1 of bot2
  assert.equal(porn.accounts, 2);
  assert.equal(porn.category, "porn");

  const accounts = await worker.fetch(
    new Request("https://edge.test/v1/admin/rule-hits/accounts?pattern=%E7%BA%A6%E7%82%AE", {
      headers: { "x-admin-token": ADMIN_TOKEN },
    }),
    env,
  );
  const accBody = (await accounts.json()) as {
    list: { handle: string; hits: number; listed: number }[];
  };
  assert.equal(accBody.list.length, 2);
  assert.equal(accBody.list[0]!.handle, "spambot1"); // 2 hits sorts first
  assert.equal(accBody.list.find((r) => r.handle === "spambot2")!.listed, 1);
  assert.equal(accBody.list.find((r) => r.handle === "spambot1")!.listed, 0);

  const promote = await worker.fetch(
    new Request("https://edge.test/v1/admin/rule-hits/promote", {
      method: "POST",
      headers: { "content-type": "application/json", "x-admin-token": ADMIN_TOKEN },
      body: JSON.stringify({
        pattern: "约炮",
        items: [
          { handle: "spambot1", xUserId: "111" },
          { handle: "spambot2" }, // existing row — must be skipped, not overwritten
        ],
      }),
    }),
    env,
  );
  assert.equal(promote.status, 200);
  const promoteBody = (await promote.json()) as { queued: number; skipped: number };
  assert.equal(promoteBody.queued, 1);
  assert.equal(promoteBody.skipped, 1);

  const queued = db
    .prepare("SELECT status, source, category, verdict_label FROM accounts WHERE handle='spambot1'")
    .get() as Record<string, unknown>;
  assert.equal(queued.status, "auto_pending_review");
  assert.equal(queued.source, "rule_hit_stats");
  assert.equal(queued.category, "porn");
  assert.equal(queued.verdict_label, "porn_bot");
  const confirmed = db
    .prepare("SELECT status FROM accounts WHERE handle='spambot2'")
    .get() as Record<string, unknown>;
  assert.equal(confirmed.status, "human_confirmed");
});

test("rule-hits: evidence (field + excerpt) is stored, kept on upsert, and must contain the pattern", async () => {
  const { db, env } = makeEnv();
  const first = await postHits(env, [
    {
      pattern: "约炮",
      handle: "SpamBot9",
      field: "display_name",
      matchedText: "同城约炮 看主页",
    },
    // Excerpt that does not contain the pattern → not an evidence channel.
    { pattern: "quark.cn", handle: "SpamBot8", field: "tweet", matchedText: "unrelated text" },
  ]);
  assert.equal(((await first.json()) as { stored: number }).stored, 2);
  const a = db
    .prepare("SELECT field, sample_text FROM rule_hit_stats WHERE handle='spambot9'")
    .get() as Record<string, unknown>;
  assert.equal(a.field, "display_name");
  assert.equal(a.sample_text, "同城约炮 看主页");
  const b = db
    .prepare("SELECT field, sample_text FROM rule_hit_stats WHERE handle='spambot8'")
    .get() as Record<string, unknown>;
  assert.equal(b.field, "tweet");
  assert.equal(b.sample_text, null, "excerpt without the pattern is dropped");

  // A later legacy sighting (no evidence) must not erase the stored excerpt.
  await postHits(env, [{ pattern: "约炮", handle: "SPAMBOT9" }]);
  const again = db
    .prepare("SELECT count, field, sample_text FROM rule_hit_stats WHERE handle='spambot9'")
    .get() as Record<string, unknown>;
  assert.equal(again.count, 2);
  assert.equal(again.sample_text, "同城约炮 看主页");

  // The admin drill-down surfaces the evidence.
  const accounts = await worker.fetch(
    new Request("https://edge.test/v1/admin/rule-hits/accounts?pattern=%E7%BA%A6%E7%82%AE", {
      headers: { "x-admin-token": ADMIN_TOKEN },
    }),
    env,
  );
  const list = ((await accounts.json()) as { list: Record<string, unknown>[] }).list;
  const row = list.find((r) => r.handle === "spambot9");
  assert.equal(row?.field, "display_name");
  assert.equal(row?.sample_text, "同城约炮 看主页");
});
