// Regression (2026-07-28): the rule sweep's auto_legit prefilter bound three
// parameters per pattern, so at 66 enabled rules it bound 198 and D1 rejected
// the statement — "D1_ERROR: too many SQL variables". The 全量扫描 button 500'd
// on every click in production. The prefilter now binds one parameter per
// pattern and chunks the pattern list, so no statement can cross D1's cap.
import assert from "node:assert/strict";
import { test } from "node:test";

const edgeModuleUrl = new URL("../src/index.ts", import.meta.url).href;
const worker = (await import(edgeModuleUrl)).default as {
  fetch(req: Request, env: Record<string, unknown>): Promise<Response>;
};

/** D1's hard ceiling on bound parameters in a single statement. */
const D1_BIND_CAP = 100;

// Far more rules than the cap allows at one bind each, so the sweep must chunk.
const RULE_COUNT = 120;
const RULES = Array.from({ length: RULE_COUNT }, (_, i) => ({
  id: i + 1,
  pattern: `pat${i}`,
  field: "any",
  action: "blacklist",
  verdict_label: "spam",
  category: null,
  enabled: 1,
  note: null,
  created_at: 1,
  hit_count: 0,
  last_hit_at: null,
}));

// One auto_legit row matching a pattern in the SECOND chunk. The mock returns
// it for every chunk, so a sweep that forgot to dedupe would double-count it.
const LEGIT_ROW = {
  rowid: 42,
  x_user_id: "42",
  handle: "sleeper",
  display_name: "主页 pat99 咨询",
  evidence_text: null,
  reasons: null,
  status: "auto_legit",
  followers_count: 10,
};

class Stmt {
  args: unknown[] = [];
  constructor(
    readonly db: DB,
    readonly sql: string,
  ) {}
  bind(...args: unknown[]) {
    this.args = args;
    this.db.maxBinds = Math.max(this.db.maxBinds, args.length);
    return this;
  }
  async first<T>(): Promise<T | null> {
    return null;
  }
  async all<T>(): Promise<{ results?: T[] }> {
    if (this.sql.includes("FROM keyword_rules")) return { results: this.db.rules as T[] };
    if (this.sql.includes("status='auto_pending_review'")) {
      this.db.queueScans++;
      return { results: this.db.page(this.args, "auto_pending_review") as T[] };
    }
    if (this.sql.includes("status='auto_legit'")) {
      this.db.legitScans++;
      return { results: this.db.page(this.args, "auto_legit") as T[] };
    }
    return { results: [] };
  }
  async run() {
    return { meta: { changes: 1 } };
  }
}

