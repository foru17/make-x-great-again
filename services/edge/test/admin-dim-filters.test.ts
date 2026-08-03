// Multi-dimension admin filters + filter-scoped batch decide (2026-07-27).
//
// /v1/admin/queue and /v1/admin/blacklist accept AND-combined structured
// dimensions (followers/following ranges, registration-date window, category,
// verdict, source, published tier) alongside the existing text filters.
// /v1/admin/decide-by-filter acts on every deduped queue row matching the
// same filter set — dryRun first for an exact count, capped execution after.
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
    if (this.sql.includes("count(*)")) return { n: this.db.matchCount } as T;
    return null;
  }
  async all<T>(): Promise<{ results?: T[] }> {
    this.db.queries.push(this);
    if (this.sql.includes("FROM ranked") && this.sql.includes("SELECT rid")) {
      return { results: this.db.targets as T[] };
    }
    return { results: [] };
  }
  async run() {
    this.db.queries.push(this);
    return { meta: { changes: 1 } };
  }
}

class DB {
  queries: Stmt[] = [];
  batches: Stmt[] = [];
  matchCount = 0;
  targets: { rid: number; x_user_id: string | null; handle: string }[] = [];
  prepare(sql: string) {
    return new Stmt(this, sql);
  }
  async batch(stmts: Stmt[]) {
    this.batches.push(...stmts);
    return stmts.map(() => ({ meta: { changes: 1 } }));
  }
  async dump() {
    return new Uint8Array();
  }
  async exec() {
    return { meta: { changes: 0 } };
  }
}

const ENV = (db: DB) => ({ DB: db, ADMIN_TOKEN: "admin" });
const HDRS = { "x-admin-token": "admin", "content-type": "application/json" };

test("queue accepts dimension filters and binds them AND-combined", async () => {
  const db = new DB();
  const res = await worker.fetch(
    new Request(
      "https://edge.test/v1/admin/queue?followers_min=100&followers_max=5000&created_after=2026-01-01&category=porn&verdict=porn_bot&source=report",
      { headers: HDRS },
    ),
    ENV(db),
  );
  assert.equal(res.status, 200);
  const j = (await res.json()) as { appliedFilters: Record<string, unknown> };
  assert.equal(j.appliedFilters.followers_min, 100);
  assert.equal(j.appliedFilters.followers_max, 5000);
  assert.equal(j.appliedFilters.created_after, "2026-01-01");
  assert.equal(j.appliedFilters.category, "porn");
  assert.equal(j.appliedFilters.verdict, "porn_bot");
  assert.equal(j.appliedFilters.source, "report");
  const main = db.queries.find((s) => s.sql.includes("WITH ranked"));
  assert.ok(main);
  assert.ok(main.sql.includes("followers_count >= ?"));
  assert.ok(main.sql.includes("verdict_label = ?"));
  assert.ok(main.args.includes(100));
  assert.ok(main.args.includes(5000));
  assert.ok(main.args.includes("2026-01-01"));
  assert.ok(main.args.includes("porn_bot"));
});

test("queue ignores malformed dimension values instead of erroring", async () => {
  const db = new DB();
  const res = await worker.fetch(
    new Request(
      "https://edge.test/v1/admin/queue?followers_min=abc&created_after=01/02/2026",
      { headers: HDRS },
    ),
    ENV(db),
  );
  assert.equal(res.status, 200);
  const j = (await res.json()) as { appliedFilters: Record<string, unknown> };
  assert.equal(j.appliedFilters.followers_min, null);
  assert.equal(j.appliedFilters.created_after, null);
});

test("queue page offset and match total use the same filtered CTE", async () => {
  const db = new DB();
  db.matchCount = 437;
  const res = await worker.fetch(
    new Request(
      "https://edge.test/v1/admin/queue?limit=100&offset=200&total=1&category=porn",
      { headers: HDRS },
    ),
    ENV(db),
  );

  assert.equal(res.status, 200);
  const body = (await res.json()) as { total: number; offset: number };
  assert.equal(body.total, 437);
  assert.equal(body.offset, 200);
  const count = db.queries.find((stmt) => stmt.sql.includes("SELECT count(*) AS n FROM ranked"));
  const page = db.queries.find(
    (stmt) => stmt.sql.includes("WITH ranked") && stmt.sql.includes("LIMIT ? OFFSET ?"),
  );
  assert.ok(count);
  assert.ok(page);
  assert.deepEqual(page.args.slice(-2), [100, 200]);
  assert.equal(count.args.filter((value) => value === "porn").length, 2);
  assert.equal(page.args.filter((value) => value === "porn").length, 2);
});

