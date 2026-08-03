// apply-to-queue scope coverage (2026-07-27): the sweep can optionally rescan
// auto_legit rows (scope:'all'). A legit row hit by a blacklist rule is parked
// back in the review queue — never published straight from a rescan — while
// queue rows keep the existing direct-action behavior.
import assert from "node:assert/strict";
import { test } from "node:test";

const edgeModuleUrl = new URL("../src/index.ts", import.meta.url).href;
const worker = (await import(edgeModuleUrl)).default as {
  fetch(req: Request, env: Record<string, unknown>): Promise<Response>;
};

interface SweepRow {
  rowid: number;
  x_user_id: string | null;
  handle: string;
  display_name: string | null;
  evidence_text: string | null;
  reasons: string | null;
  status: string;
  followers_count: number | null;
}

const RULES = [
  {
    id: 7,
    pattern: "免费推广",
    field: "any",
    action: "blacklist",
    verdict_label: "spam",
    category: null,
    enabled: 1,
    note: null,
    created_at: 1,
    hit_count: 0,
    last_hit_at: null,
  },
];

const QUEUE_ROWS: SweepRow[] = [
  {
    rowid: 1,
    x_user_id: "1",
    handle: "spammy1",
    display_name: "接单 免费推广",
    evidence_text: null,
    reasons: null,
    status: "auto_pending_review",
    followers_count: 10,
  },
  {
    rowid: 2,
    x_user_id: "2",
    handle: "cleanuser",
    display_name: "ordinary person",
    evidence_text: "nothing to see",
    reasons: null,
    status: "auto_pending_review",
    followers_count: 10,
  },
];

const LEGIT_ROWS: SweepRow[] = [
  {
    rowid: 3,
    x_user_id: "3",
    handle: "sleeper",
    display_name: "主页 免费推广 咨询",
    evidence_text: null,
    reasons: null,
    status: "auto_legit",
    followers_count: 10,
  },
];

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
    return null;
  }
  async all<T>(): Promise<{ results?: T[] }> {
    if (this.sql.includes("FROM keyword_rules")) return { results: RULES as T[] };
    if (this.sql.includes("status='auto_pending_review'")) return { results: QUEUE_ROWS as T[] };
    if (this.sql.includes("status='auto_legit'")) {
      this.db.legitScans++;
      return { results: LEGIT_ROWS as T[] };
    }
    return { results: [] };
  }
  async run() {
    return { meta: { changes: 1 } };
  }
}

class DB {
  writes: Stmt[] = [];
  legitScans = 0;
  prepare(sql: string) {
    return new Stmt(this, sql);
  }
  async batch(stmts: Stmt[]) {
    this.writes.push(...stmts);
    return stmts.map(() => ({ meta: { changes: 1 } }));
  }
  async dump() {
    return new Uint8Array();
  }
  async exec() {
    return { meta: { changes: 0 } };
  }
}

function sweep(body?: unknown): Request {
  return new Request("https://edge.test/v1/admin/keyword-rules/apply-to-queue", {
    method: "POST",
    headers: { "content-type": "application/json", "x-admin-token": "admin" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

test("default scope sweeps only the queue and skips the auto_legit scan", async () => {
  const db = new DB();
  const res = await worker.fetch(sweep(), { DB: db, ADMIN_TOKEN: "admin" });
  assert.equal(res.status, 200);
  const j = (await res.json()) as { matched: number; scope: string; legitMatched: number };
  assert.equal(j.scope, "queue");
  assert.equal(j.matched, 1); // spammy1 only
  assert.equal(j.legitMatched, 0);
  assert.equal(db.legitScans, 0);
  const upd = db.writes.find((w) => w.sql.includes("UPDATE accounts"));
  assert.ok(upd);
  assert.equal(upd.args[0], "human_confirmed"); // queue hit publishes (low follower, spam label)
});

test("scope:'all' rescans auto_legit and parks hits in the queue instead of publishing", async () => {
  const db = new DB();
  const res = await worker.fetch(sweep({ scope: "all" }), { DB: db, ADMIN_TOKEN: "admin" });
  assert.equal(res.status, 200);
  const j = (await res.json()) as {
    matched: number;
    scope: string;
    legitMatched: number;
    legitTruncated: boolean;
  };
  assert.equal(j.scope, "all");
  assert.equal(j.matched, 2);
  assert.equal(j.legitMatched, 1);
  assert.equal(j.legitTruncated, false);
  assert.equal(db.legitScans, 1);
  const updates = db.writes.filter(
    (w) => w.sql.includes("UPDATE accounts") && !w.sql.includes("hit_count"),
  );
  assert.equal(updates.length, 2);
  const legitUpdate = updates.find((w) => w.args[w.args.length - 1] === 3);
  assert.ok(legitUpdate, "the auto_legit row must be rewritten");
  assert.equal(legitUpdate.args[0], "auto_pending_review"); // parked, not published
  // Positional from the end (…, published_at, published_tier, rowid) so adding
  // a column to the SET list doesn't silently re-point these assertions.
  const a = legitUpdate.args;
  assert.equal(a[a.length - 3], null); // published_at stays null
  assert.equal(a[a.length - 2], null); // published_tier stays null
});

// Regression (2026-07-28): the sweep rewrote status/verdict but never touched
// `category`, so an account the LLM had filed under 网盘资源 kept that category
// after a 色情 rule blacklisted it — the public list then told clients the
// wrong spam type. Reported as "规则设置为色情广告，但还是会出现识别为网盘资源".
test("sweep stamps the rule's category onto the row it rewrites", async () => {
  const db = new DB();
  const res = await worker.fetch(sweep(), { DB: db, ADMIN_TOKEN: "admin" });
  assert.equal(res.status, 200);
  const upd = db.writes.find(
    (w) => w.sql.includes("UPDATE accounts") && !w.sql.includes("hit_count"),
  );
  assert.ok(upd);
  // COALESCE so a rule with no category of its own leaves the old one alone.
  assert.ok(upd.sql.includes("category=COALESCE(?, category)"), upd.sql);
  // RULES[0] is verdict_label 'spam' with no explicit category → no opinion.
  assert.equal(upd.args[3], null);
});

test("a porn_bot rule stamps the porn category even without an explicit one", async () => {
  const db = new DB();
  RULES[0].verdict_label = "porn_bot";
  try {
    const res = await worker.fetch(sweep(), { DB: db, ADMIN_TOKEN: "admin" });
    assert.equal(res.status, 200);
    const upd = db.writes.find(
      (w) => w.sql.includes("UPDATE accounts") && !w.sql.includes("hit_count"),
    );
    assert.equal(upd?.args[3], "porn");
  } finally {
    RULES[0].verdict_label = "spam";
  }
});
