import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import {
  AGENT_AUTO_BLACKLIST_BATCH_LIMIT,
  AGENT_AUTO_BLACKLIST_CONFIDENCE_FLOOR,
  agentAutoBlacklistEnabled,
  autoPublishAgentBlacklist,
} from "../src/agent-auto-publish";

const schemaSql = readFileSync(new URL("../schema.sql", import.meta.url), "utf8");
const agentMigration = readFileSync(
  new URL("../migrations/2026-05-27-agent-pipeline.sql", import.meta.url),
  "utf8",
);
const worker = (await import(new URL("../src/index.ts", import.meta.url).href)).default;
const NOW = 1_792_022_400_000;
const ADMIN_TOKEN = "agent-publish-test-admin";
const AGENT_TOKEN = "agent-publish-test-agent";

type BindValue = string | number | null;
type SqliteResult = {
  success: true;
  results: Record<string, unknown>[];
  meta: { changes: number; last_row_id: number };
};

class SqliteStatement {
  private args: BindValue[] = [];

  constructor(private readonly db: DatabaseSync, readonly sql: string) {}

  bind(...args: BindValue[]) {
    this.args = args;
    return this;
  }

  // Kept synchronous so a batch never yields while its transaction is open.
  execute(): SqliteResult {
    const statement = this.db.prepare(this.sql);
    if (statement.columns().length) {
      return {
        success: true,
        results: statement.all(...this.args) as Record<string, unknown>[],
        meta: { changes: 0, last_row_id: 0 },
      };
    }
    const result = statement.run(...this.args);
    return {
      success: true,
      results: [],
      meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) },
    };
  }

  async run() {
    return this.execute();
  }

  async all<T>() {
    return { success: true, results: this.execute().results as T[], meta: { changes: 0 } };
  }

  async first<T>(column?: string): Promise<T | null> {
    const row = this.db.prepare(this.sql).get(...this.args) as Record<string, unknown> | undefined;
    return (column ? row?.[column] : row) as T ?? null;
  }
}

class TransactionalD1 {
  readonly batches: number[] = [];
  readonly prepared: string[] = [];
  beforeBatch: (() => void) | undefined;

  constructor(readonly sqlite: DatabaseSync) {}

  prepare(sql: string) {
    this.prepared.push(sql);
    return new SqliteStatement(this.sqlite, sql);
  }

  async batch(statements: SqliteStatement[]) {
    this.batches.push(statements.length);
    const beforeBatch = this.beforeBatch;
    this.beforeBatch = undefined;
    beforeBatch?.();
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      // Do not replace with Promise.all or await individual statements: both
      // would allow another request into the same in-memory transaction.
      const results = statements.map((statement) => statement.execute());
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }
}

function fixture(t: { after(fn: () => void): void }, enabled: string | undefined = "1") {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(schemaSql);
  sqlite.exec(agentMigration);
  t.after(() => sqlite.close());
  const db = new TransactionalD1(sqlite);
  const env = {
    DB: db as unknown as D1Database,
    REPORT_SALT: "agent-auto-publish-test-salt",
    ADMIN_TOKEN,
    AGENT_TOKEN,
    ...(enabled === undefined ? {} : { AGENT_AUTO_BLACKLIST_ENABLED: enabled }),
  };
  let sequence = 0;
  function insert(overrides: Record<string, BindValue> = {}) {
    const serial = ++sequence;
    const row: Record<string, BindValue> = {
      x_user_id: String(100_000 + serial),
      handle: `candidate_${serial}`,
      verdict_label: "uncertain",
      confidence: 0.1,
      reasons: '["old classifier"]',
      model: "old-model",
      status: "agent_blacklist",
      source: "auto_scan",
      signals_hash: "snapshot-v1",
      evidence_text: "A public reply offering a paid service and contact link.",
      followers_count: 25,
      first_seen: NOW - 100,
      last_scored: NOW - 50,
      agent_id: "reviewer-test",
      agent_label: "spam",
      agent_confidence: 0.95,
      agent_reasons: '["P3 repeated commercial solicitation"]',
      agent_signals: '["P3"]',
      agent_action: "approve_block",
      agent_model: "agent-model",
      agent_at: NOW - 10,
      agent_signals_hash: "snapshot-v1",
      agent_error: null,
      last_decided_by: "agent:reviewer-test",
      ...overrides,
    };
    const columns = Object.keys(row);
    const result = sqlite.prepare(
      `INSERT INTO accounts (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`,
    ).run(...Object.values(row));
    return { id: Number(result.lastInsertRowid), x_user_id: row.x_user_id, handle: row.handle };
  }
  function account(id: number) {
    return sqlite.prepare("SELECT rowid AS id, * FROM accounts WHERE rowid=?").get(id) as Record<string, BindValue>;
  }
  function auditCount() {
    return Number((sqlite.prepare("SELECT count(*) AS n FROM review_log WHERE action='ai_blacklist'").get() as { n: number }).n);
  }
  return { sqlite, db, env, insert, account, auditCount };
}