class DB {
  writes: Stmt[] = [];
  prepared: Stmt[] = [];
  legitScans = 0;
  queueScans = 0;
  maxBinds = 0;
  rules: typeof RULES = RULES;
  /** Rows this partition would return, ignoring the pattern predicate. */
  rowsFor(_status: string): typeof LEGIT_ROW[] {
    return _status === "auto_legit" ? [LEGIT_ROW] : [];
  }
  /** Honour the `rowid>?` cursor + `LIMIT ?` the sweep pages with. */
  page(args: unknown[], status: string) {
    const cursor = Number(args[0]);
    const limit = Number(args[args.length - 1]);
    return this.rowsFor(status)
      .filter((r) => r.rowid > cursor)
      .slice(0, limit);
  }
  prepare(sql: string) {
    const s = new Stmt(this, sql);
    this.prepared.push(s);
    return s;
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

function sweep(scope: string): Request {
  return new Request("https://edge.test/v1/admin/keyword-rules/apply-to-queue", {
    method: "POST",
    headers: { "content-type": "application/json", "x-admin-token": "admin" },
    body: JSON.stringify({ scope }),
  });
}

test("sweep keeps every statement under D1's bind cap and chunks the patterns", async () => {
  const db = new DB();
  const res = await worker.fetch(sweep("all"), { DB: db, ADMIN_TOKEN: "admin" });
  assert.equal(res.status, 200);
  const j = (await res.json()) as { matched: number; legitMatched: number };
  assert.ok(
    db.maxBinds <= D1_BIND_CAP,
    `a statement bound ${db.maxBinds} params, over D1's ${D1_BIND_CAP} cap`,
  );
  // 120 patterns can't fit one statement, so both partitions are swept in
  // multiple chunked passes.
  assert.ok(db.legitScans > 1, "the auto_legit prefilter must be chunked");
  assert.ok(db.queueScans > 1, "the queue prefilter must be chunked");
  // Chunks overlap on rows; the row must be acted on exactly once.
  assert.equal(j.matched, 1);
  assert.equal(j.legitMatched, 1);
  const updates = db.writes.filter(
    (w) => w.sql.includes("UPDATE accounts") && !w.sql.includes("hit_count"),
  );
  assert.equal(updates.length, 1);
});

test("sweep pages past the first window instead of rescanning it forever", async () => {
  // A single rule (one pattern chunk) and a partition deeper than one page.
  // With a plain LIMIT the sweep would only ever see rows 1..PAGE; the rowid
  // cursor has to carry it to the tail.
  const PAGE = 500;
  const TOTAL = PAGE + 7;
  class DeepDB extends DB {
    rules = [{ ...RULES[0], pattern: "pat0" }];
    rowsFor(status: string) {
      if (status !== "auto_legit") return [];
      return Array.from({ length: TOTAL }, (_, i) => ({
        ...LEGIT_ROW,
        rowid: i + 1,
        x_user_id: String(i + 1),
        handle: `sleeper${i + 1}`,
        // Only the very last row matches the strict (word-boundary) matcher,
        // so reaching it proves the sweep walked the whole partition.
        display_name: i === TOTAL - 1 ? "主页 pat0 咨询" : "普通用户",
      }));
    }
  }
  const db = new DeepDB();
  const res = await worker.fetch(sweep("all"), { DB: db, ADMIN_TOKEN: "admin" });
  assert.equal(res.status, 200);
  const j = (await res.json()) as { legitMatched: number; legitTruncated: boolean };
  assert.equal(db.legitScans, 2, "one full page then the remainder");
  assert.equal(j.legitMatched, 1, "the tail row must be reached");
  assert.equal(j.legitTruncated, false);
});

test("a cased non-ASCII pattern also prefilters against the un-lowered haystack", async () => {
  // SQLite's lower() is ASCII-only, so matching a Cyrillic rule against the
  // lowered haystack alone would silently skip rows the JS matcher hits.
  class CyrillicDB extends DB {
    rules = [{ ...RULES[0], pattern: "Привет" }];
    rowsFor() {
      return [];
    }
  }
  const db = new CyrillicDB();
  const res = await worker.fetch(sweep("all"), { DB: db, ADMIN_TOKEN: "admin" });
  assert.equal(res.status, 200);
  const scan = db.prepared.find((s) => s.sql.includes("status='auto_legit'"));
  assert.ok(scan, "the auto_legit prefilter must run");
  assert.ok(scan.sql.includes("instr(lower("), "lowered-haystack term");
  assert.ok(scan.sql.includes("instr(coalesce("), "raw-haystack term for the cased pattern");
  assert.ok(scan.args.includes("привет"), "lowercased form is bound");
  assert.ok(scan.args.includes("Привет"), "as-typed form is bound");
});

test("queue-scope sweep also prefilters in SQL instead of pulling the partition", async () => {
  const db = new DB();
  const res = await worker.fetch(sweep("queue"), { DB: db, ADMIN_TOKEN: "admin" });
  assert.equal(res.status, 200);
  assert.equal(db.legitScans, 0);
  assert.ok(db.queueScans > 0);
  assert.ok(db.maxBinds <= D1_BIND_CAP);
});
