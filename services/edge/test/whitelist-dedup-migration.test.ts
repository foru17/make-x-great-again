import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

const migrationsDir = join(import.meta.dirname, "..", "migrations");
const forwardSql = readFileSync(join(migrationsDir, "2026-08-02-list-identity-dedup.sql"), "utf8");
const rollbackSql = readFileSync(
  join(migrationsDir, "2026-08-02-list-identity-dedup.rollback.sql"),
  "utf8",
);

interface SeedAccount {
  uid: string | null;
  handle: string;
  status: string;
  source: string;
  lastScored: number;
  publishedAt: number | null;
}

const seeds: SeedAccount[] = [
  {
    uid: "900",
    handle: "direct_add",
    status: "whitelisted",
    source: "admin_whitelist",
    lastScored: 100,
    publishedAt: null,
  },
  {
    uid: "800",
    handle: "direct_add",
    status: "whitelisted",
    source: "admin_whitelist",
    lastScored: 100,
    publishedAt: null,
  },
  {
    uid: null,
    handle: "direct_add",
    status: "whitelisted",
    source: "admin_whitelist",
    lastScored: 100,
    publishedAt: null,
  },
  {
    uid: "710",
    handle: "mixed_black",
    status: "human_confirmed",
    source: "report",
    lastScored: 90,
    publishedAt: 90,
  },
  {
    uid: null,
    handle: "mixed_black",
    status: "human_confirmed",
    source: "report",
    lastScored: 80,
    publishedAt: 80,
  },
  {
    uid: null,
    handle: "null_black",
    status: "human_confirmed",
    source: "report",
    lastScored: 70,
    publishedAt: 70,
  },
  {
    uid: null,
    handle: "null_black",
    status: "human_confirmed",
    source: "report",
    lastScored: 60,
    publishedAt: 60,
  },
  {
    uid: null,
    handle: "null_white",
    status: "whitelisted",
    source: "admin_whitelist",
    lastScored: 50,
    publishedAt: null,
  },
  {
    uid: null,
    handle: "null_white",
    status: "auto_pending_review",
    source: "auto_scan",
    lastScored: 40,
    publishedAt: null,
  },
  {
    uid: "301",
    handle: "shared_history",
    status: "whitelisted",
    source: "auto_keyword",
    lastScored: 30,
    publishedAt: null,
  },
  {
    uid: "302",
    handle: "shared_history",
    status: "whitelisted",
    source: "auto_keyword",
    lastScored: 20,
    publishedAt: null,
  },
];

function setup(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE accounts (
      x_user_id TEXT,
      handle TEXT,
      status TEXT NOT NULL,
      source TEXT NOT NULL,
      last_scored INTEGER NOT NULL,
      published_at INTEGER,
      PRIMARY KEY (x_user_id, handle)
    );
    CREATE TABLE review_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      x_user_id TEXT,
      handle TEXT,
      action TEXT NOT NULL,
      actor TEXT NOT NULL,
      note TEXT,
      at INTEGER NOT NULL
    );
  `);
  const insert = db.prepare(
    "INSERT INTO accounts (x_user_id,handle,status,source,last_scored,published_at) VALUES (?,?,?,?,?,?)",
  );
  for (const seed of seeds) {
    insert.run(seed.uid, seed.handle, seed.status, seed.source, seed.lastScored, seed.publishedAt);
  }
  db.prepare(
    "INSERT INTO review_log (x_user_id,handle,action,actor,note,at) VALUES (?,?,?,?,?,?)",
  ).run("900", "direct_add", "whitelist_add", "admin", "panel", 100);
  return db;
}

function activeCount(db: DatabaseSync, handle: string, status?: string): number {
  const sql = status
    ? "SELECT count(*) AS n FROM accounts WHERE lower(handle)=lower(?) AND status=?"
    : "SELECT count(*) AS n FROM accounts WHERE lower(handle)=lower(?) AND status<>'removed'";
  const row = (status ? db.prepare(sql).get(handle, status) : db.prepare(sql).get(handle)) as {
    n: number;
  };
  return row.n;
}

test("list identity migration removes only proven duplicates and rolls back exactly", () => {
  const db = setup();
  const before = db
    .prepare("SELECT rowid, status, source, published_at FROM accounts ORDER BY rowid")
    .all();

  db.exec(forwardSql);

  assert.equal(activeCount(db, "direct_add", "whitelisted"), 1);
  assert.equal(
    (
      db
        .prepare(
          "SELECT x_user_id FROM accounts WHERE handle='direct_add' AND status='whitelisted'",
        )
        .get() as { x_user_id: string }
    ).x_user_id,
    "900",
  );
  assert.equal(activeCount(db, "mixed_black", "human_confirmed"), 1);
  assert.equal(activeCount(db, "null_black", "human_confirmed"), 1);
  assert.equal(activeCount(db, "null_white", "whitelisted"), 1);
  assert.equal(activeCount(db, "shared_history", "whitelisted"), 2);

  const auditCount = (
    db.prepare("SELECT count(*) AS n FROM review_log WHERE actor='migration:2026-08-02'").get() as {
      n: number;
    }
  ).n;
  assert.equal(auditCount, 5);
  assert.ok(
    db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_accounts_active_null_handle_uq'",
      )
      .get(),
  );
  assert.throws(() => {
    db.prepare(
      "INSERT INTO accounts (x_user_id,handle,status,source,last_scored) VALUES (NULL,'null_black','human_confirmed','report',100)",
    ).run();
  }, /UNIQUE constraint failed/);

  db.exec(forwardSql);
  const rerunAuditCount = (
    db.prepare("SELECT count(*) AS n FROM review_log WHERE actor='migration:2026-08-02'").get() as {
      n: number;
    }
  ).n;
  assert.equal(rerunAuditCount, auditCount);

  db.exec(rollbackSql);
  const afterRollback = db
    .prepare("SELECT rowid, status, source, published_at FROM accounts ORDER BY rowid")
    .all();
  assert.deepEqual(afterRollback, before);
  assert.equal(
    db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_accounts_active_null_handle_uq'",
      )
      .get(),
    undefined,
  );
});
