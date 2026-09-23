import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import worker from "../src/index.ts";

// Execute the actual route SQL against SQLite; mocks cannot detect a missing
// queue status, mis-bound filters or stale writes to an already settled row.
class Database {
  sqlite = new DatabaseSync(":memory:");
  constructor() {
    this.sqlite.exec(readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
    this.sqlite.exec(
      readFileSync(new URL("../migrations/2026-05-27-agent-pipeline.sql", import.meta.url), "utf8"),
    );
  }
  prepare(sql: string) {
    const statement = this.sqlite.prepare(sql);
    let args: any[] = [];
    const result = {
      bind: (...values: any[]) => {
        args = values;
        return result;
      },
      first: async () => statement.get(...args) ?? null,
      all: async () => ({ results: statement.all(...args) }),
      run: async () => ({ meta: { changes: Number(statement.run(...args).changes) } }),
    };
    return result;
  }
  async batch(statements: ReturnType<Database["prepare"]>[]) {
    this.sqlite.exec("BEGIN");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }
  add(handle: string, status: string, uid: string | null = null) {
    this.sqlite
      .prepare(`INSERT INTO accounts
      (handle,x_user_id,status,verdict_label,confidence,first_seen,last_scored,source,followers_count,
       evidence_text,agent_label,agent_confidence,agent_reasons,agent_at,signals_hash)
      VALUES (?,?,?,'spam',0.9,1,100,'report',10,'fixture promotion', 'uncertain',0.4,'["insufficient hard evidence"]',50,'fixture')`)
      .run(handle, uid, status);
  }
}
const headers = { "x-admin-token": "fixture", "content-type": "application/json" };
async function request(db: Database, path: string, body?: object) {
  const response = await worker.fetch(
    new Request(`https://test.local${path}`, {
      method: body ? "POST" : "GET",
      headers,
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
    { DB: db, ADMIN_TOKEN: "fixture", AGENT_TOKEN: "fixture" } as any,
  );
  return { status: response.status, body: (await response.json()) as any };
}
function fixture() {
  const db = new Database();
  for (const [h, s, u] of [
    ["fresh", "auto_pending_review", "1"],
    ["pending", "agent_pending", "2"],
    ["block", "agent_blacklist", "3"],
    ["allow", "agent_whitelist", "4"],
    ["public", "human_confirmed", "5"],
    ["safe", "whitelisted", "6"],
    ["closed", "rejected", "7"],
    ["removed", "removed", "8"],
  ])
    db.add(h, s, u);
  return db;
}

test("all unresolved statuses share the queue, totals, filters and pagination", async () => {
  const db = fixture();
  db.add("PENDING", "agent_pending");
  const all = await request(db, "/v1/admin/queue?total=1&limit=2");
  assert.equal(all.status, 200);
  assert.equal(all.body.total, 4);
  assert.equal(all.body.queue.length, 2);
  assert.ok(all.body.queue.every((a: any) => a.status && a.agent_reasons));
  const page2 = await request(db, "/v1/admin/queue?total=1&limit=2&offset=2");
  assert.equal(
    new Set([...all.body.queue, ...page2.body.queue].map((a: any) => a.handle.toLowerCase())).size,
    4,
  );
  assert.equal((await request(db, "/v1/admin/stats")).body.queue, 4);
  for (const [stage, count] of [
    ["unreviewed", 1],
    ["reviewed", 3],
    ["pending", 1],
    ["blacklist", 1],
    ["whitelist", 1],
  ] as const) {
    const list = await request(
      db,
      `/v1/admin/queue?total=1&review_stage=${stage}&source=report&followers_max=20&evidence=promotion`,
    );
    const dry = await request(db, "/v1/admin/decide-by-filter", {
      action: "reject",
      scope: "queue",
      dryRun: true,
      filters: {
        review_stage: stage,
        source: "report",
        followers_max: "20",
        evidence: "promotion",
      },
    });
    assert.equal(list.body.total, count, stage);
    assert.equal(dry.body.matched, count, stage);
    assert.equal(db.sqlite.prepare("SELECT count(*) n FROM review_log").get()!.n, 0);
  }
});

test("Agent reviewing an account does not reduce unresolved total or publish it", async () => {
  const db = fixture();
  const response = await worker.fetch(
    new Request("https://test.local/v1/agent/decide", {
      method: "POST",
      headers: {
        authorization: "Bearer fixture",
        "x-agent-id": "fixture",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        handle: "fresh",
        x_user_id: "1",
        decision: "pending",
        label: "uncertain",
        confidence: 0.4,
        action: "needs_human",
        signals_hash: "fixture",
      }),
    }),
    { DB: db, AGENT_TOKEN: "fixture" } as any,
  );
  assert.equal(response.status, 200);
  const stats = (await request(db, "/v1/admin/stats")).body;
  assert.equal(stats.queue, 4);
  assert.equal(stats.agent_pending, 2);
  assert.equal(stats.blacklist, 1);
});

test("filter batch resolves only the selected AI stage and records human provenance", async () => {
  const db = fixture();
  const result = await request(db, "/v1/admin/decide-by-filter", {
    action: "approve",
    scope: "queue",
    category: "porn",
    filters: { review_stage: "blacklist" },
  });
  assert.equal(result.body.processed, 1);
  const row = db.sqlite.prepare("SELECT * FROM accounts WHERE handle='block'").get()!;
  assert.equal(row.status, "human_confirmed");
  assert.equal(row.published_tier, "human");
  assert.equal(row.category, "porn");
  assert.equal(row.last_decided_by, "human:admin");
  assert.equal(row.agent_label, "uncertain");
  assert.equal((await request(db, "/v1/admin/stats")).body.queue, 3);
  assert.equal(db.sqlite.prepare("SELECT count(*) n FROM review_log").get()!.n, 1);
});

test("mixed selection handles all stages but skips already settled accounts without audit claims", async () => {
  const db = fixture();
  const result = await request(db, "/v1/admin/decide-batch", {
    scope: "queue",
    action: "reject",
    items: [
      { handle: "fresh", xUserId: "1" },
      { handle: "pending", xUserId: "2" },
      { handle: "block", xUserId: "3" },
      { handle: "allow", xUserId: "4" },
      { handle: "public", xUserId: "5" },
      { handle: "safe", xUserId: "6" },
    ],
  });
  assert.equal(result.body.processed, 4);
  assert.equal(result.body.skipped, 2);
  assert.equal(
    db.sqlite.prepare("SELECT status FROM accounts WHERE handle='public'").get()!.status,
    "human_confirmed",
  );
  assert.equal(
    db.sqlite.prepare("SELECT status FROM accounts WHERE handle='safe'").get()!.status,
    "whitelisted",
  );
  assert.equal(db.sqlite.prepare("SELECT count(*) n FROM review_log").get()!.n, 4);
  assert.equal((await request(db, "/v1/admin/stats")).body.queue, 0);
});

test("AI whitelist is a suggestion until explicit action; single review cleans pending siblings", async () => {
  const db = fixture();
  db.add("ALLOW", "agent_pending");
  assert.equal((await request(db, "/v1/admin/stats")).body.whitelist, 1);
  const result = await request(db, "/v1/admin/decide", {
    scope: "queue",
    action: "whitelist",
    handle: "allow",
    xUserId: "4",
  });
  assert.equal(result.body.processed, 1);
  assert.equal((await request(db, "/v1/admin/stats")).body.whitelist, 2);
  assert.equal((await request(db, "/v1/admin/queue?total=1&handle=allow")).body.total, 0);
  assert.equal(
    (
      await request(db, "/v1/admin/decide", {
        scope: "queue",
        action: "approve",
        handle: "allow",
        xUserId: "4",
      })
    ).body.processed,
    0,
  );
});

test("invalid stage fails closed for both list and bulk mutation", async () => {
  const db = fixture();
  assert.equal((await request(db, "/v1/admin/queue?review_stage=typo")).status, 400);
  assert.equal(
    (
      await request(db, "/v1/admin/decide-by-filter", {
        action: "reject",
        filters: { review_stage: "typo" },
      })
    ).status,
    400,
  );
  assert.equal((await request(db, "/v1/admin/stats")).body.queue, 4);
});

test("filter batch reaches unloaded pages and preserves the hard 2000 cap", async () => {
  const db = new Database();
  for (let i = 0; i < 2001; i++) db.add(`fixture_${i}`, "agent_pending", String(i + 100));
  const first = await request(db, "/v1/admin/queue?total=1&review_stage=pending&limit=100");
  assert.equal(first.body.total, 2001);
  assert.equal(first.body.queue.length, 100);
  const result = await request(db, "/v1/admin/decide-by-filter", {
    action: "reject",
    filters: { review_stage: "pending" },
  });
  assert.equal(result.body.processed, 2000);
  assert.equal(result.body.truncated, true);
  assert.equal((await request(db, "/v1/admin/queue?total=1&review_stage=pending")).body.total, 1);
});

test("re-review clears AI annotations but retains unresolved total and skips settled records", async () => {
  const db = fixture();
  const result = await request(db, "/v1/admin/decide-batch", { scope: "queue", action: "requeue", items: [
    { handle: "pending", xUserId: "2" }, { handle: "public", xUserId: "5" }, { handle: "fresh", xUserId: "1" },
  ] });
  assert.equal(result.body.processed, 1);
  assert.equal(result.body.skipped, 2);
  const row = db.sqlite.prepare("SELECT * FROM accounts WHERE handle='pending'").get()!;
  assert.equal(row.status, "auto_pending_review");
  assert.equal(row.agent_label, null);
  assert.equal(row.agent_at, null);
  assert.equal((await request(db, "/v1/admin/stats")).body.queue, 4);
  assert.equal((await request(db, "/v1/admin/decide", { action: "requeue", handle: "public", xUserId: "5" })).status, 400);
});