test("blacklist accepts tier + follower dimension filters", async () => {
  const db = new DB();
  const res = await worker.fetch(
    new Request("https://edge.test/v1/admin/blacklist?tier=rule&followers_min=100000", {
      headers: HDRS,
    }),
    ENV(db),
  );
  assert.equal(res.status, 200);
  const j = (await res.json()) as { appliedFilters: Record<string, unknown> };
  assert.equal(j.appliedFilters.tier, "rule");
  assert.equal(j.appliedFilters.followers_min, 100000);
  const main = db.queries.find((s) => s.sql.includes("WITH base"));
  assert.ok(main);
  assert.ok(main.sql.includes("published_tier,'') = ?"));
  assert.ok(main.args.includes("rule"));
});

test("blacklist exposes stable offset pagination and filtered totals", async () => {
  const db = new DB();
  db.matchCount = 205_954;
  const res = await worker.fetch(
    new Request("https://edge.test/v1/admin/blacklist?limit=100&offset=1300&total=1&tier=human", {
      headers: HDRS,
    }),
    ENV(db),
  );

  assert.equal(res.status, 200);
  const body = (await res.json()) as { total: number; offset: number };
  assert.equal(body.total, 205_954);
  assert.equal(body.offset, 1300);
  const page = db.queries.find(
    (stmt) => stmt.sql.includes("WITH base") && stmt.sql.includes("LIMIT ? OFFSET ?"),
  );
  assert.ok(page);
  assert.deepEqual(page.args.slice(-2), [100, 1300]);
});

test("decide-by-filter dryRun returns the exact matched count and writes nothing", async () => {
  const db = new DB();
  db.matchCount = 137;
  const res = await worker.fetch(
    new Request("https://edge.test/v1/admin/decide-by-filter", {
      method: "POST",
      headers: HDRS,
      body: JSON.stringify({
        action: "approve",
        dryRun: true,
        filters: { evidence: "比她好看", followers_max: "50" },
      }),
    }),
    ENV(db),
  );
  assert.equal(res.status, 200);
  const j = (await res.json()) as { ok: boolean; dryRun: boolean; matched: number };
  assert.equal(j.dryRun, true);
  assert.equal(j.matched, 137);
  assert.equal(db.batches.length, 0); // nothing written
});

test("decide-by-filter executes per matched row with an audit note", async () => {
  const db = new DB();
  db.matchCount = 2;
  db.targets = [
    { rid: 1, x_user_id: "11", handle: "bot_a" },
    { rid: 2, x_user_id: null, handle: "bot_b" },
  ];
  const res = await worker.fetch(
    new Request("https://edge.test/v1/admin/decide-by-filter", {
      method: "POST",
      headers: HDRS,
      body: JSON.stringify({
        action: "approve",
        category: "porn",
        filters: { evidence: "比她好看" },
      }),
    }),
    ENV(db),
  );
  assert.equal(res.status, 200);
  const j = (await res.json()) as {
    ok: boolean;
    matched: number;
    processed: number;
    truncated: boolean;
    status: string;
  };
  assert.equal(j.matched, 2);
  assert.equal(j.processed, 2);
  assert.equal(j.truncated, false);
  assert.equal(j.status, "human_confirmed");
  // The uid-bearing row also gets a handle-only sibling-cleanup UPDATE, so
  // match the primary decide statement by its published_tier stamp.
  const updates = db.batches.filter(
    (s) => s.sql.includes("UPDATE accounts SET status=?") && s.sql.includes("published_tier"),
  );
  assert.equal(updates.length, 2);
  assert.equal(updates[0].args[0], "human_confirmed");
  assert.equal(updates[0].args[2], "human"); // published_tier stamped as a human decision
  const logs = db.batches.filter((s) => s.sql.includes("INSERT INTO review_log"));
  assert.equal(logs.length, 2);
  assert.ok(String(logs[0].args[4]).includes("filter_batch"));
  assert.ok(String(logs[0].args[4]).includes("比她好看"));
});

test("decide-by-filter rejects an unknown action", async () => {
  const db = new DB();
  const res = await worker.fetch(
    new Request("https://edge.test/v1/admin/decide-by-filter", {
      method: "POST",
      headers: HDRS,
      body: JSON.stringify({ action: "nuke", filters: {} }),
    }),
    ENV(db),
  );
  assert.equal(res.status, 400);
});

// ---- Blacklist parity + filter-scoped categorize (2026-07-28) ----
// The blacklist view used to accept only `q` + dimensions while the queue also
// took per-field text filters, so the same filter panel meant two different
// things. Both now build their text WHERE from one helper.