function adminRequest(body: unknown, token: string | null = ADMIN_TOKEN) {
  return new Request("https://edge.test/v1/admin/agent-auto-publish", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token === null ? {} : { "x-admin-token": token }),
    },
    body: JSON.stringify(body),
  });
}

function decideRequest(row: { x_user_id: BindValue; handle: BindValue }, overrides: Record<string, unknown> = {}) {
  return new Request("https://edge.test/v1/agent/decide", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${AGENT_TOKEN}`,
      "x-agent-id": "reviewer-test",
    },
    body: JSON.stringify({
      x_user_id: row.x_user_id,
      handle: row.handle,
      decision: "blacklist",
      label: "spam",
      confidence: 0.95,
      reasons: ["P3 repeated commercial solicitation"],
      signals: ["P3"],
      action: "approve_block",
      model: "agent-model",
      signals_hash: "snapshot-v1",
      ...overrides,
    }),
  });
}

test("agent auto-publish is opt-in and its limits are explicit", async (t) => {
  assert.equal(AGENT_AUTO_BLACKLIST_CONFIDENCE_FLOOR, 0.90);
  assert.equal(AGENT_AUTO_BLACKLIST_BATCH_LIMIT, 100);
  assert.equal(agentAutoBlacklistEnabled({}), false);
  for (const value of [undefined, "0", "true", "yes", " 1 "]) {
    assert.equal(agentAutoBlacklistEnabled({ AGENT_AUTO_BLACKLIST_ENABLED: value }), false);
  }
  assert.equal(agentAutoBlacklistEnabled({ AGENT_AUTO_BLACKLIST_ENABLED: "1" }), true);
  const { env, db, insert, account, auditCount } = fixture(t);
  delete env.AGENT_AUTO_BLACKLIST_ENABLED;
  const row = insert();
  const disabled = await autoPublishAgentBlacklist(env, { now: NOW });
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.published, 0);
  assert.deepEqual(disabled.published_ids, []);
  assert.equal(db.batches.length, 0);
  assert.equal(db.prepared.length, 0);
  assert.equal(account(row.id).status, "agent_blacklist");
  assert.equal(auditCount(), 0);
  const preview = await autoPublishAgentBlacklist(env, { dryRun: true, now: NOW });
  assert.equal(preview.enabled, false);
  assert.equal(preview.eligible, 1);
  assert.equal(preview.published, 0);
  assert.equal(preview.dry_run, true);
  assert.equal(db.batches.length, 0);
});

test("publishes eligible rows with Agent annotations and a non-human audit source", async (t) => {
  const { env, sqlite, insert, account, auditCount } = fixture(t);
  const row = insert({ agent_label: "porn_bot", category: "marketing", source: "report" });
  const result = await autoPublishAgentBlacklist(env, { now: NOW });
  assert.equal(result.enabled, true);
  assert.equal(result.dry_run, false);
  assert.equal(result.eligible, 1);
  assert.equal(result.published, 1);
  assert.deepEqual(result.published_ids, [row.id]);
  assert.deepEqual(result.sample, [{ id: row.id, x_user_id: row.x_user_id, handle: row.handle }]);
  const published = account(row.id);
  assert.equal(published.status, "human_confirmed");
  assert.equal(published.published_tier, "ai");
  assert.equal(published.published_at, NOW);
  assert.equal(published.last_decided_by, "agent:reviewer-test");
  assert.equal(published.last_decided_at, NOW);
  assert.equal(published.verdict_label, "porn_bot");
  assert.equal(published.confidence, 0.95);
  assert.equal(published.reasons, '["P3 repeated commercial solicitation"]');
  assert.equal(published.model, "agent-model");
  assert.equal(published.source, "report");
  assert.equal(published.category, "porn");
  assert.equal(auditCount(), 1);
  const audit = sqlite.prepare("SELECT * FROM review_log WHERE action='ai_blacklist'").get() as Record<string, unknown>;
  assert.equal(audit.actor, "agent:reviewer-test");
  assert.equal(audit.x_user_id, row.x_user_id);
  assert.equal(audit.handle, row.handle);
  assert.equal(audit.at, NOW);
});

test("confidence floor, unknown followers, and hard signal membership govern eligibility", async (t) => {
  const { env, insert, account } = fixture(t);
  const accepted = [
    insert({ agent_confidence: 0.90 }),
    insert({ agent_confidence: 1 }),
    insert({ followers_count: null }),
    insert({ followers_count: 99_999 }),
    ...["P1", "P2", "P3", "P4", "P6"].map((code) => insert({ agent_signals: JSON.stringify([code]) })),
  ];
  const rejected = [
    insert({ agent_confidence: 0.89 }),
    insert({ agent_confidence: 1.01 }),
    insert({ agent_confidence: null }),
    insert({ followers_count: 100_000 }),
    insert({ followers_count: 100_001 }),
    ...["P5", "P7", "P8", "P999", "S1", "not-P1"].map((code) => insert({ agent_signals: JSON.stringify([code]) })),
    insert({ agent_signals: "[]" }),
    insert({ agent_signals: "null" }),
    insert({ agent_signals: '{"signal":"P1"}' }),
    insert({ agent_signals: '"P1"' }),
    insert({ agent_signals: "broken JSON" }),
  ];
  const result = await autoPublishAgentBlacklist(env, { now: NOW });
  assert.equal(result.published, accepted.length);
  assert.deepEqual(new Set(result.published_ids), new Set(accepted.map((row) => row.id)));
  for (const row of rejected) assert.equal(account(row.id).status, "agent_blacklist");
});

test("rejects stale snapshots, missing evidence, bad identities, and incomplete Agent decisions", async (t) => {
  const { env, insert, account, auditCount } = fixture(t);
  const rejected = [
    insert({ signals_hash: null, agent_signals_hash: null }),
    insert({ signals_hash: "", agent_signals_hash: "" }),
    insert({ agent_signals_hash: null }),
    insert({ agent_signals_hash: "snapshot-v0" }),
    insert({ agent_error: "analysis failed" }),
    insert({ evidence_text: null }),
    insert({ evidence_text: "" }),
    insert({ evidence_text: " \t\r\n\u00a0\u200b\u200c\u200d\u2060\ufeff" }),
    insert({ agent_evidence: '{"evidence_text":"A fabricated substitute is insufficient"}', evidence_text: "" }),
    insert({ handle: "bad-handle" }),
    insert({ handle: "long_handle_123456" }),
    insert({ handle: "@leading_at" }),
    insert({ x_user_id: "not_numeric" }),
    insert({ x_user_id: "1".repeat(33) }),
    insert({ agent_action: "needs_human" }),
    insert({ agent_action: "reject_legit" }),
    insert({ agent_label: "likely_spam" }),
    insert({ agent_label: "legit" }),
    insert({ agent_id: null }),
    insert({ agent_id: "" }),
  ];
  const result = await autoPublishAgentBlacklist(env, { now: NOW });
  assert.equal(result.eligible, 0);
  assert.equal(result.published, 0);
  assert.equal(auditCount(), 0);
  for (const row of rejected) assert.equal(account(row.id).status, "agent_blacklist");
});

test("terminal states and same normalized handle decisions block automatic promotion", async (t) => {
  const { env, insert, account, auditCount } = fixture(t);
  const rows: Array<{ id: number }> = [];
  for (const status of ["whitelisted", "human_confirmed", "rejected", "removed"]) {
    rows.push(insert({ status }));
    const candidate = insert();
    rows.push(candidate);
    insert({ handle: String(candidate.handle).toUpperCase(), status });
  }
  rows.push(insert({ status: "agent_pending" }));
  rows.push(insert({ status: "agent_whitelist" }));
  rows.push(insert({ status: "auto_pending_review" }));
  const before = rows.map((row) => account(row.id).status);
  const result = await autoPublishAgentBlacklist(env, { now: NOW });
  assert.equal(result.published, 0);
  assert.equal(auditCount(), 0);
  assert.deepEqual(rows.map((row) => account(row.id).status), before);
});

test("a legacy duplicate numeric identity cannot bypass another handle's terminal decision", async (t) => {
  const { env, sqlite, insert, account } = fixture(t);
  // Simulates legacy/corrupt duplicate rows predating the production UID index.
  sqlite.exec("DROP INDEX idx_accounts_uid_uq");
  const candidates = [];
  for (const status of ["whitelisted", "human_confirmed", "rejected", "removed"]) {
    const candidate = insert();
    candidates.push(candidate);
    insert({ x_user_id: candidate.x_user_id, status });
  }
  const result = await autoPublishAgentBlacklist(env, { now: NOW });
  assert.equal(result.published, 0);
  for (const row of candidates) assert.equal(account(row.id).status, "agent_blacklist");
});

test("identity-scoped promotion never touches another UID or handle-only row", async (t) => {
  const { env, insert, account } = fixture(t);
  const chosen = insert({ handle: "shared_handle" });
  const differentUid = insert({ handle: "shared_handle" });
  const handleOnly = insert({ handle: "shared_handle", x_user_id: null });
  const unrelated = insert();
  const result = await autoPublishAgentBlacklist(env, {
    identity: { handle: "shared_handle", xUserId: String(chosen.x_user_id) },
    now: NOW,
  });
  assert.deepEqual(result.published_ids, [chosen.id]);
  assert.equal(account(chosen.id).status, "human_confirmed");
  for (const row of [differentUid, handleOnly, unrelated]) assert.equal(account(row.id).status, "agent_blacklist");
});

test("handle-only identity scope stays separate from a numeric identity", async (t) => {
  const { env, insert, account } = fixture(t);
  const numeric = insert({ handle: "shared_handle" });
  const handleOnly = insert({ handle: "shared_handle", x_user_id: null });
  const result = await autoPublishAgentBlacklist(env, {
    identity: { handle: "shared_handle", xUserId: null },
    now: NOW,
  });
  assert.deepEqual(result.published_ids, [handleOnly.id]);
  assert.equal(account(numeric.id).status, "agent_blacklist");
  assert.equal(account(handleOnly.id).status, "human_confirmed");
});

test("spam preserves a known category and supplies other when missing", async (t) => {
  const { env, insert, account } = fixture(t);
  const categorized = insert({ category: "crypto" });
  const uncategorized = insert({ category: null });
  await autoPublishAgentBlacklist(env, { now: NOW });
  assert.equal(account(categorized.id).category, "crypto");
  assert.equal(account(uncategorized.id).category, "other");
});

test("dry run reports candidates without account changes or audits", async (t) => {
  const { env, db, insert, account, auditCount } = fixture(t);
  const row = insert();
  const before = account(row.id);
  const result = await autoPublishAgentBlacklist(env, { dryRun: true, now: NOW });
  assert.equal(result.eligible, 1);
  assert.equal(result.published, 0);
  assert.deepEqual(result.published_ids, []);
  assert.equal(db.batches.length, 0);
  assert.equal(auditCount(), 0);
  assert.deepEqual(account(row.id), before);
});

test("bounded backfill skips ineligible early rows and keeps batches below 100 SQL statements", async (t) => {
  const { env, db, insert, account, auditCount } = fixture(t);
  for (let i = 0; i < 101; i++) insert({ agent_confidence: 0.1 });
  const eligible = Array.from({ length: 101 }, () => insert());
  const result = await autoPublishAgentBlacklist(env, { now: NOW });
  assert.equal(result.eligible, 100);
  assert.equal(result.published, 100);
  assert.equal(result.published_ids.length, 100);
  assert.equal(auditCount(), 100);
  assert.ok(db.batches.length > 0);
  assert.ok(db.batches.every((size) => size > 0 && size <= 100));
  assert.equal(eligible.filter((row) => account(row.id).status === "agent_blacklist").length, 1);
});

test("candidate selection uses status and identity indexes for protected sibling checks", async (t) => {
  const { env, sqlite, db, insert } = fixture(t);
  insert();
  await autoPublishAgentBlacklist(env, { dryRun: true, now: NOW });
  const candidateSql = db.prepared.find((sql) => sql.includes("SELECT a.rowid AS id"));
  assert.ok(candidateSql);
  const plan = sqlite.prepare(`EXPLAIN QUERY PLAN ${candidateSql}`).all(100) as Array<{ detail: string }>;
  const details = plan.map((row) => row.detail).join("\n");
  assert.match(details, /SEARCH a USING INDEX idx_accounts_status/);
  assert.match(details, /SEARCH protected USING INDEX idx_accounts_handle_norm/);
  assert.match(details, /SEARCH protected USING INDEX idx_accounts_uid/);
});

test("new Agent decisions look up their identity without scanning the staging partition", async (t) => {
  for (const xUserId of ["987654321", null]) {
    const { env, sqlite, db, insert } = fixture(t);
    for (let i = 0; i < 100; i++) insert({ agent_signals_hash: "stale" });
    insert({ handle: "target_lookup", x_user_id: xUserId });
    const result = await autoPublishAgentBlacklist(env, {
      dryRun: true, identity: { handle: "target_lookup", xUserId }, now: NOW,
    });
    assert.equal(result.eligible, 1);
    const candidateSql = db.prepared.find((sql) => sql.includes("SELECT a.rowid AS id"));
    assert.ok(candidateSql);
    const plan = sqlite.prepare(`EXPLAIN QUERY PLAN ${candidateSql}`)
      .all("target_lookup", xUserId, 100) as Array<{ detail: string }>;
    const details = plan.map((row) => row.detail).join("\n");
    const expected = xUserId === null ? "idx_accounts_handle_norm" : "idx_accounts_uid";
    assert.ok(details.includes(`SEARCH a USING INDEX ${expected}`), details);
    assert.doesNotMatch(details, /SEARCH a USING INDEX idx_accounts_status/);
  }
});

test("overlapping backfills and retries produce one atomic promotion and audit", async (t) => {
  const { env, insert, account, auditCount } = fixture(t);
  const row = insert();
  const results = await Promise.all([
    autoPublishAgentBlacklist(env, { now: NOW }),
    autoPublishAgentBlacklist(env, { now: NOW }),
  ]);
  assert.equal(results.reduce((sum, result) => sum + result.published, 0), 1);
  assert.equal(account(row.id).status, "human_confirmed");
  assert.equal(auditCount(), 1);
  const retried = await autoPublishAgentBlacklist(env, { now: NOW + 1 });
  assert.equal(retried.published, 0);
  assert.equal(auditCount(), 1);
  assert.equal(account(row.id).published_at, NOW);
});

test("snapshot changes between selection and transaction prevent publication and audit", async (t) => {
  const { env, sqlite, db, insert, account, auditCount } = fixture(t);
  const row = insert();
  db.beforeBatch = () => {
    sqlite.prepare("UPDATE accounts SET signals_hash='snapshot-v2' WHERE rowid=?").run(row.id);
  };
  const result = await autoPublishAgentBlacklist(env, { now: NOW });
  assert.equal(result.published, 0);
  assert.deepEqual(result.published_ids, []);
  assert.equal(account(row.id).status, "agent_blacklist");
  assert.equal(auditCount(), 0);
});

test("identity or Agent snapshot changes after candidate selection lose the promotion race", async (t) => {
  for (const mutation of [
    "handle='renamed_user'",
    "x_user_id='999999999'",
    "agent_at=agent_at+1",
    "agent_id='second-reviewer'",
  ]) {
    const { env, sqlite, db, insert, account, auditCount } = fixture(t);
    const row = insert();
    db.beforeBatch = () => {
      sqlite.prepare(`UPDATE accounts SET ${mutation} WHERE rowid=?`).run(row.id);
    };
    const result = await autoPublishAgentBlacklist(env, { now: NOW });
    assert.equal(result.published, 0, mutation);
    assert.equal(account(row.id).status, "agent_blacklist", mutation);
    assert.equal(auditCount(), 0, mutation);
  }
});

test("a concurrent human decision is rechecked within the transaction", async (t) => {
  const { env, sqlite, db, insert, account, auditCount } = fixture(t);
  const row = insert();
  db.beforeBatch = () => {
    sqlite.prepare("UPDATE accounts SET status='whitelisted', last_decided_by='human:test' WHERE rowid=?").run(row.id);
  };
  const result = await autoPublishAgentBlacklist(env, { now: NOW });
  assert.equal(result.published, 0);
  assert.equal(account(row.id).status, "whitelisted");
  assert.equal(account(row.id).last_decided_by, "human:test");
  assert.equal(auditCount(), 0);
});

test("a sibling whitelist added after candidate selection is also rechecked atomically", async (t) => {
  const { env, db, insert, account, auditCount } = fixture(t);
  const row = insert();
  db.beforeBatch = () => {
    insert({ handle: String(row.handle).toUpperCase(), status: "whitelisted" });
  };
  const result = await autoPublishAgentBlacklist(env, { now: NOW });
  assert.equal(result.published, 0);
  assert.equal(account(row.id).status, "agent_blacklist");
  assert.equal(auditCount(), 0);
});

test("a failing account update rolls back the preceding audit insert", async (t) => {
  const { env, sqlite, insert, account, auditCount } = fixture(t);
  const row = insert();
  sqlite.exec(`CREATE TRIGGER fail_agent_promotion BEFORE UPDATE ON accounts
    WHEN NEW.status='human_confirmed'
    BEGIN SELECT RAISE(ABORT, 'injected update failure'); END;`);
  await assert.rejects(autoPublishAgentBlacklist(env, { now: NOW }), /injected update failure/);
  assert.equal(account(row.id).status, "agent_blacklist");
  assert.equal(auditCount(), 0);
  sqlite.exec("DROP TRIGGER fail_agent_promotion");
  assert.equal((await autoPublishAgentBlacklist(env, { now: NOW })).published, 1);
  assert.equal(auditCount(), 1);
});

test("agent decide publishes only the newly staged identity and returns its actual status", async (t) => {
  const { env, insert, account, auditCount, sqlite } = fixture(t);
  const fresh = insert({ status: "auto_pending_review", agent_id: null });
  const historical = insert();
  const response = await worker.fetch(decideRequest(fresh), env);
  const result = await response.json() as { status: string; auto_published: boolean };
  assert.equal(response.status, 200);
  assert.equal(result.status, "human_confirmed");
  assert.equal(result.auto_published, true);
  assert.equal(account(fresh.id).status, "human_confirmed");
  assert.equal(account(historical.id).status, "agent_blacklist");
  assert.equal(auditCount(), 1);
  const logs = sqlite.prepare("SELECT action, actor FROM review_log ORDER BY id").all() as Array<{ action: string; actor: string }>;
  assert.deepEqual(logs.map((log) => log.action), ["agent_blacklist", "ai_blacklist"]);
  assert.ok(logs.every((log) => log.actor === "agent:reviewer-test"));
  const stale = await worker.fetch(decideRequest(fresh), env);
  assert.equal(stale.status, 409);
  assert.equal((await stale.json() as { error: string }).error, "stale_agent_decision");
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM review_log").get()?.n, 2);
});

test("a failed final status read reports 503 without inventing status after a committed promotion", async (t) => {
  const { env, db, sqlite, insert, account, auditCount } = fixture(t);
  const row = insert({ status: "auto_pending_review", agent_id: null });
  const prepare = db.prepare.bind(db);
  let failedReads = 0;
  db.prepare = (sql: string) => {
    const statement = prepare(sql);
    if (sql === "SELECT status FROM accounts WHERE lower(handle)=? AND x_user_id IS ?") {
      statement.first = async () => {
        failedReads++;
        throw new Error("injected final status read failure");
      };
    }
    return statement;
  };
  const response = await worker.fetch(decideRequest(row), env);
  const result = await response.json() as Record<string, unknown>;
  assert.equal(response.status, 503);
  assert.equal(result.error, "agent_auto_publish_failed");
  assert.equal(Object.hasOwn(result, "status"), false);
  assert.equal(failedReads, 1);
  assert.equal(account(row.id).status, "human_confirmed");
  assert.equal(account(row.id).published_tier, "ai");
  assert.equal(auditCount(), 1);
  const retry = await worker.fetch(decideRequest(row), env);
  assert.equal(retry.status, 409);
  assert.equal((await retry.json() as { error: string }).error, "stale_agent_decision");
  assert.equal(failedReads, 1);
  assert.equal(auditCount(), 1);
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM review_log").get()?.n, 2);
});

test("agent decide keeps staging when disabled or below the publication floor", async (t) => {
  const disabled = fixture(t, "0");
  const disabledRow = disabled.insert({ status: "auto_pending_review" });
  const disabledResponse = await worker.fetch(decideRequest(disabledRow), disabled.env);
  assert.equal(disabledResponse.status, 200);
  const disabledResult = await disabledResponse.json() as { status: string; auto_published: boolean };
  assert.equal(disabledResult.status, "agent_blacklist");
  assert.equal(disabledResult.auto_published, false);
  assert.equal(disabled.auditCount(), 0);
  const enabled = fixture(t);
  const lowConfidence = enabled.insert({ status: "auto_pending_review" });
  const response = await worker.fetch(decideRequest(lowConfidence, { confidence: 0.89 }), enabled.env);
  assert.equal(response.status, 200);
  const result = await response.json() as { status: string; auto_published: boolean };
  assert.equal(result.status, "agent_blacklist");
  assert.equal(result.auto_published, false);
  assert.equal(enabled.account(lowConfidence.id).status, "agent_blacklist");
});

test("agent decide rejects stale hash and cannot modify an existing human decision", async (t) => {
  const { env, sqlite, insert, account } = fixture(t);
  const changed = insert({ status: "auto_pending_review", signals_hash: "snapshot-v2" });
  const human = insert({ status: "human_confirmed", published_tier: "human" });
  for (const row of [changed, human]) {
    const before = account(row.id);
    const response = await worker.fetch(decideRequest(row), env);
    assert.equal(response.status, 409);
    assert.deepEqual(account(row.id), before);
  }
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM review_log").get()?.n, 0);
});

test("admin backfill requires admin auth and defaults to dry run", async (t) => {
  const { env, insert, account, auditCount } = fixture(t);
  const row = insert();
  for (const token of [null, "wrong-token", AGENT_TOKEN]) {
    const response = await worker.fetch(adminRequest({}, token), env);
    assert.equal(response.status, 403);
  }
  const response = await worker.fetch(adminRequest({}), env);
  assert.equal(response.status, 200);
  const result = await response.json() as { enabled: boolean; dry_run: boolean; eligible: number; published: number };
  assert.equal(result.enabled, true);
  assert.equal(result.dry_run, true);
  assert.equal(result.eligible, 1);
  assert.equal(result.published, 0);
  assert.equal(account(row.id).status, "agent_blacklist");
  assert.equal(auditCount(), 0);
});

test("admin backfill applies a requested bounded batch and respects the disabled gate", async (t) => {
  const { env, insert, account, auditCount } = fixture(t);
  const first = insert();
  const second = insert();
  const response = await worker.fetch(adminRequest({ dry_run: false, limit: 1 }), env);
  assert.equal(response.status, 200);
  const result = await response.json() as { dry_run: boolean; published: number; published_ids: number[] };
  assert.equal(result.dry_run, false);
  assert.equal(result.published, 1);
  assert.equal(result.published_ids.length, 1);
  assert.equal([first, second].filter((row) => account(row.id).status === "human_confirmed").length, 1);
  assert.equal(auditCount(), 1);
  const disabled = fixture(t, "0");
  const row = disabled.insert();
  const denied = await worker.fetch(adminRequest({ dry_run: false }), disabled.env);
  assert.equal(denied.status, 200);
  const deniedResult = await denied.json() as { enabled: boolean; published: number };
  assert.equal(deniedResult.enabled, false);
  assert.equal(deniedResult.published, 0);
  assert.equal(disabled.account(row.id).status, "agent_blacklist");
});

test("admin backfill rejects invalid limits instead of silently expanding or clamping", async (t) => {
  const { env, insert, auditCount } = fixture(t);
  insert();
  for (const limit of [0, -1, 101, 1.5, "100", null]) {
    const response = await worker.fetch(adminRequest({ dry_run: false, limit }), env);
    assert.equal(response.status, 400, `limit=${JSON.stringify(limit)}`);
  }
  assert.equal(auditCount(), 0);
});

test("the ten-minute job publishes newly promoted rows in the same artifact generation", async (t) => {
  const { env, sqlite, insert, account } = fixture(t);
  const row = insert();
  const objects = new Map<string, string>();
  const pending: Promise<unknown>[] = [];
  let listed = 0;
  worker.scheduled({ cron: "*/10 * * * *" }, {
    ...env,
    ARTIFACTS: {
      async put(key: string, value: string) {
        assert.equal(account(row.id).status, "human_confirmed", "promotion must precede the first artifact write");
        objects.set(key, value);
      },
      async list() {
        assert.equal(++listed, 1, "single-page fixture must need one bounded listing");
        return { objects: [...objects.keys()].map((key) => ({ key })), truncated: false };
      },
      async delete() {
        assert.fail("new live artifacts must not be pruned");
      },
    },
  }, {
    waitUntil(promise: Promise<unknown>) { pending.push(promise); },
  });
  await Promise.all(pending);
  assert.equal(account(row.id).status, "human_confirmed");
  assert.equal(objects.size, 4);
  const publication = sqlite.prepare("SELECT * FROM publications").get() as { count: number; lite_key: string; json_key: string };
  assert.equal(publication.count, 1);
  const lite = JSON.parse(objects.get(publication.lite_key)!) as { entries: string[][] };
  assert.equal(lite.entries.length, 1);
  assert.equal(lite.entries[0][0], row.x_user_id);
  assert.ok(lite.entries[0][2].endsWith("a"));
  const shards = JSON.parse(objects.get(publication.json_key)!) as { entries: Record<string, { tier: string }> };
  assert.equal(shards.entries[String(row.x_user_id)].tier, "auto");
});

test("public mirror includes automatic entries as auto while membership checks remain human-only", async (t) => {
  const { env, insert } = fixture(t);
  const automatic = insert();
  const human = insert({ status: "human_confirmed", published_tier: "human", published_at: NOW });
  assert.equal((await autoPublishAgentBlacklist(env, { now: NOW })).published, 1);
  const originalFetch = globalThis.fetch;
  const originalCaches = Object.getOwnPropertyDescriptor(globalThis, "caches");
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalCaches) Object.defineProperty(globalThis, "caches", originalCaches);
    else Reflect.deleteProperty(globalThis, "caches");
  });
  const payloads = new Map<string, Record<string, unknown>>();
  let calls = 0;
  globalThis.fetch = async (input, init) => {
    assert.ok(++calls <= 8, "mirror must stay within the expected eight mocked API calls");
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    assert.equal(url.hostname, "api.github.com");
    if (url.pathname === "/repos/test-owner/test-repo") return Response.json({ default_branch: "main" });
    if (url.pathname.endsWith("/git/ref/heads/curated-data")) return Response.json({ ref: "refs/heads/curated-data" });
    assert.ok(url.pathname.includes("/contents/data/"));
    if ((init?.method ?? "GET") === "GET") return new Response("missing", { status: 404 });
    const body = JSON.parse(String(init?.body)) as { branch: string; content: string };
    assert.equal(body.branch, "curated-data");
    const path = url.pathname.split("/contents/")[1];
    payloads.set(path, JSON.parse(Buffer.from(body.content, "base64").toString("utf8")));
    return Response.json({ content: {}, commit: {} }, { status: 201 });
  };
  const response = await worker.fetch(new Request("https://edge.test/v1/admin/sync-mirror", {
    method: "POST", headers: { "x-admin-token": ADMIN_TOKEN },
  }), {
    ...env,
    WHITELIST_SYNC_TOKEN: "mock-github-token",
    WHITELIST_SYNC_REPO: "test-owner/test-repo",
    WHITELIST_SYNC_BRANCH: "curated-data",
  });
  assert.equal(response.status, 200);
  const blacklist = payloads.get("data/blacklist/v1.json") as { list: Array<Record<string, unknown>> };
  assert.ok(blacklist);
  assert.equal(blacklist.list.find((row) => row.x_user_id === automatic.x_user_id)?.published_tier, "auto");
  assert.equal(blacklist.list.find((row) => row.x_user_id === human.x_user_id)?.published_tier, "human");
  const lite = payloads.get("data/blacklist/v2-lite.json") as { entries: string[][] };
  assert.ok(lite);
  assert.ok(lite.entries.find((entry) => entry[0] === automatic.x_user_id)?.[2].endsWith("a"));
  Object.defineProperty(globalThis, "caches", {
    configurable: true,
    value: { default: { match: async () => undefined, put: async () => undefined } },
  });
  const pending: Promise<unknown>[] = [];
  const check = await worker.fetch(new Request(`https://edge.test/v1/check?ids=${automatic.x_user_id},${human.x_user_id}`), env, {
    waitUntil(promise: Promise<unknown>) { pending.push(promise); },
    passThroughOnException() {},
  });
  assert.equal(check.status, 200);
  const checked = await check.json() as { hits: Record<string, unknown> };
  assert.equal(checked.hits[String(automatic.x_user_id)], undefined);
  assert.ok(checked.hits[String(human.x_user_id)]);
  await Promise.all(pending);
});
