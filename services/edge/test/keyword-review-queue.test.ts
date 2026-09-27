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
  beforeBatch?: () => void;
  async batch(statements: ReturnType<Database["prepare"]>[]) {
    this.beforeBatch?.();
    this.beforeBatch = undefined;
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

const route = "/v1/admin/keyword-rules/apply-to-queue";
const unresolved = ["auto_pending_review", "agent_pending", "agent_blacklist", "agent_whitelist"];
async function fixture(action = "blacklist", pattern = "没人比我") {
  const db = new Database();
  await request(db, "/v1/admin/keyword-rules", {
    pattern,
    field: "tweet",
    action,
    verdict_label: "porn_bot",
  });
  return db;
}
function add(db: Database, handle: string, status: string, text = "没\u200d人\u2060比\u200c我") {
  db.add(handle, status);
  db.sqlite.prepare("UPDATE accounts SET evidence_text=? WHERE handle=?").run(text, handle);
}
for (const action of ["blacklist", "whitelist", "reject"])
  test(`all four review states obey ${action}, terminal states remain unchanged`, async () => {
    const db = await fixture(action);
    unresolved.forEach((s, i) => add(db, `queue_${i}`, s));
    const terminal = ["human_confirmed", "whitelisted", "rejected", "removed"];
    terminal.forEach((s, i) => add(db, `final_${i}`, s));
    const preview = await request(db, "/v1/admin/keyword-rules/preview", {
      pattern: "没人比我",
      field: "tweet",
    });
    assert.equal(preview.body.count, 4);
    const dry = await request(db, route, { dryRun: true });
    assert.equal(dry.body.wouldApply, 4);
    assert.equal(dry.body.matched, 0);
    assert.equal(db.sqlite.prepare("SELECT count(*) n FROM review_log").get()?.n, 0);
    const result = await request(db, route, {});
    assert.equal(result.body.matched, 4);
    assert.equal(result.body.complete, true);
    for (let i = 0; i < 4; i++) {
      const row = db.sqlite.prepare("SELECT * FROM accounts WHERE handle=?").get(`queue_${i}`);
      assert.equal(
        row?.status,
        action === "blacklist"
          ? "human_confirmed"
          : action === "whitelist"
            ? "whitelisted"
            : "rejected",
      );
      assert.match(String(row?.last_decided_by), /^rule:/);
      assert.equal(
        db.sqlite.prepare("SELECT status FROM accounts WHERE handle=?").get(`final_${i}`)?.status,
        terminal[i],
      );
    }
    assert.equal(db.sqlite.prepare("SELECT count(*) n FROM review_log").get()?.n, 4);
    assert.equal(db.sqlite.prepare("SELECT hit_count FROM keyword_rules").get()?.hit_count, 4);
    assert.equal((await request(db, route, {})).body.matched, 0);
  });
test("protected follower matches are explained, concurrent human decisions never counted or overwritten", async () => {
  const db = await fixture();
  add(db, "protected", "agent_pending");
  db.sqlite.exec("UPDATE accounts SET followers_count=100000 WHERE handle='protected'");
  add(db, "concurrent", "agent_blacklist");
  db.beforeBatch = () =>
    db.sqlite.exec("UPDATE accounts SET status='whitelisted' WHERE handle='concurrent'");
  const { body } = await request(db, route, {});
  assert.equal(body.textMatched, 2);
  assert.equal(body.skippedProtected, 1);
  assert.equal(body.skippedChanged, 1);
  assert.equal(body.matched, 0);
  assert.equal(
    db.sqlite.prepare("SELECT status FROM accounts WHERE handle='concurrent'").get()?.status,
    "whitelisted",
  );
  assert.equal(db.sqlite.prepare("SELECT count(*) n FROM review_log").get()?.n, 0);
  assert.equal(db.sqlite.prepare("SELECT hit_count FROM keyword_rules").get()?.hit_count, 0);
});
test("continuation reaches tail beyond surviving false positives across >90 rules without duplicates", async () => {
  const db = await fixture("blacklist", "visa");
  for (let i = 0; i < 95; i++)
    db.sqlite
      .prepare(
        "INSERT INTO keyword_rules(pattern,field,action,verdict_label,created_at) VALUES (?,'any','blacklist','spam',1)",
      )
      .run(`other${i}`);
  // First rows pass SQL substring filtering but fail the exact word boundary matcher.
  for (let i = 0; i < 507; i++)
    add(db, `candidate_${i}`, unresolved[i % 4], i === 506 ? "visa other94" : "visage");
  let cursor: unknown;
  let scanned = 0;
  let hits = 0;
  let complete = false;
  let rounds = 0;
  for (; rounds < 10; rounds++) {
    const { status, body } = await request(db, route, { dryRun: true, cursor });
    assert.equal(status, 200);
    scanned += body.scanned.queue;
    hits += body.wouldApply;
    if (body.complete) {
      complete = true;
      break;
    }
    assert.ok(body.nextCursor);
    cursor = body.nextCursor;
  }
  assert.ok(complete);
  assert.ok(rounds > 0);
  assert.equal(scanned, 507);
  assert.equal(hits, 1);
  assert.equal(db.sqlite.prepare("SELECT count(*) n FROM review_log").get()?.n, 0);
});
test("resuming after a rule change is rejected; invalid cursor never silently restarts", async () => {
  const db = await fixture();
  for (let i = 0; i < 201; i++) add(db, `row_${i}`, "agent_pending");
  const first = await request(db, route, { dryRun: true });
  assert.ok(first.body.nextCursor);
  await request(db, "/v1/admin/keyword-rules", {
    pattern: "新增规则",
    field: "any",
    action: "reject",
    verdict_label: "spam",
  });
  assert.equal(
    (await request(db, route, { dryRun: true, cursor: first.body.nextCursor })).status,
    409,
  );
  assert.equal((await request(db, route, { cursor: "bad" })).status, 400);
});
test("all scope rescans cleared accounts once and queues blacklist conflicts", async () => {
  const db = await fixture();
  add(db, "legit", "auto_legit");
  add(db, "unsure", "auto_unsure");
  assert.equal((await request(db, route, {})).body.matched, 0);
  const result = await request(db, route, { scope: "all" });
  assert.equal(result.body.matched, 2);
  assert.equal(result.body.legitMatched, 2);
  assert.equal(
    db.sqlite
      .prepare(
        "SELECT count(*) n FROM accounts WHERE status='auto_pending_review' AND published_at IS NULL",
      )
      .get()?.n,
    2,
  );
});