const TEXT_PARAMS =
  "q=mary&uid=2056413&handle=spam_&evidence=%E6%AF%94%E5%A5%B9%E5%A5%BD%E7%9C%8B&display_name=Mary&reasons=%E5%AF%BC%E6%B5%81";

test("blacklist accepts the same per-field text filters as the queue", async () => {
  const db = new DB();
  const res = await worker.fetch(
    new Request(`https://edge.test/v1/admin/blacklist?${TEXT_PARAMS}`, { headers: HDRS }),
    ENV(db),
  );
  assert.equal(res.status, 200);
  const j = (await res.json()) as { appliedFilters: Record<string, unknown> };
  assert.equal(j.appliedFilters.handle, "spam_");
  assert.equal(j.appliedFilters.evidence, "比她好看");
  assert.equal(j.appliedFilters.display_name, "Mary");
  assert.equal(j.appliedFilters.reasons, "导流");
  assert.equal(j.appliedFilters.uid, "2056413");
  const main = db.queries.find((s) => s.sql.includes("WITH base"));
  assert.ok(main);
  for (const v of ["spam_", "比她好看", "Mary", "导流", "2056413"]) {
    assert.ok(main.args.includes(v), `${v} must be bound`);
  }
});

test("queue and blacklist build an identical text WHERE clause", async () => {
  const grab = async (path: string, marker: string) => {
    const db = new DB();
    await worker.fetch(new Request(`https://edge.test${path}?${TEXT_PARAMS}`, { headers: HDRS }), ENV(db));
    const s = db.queries.find((x) => x.sql.includes(marker));
    assert.ok(s, `${path} main query`);
    // Everything between the status predicate and the dimension block.
    const m = s.sql.match(/status='[a-z_]+'\n([\s\S]*?)\n\s+AND \(\? IS NULL OR a\.followers_count/);
    return m?.[1].replace(/\s+/g, " ").trim();
  };
  const queue = await grab("/v1/admin/queue", "WITH ranked");
  const blacklist = await grab("/v1/admin/blacklist", "WITH base");
  assert.ok(queue, "queue text clause");
  assert.equal(blacklist, queue);
});

test("decide-by-filter categorize on the blacklist stamps category, not status", async () => {
  const db = new DB();
  db.matchCount = 2;
  db.targets = [
    { rid: 7, x_user_id: "11", handle: "bet_a" },
    { rid: 9, x_user_id: null, handle: "bet_b" },
  ];
  const res = await worker.fetch(
    new Request("https://edge.test/v1/admin/decide-by-filter", {
      method: "POST",
      headers: HDRS,
      body: JSON.stringify({
        action: "categorize",
        scope: "blacklist",
        category: "gambling",
        filters: { evidence: "首充送" },
      }),
    }),
    ENV(db),
  );
  assert.equal(res.status, 200);
  const j = (await res.json()) as { status: string | null; scope: string; processed: number };
  assert.equal(j.status, null); // no status change
  assert.equal(j.scope, "blacklist");
  assert.equal(j.processed, 2);
  // Targets come from the human_confirmed partition, un-deduped.
  const scan = db.queries.find((s) => s.sql.includes("SELECT rid"));
  assert.ok(scan?.sql.includes("status='human_confirmed'"));
  assert.ok(!scan?.sql.includes("row_number()"));
  const updates = db.batches.filter((s) => s.sql.includes("UPDATE accounts SET category=?"));
  assert.equal(updates.length, 2);
  assert.deepEqual(updates[0].args, ["gambling", 7]); // addressed by rowid
  assert.equal(db.batches.filter((s) => s.sql.includes("SET status=?")).length, 0);
  const logs = db.batches.filter((s) => s.sql.includes("INSERT INTO review_log"));
  assert.equal(logs.length, 2);
  assert.ok(String(logs[0].args[4]).includes("scope=blacklist"));
  assert.ok(String(logs[0].args[4]).includes("category=gambling"));
});

test("decide-by-filter rejects categorize without a category, and approve on the blacklist", async () => {
  const noCat = await worker.fetch(
    new Request("https://edge.test/v1/admin/decide-by-filter", {
      method: "POST",
      headers: HDRS,
      body: JSON.stringify({ action: "categorize", filters: {} }),
    }),
    ENV(new DB()),
  );
  assert.equal(noCat.status, 400);
  const approveOnList = await worker.fetch(
    new Request("https://edge.test/v1/admin/decide-by-filter", {
      method: "POST",
      headers: HDRS,
      body: JSON.stringify({ action: "approve", scope: "blacklist", filters: {} }),
    }),
    ENV(new DB()),
  );
  assert.equal(approveOnList.status, 400);
});
