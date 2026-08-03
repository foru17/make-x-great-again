// Keyword-rule coverage fixes (2026-07-27).
//
// Covers the three "manual sweep keeps finding hits" gaps:
//   - /v1/classify: a fresh (TTL/exact-hash cached) auto_* verdict no longer
//     shields the account from keyword rules — a rule whose destination
//     differs overrides the cache; terminal/human statuses stay untouchable
//   - /v1/classify: a rule hit whose destination EQUALS the current status
//     returns cached (no per-view rewrite loop)
//   - /v1/report: the report path now runs keyword rules — a reported account
//     matching a blacklist rule publishes (tier 'rule') instead of queueing
import assert from "node:assert/strict";
import { after, test } from "node:test";

const edgeModuleUrl = new URL("../src/index.ts", import.meta.url).href;
const worker = (await import(edgeModuleUrl)).default as {
  fetch(req: Request, env: Record<string, unknown>): Promise<Response>;
};

const originalFetch = globalThis.fetch;
after(() => {
  globalThis.fetch = originalFetch;
});

interface Account {
  rowid: number;
  handle: string;
  x_user_id: string | null;
  status: string;
  verdict_label: string;
  confidence: number;
  category?: string | null;
  reasons?: string | null;
  signals_hash?: string | null;
  last_scored?: number;
  published_at?: number | null;
  published_tier?: string | null;
  source?: string;
}

interface Rule {
  id: number;
  pattern: string;
  field: string;
  action: string;
  verdict_label: string;
  category: string | null;
  enabled: number;
  note: string | null;
  created_at: number;
  hit_count: number;
  last_hit_at: number | null;
}

class MockStmt {
  args: unknown[] = [];
  constructor(
    private db: MockDB,
    private sql: string,
  ) {}

  bind(...args: unknown[]) {
    this.args = args;
    return this;
  }

  async first<T>(): Promise<T | null> {
    if (this.sql.includes("FROM rate_log")) return { n: 0 } as T;
    if (this.sql.includes("FROM reporter_bans")) return null;
    if (this.sql.includes("count(DISTINCT") && this.sql.includes("FROM reports")) {
      return { n: 1 } as T;
    }
    if (this.sql.includes("FROM accounts")) {
      if (this.sql.includes("WHERE x_user_id=?")) {
        const uid = this.args[0] as string;
        return (this.db.accounts.find((a) => a.x_user_id === uid) as T | undefined) ?? null;
      }
      const handle = this.args[0] as string;
      const uid = this.args[1] as string | null;
      return (
        (this.db.accounts.find(
          (a) =>
            a.handle.toLowerCase() === handle &&
            (uid === null || a.x_user_id === null || a.x_user_id === uid),
        ) as T | undefined) ?? null
      );
    }
    return null;
  }

  async all<T>(): Promise<{ results?: T[]; meta?: { changes?: number } }> {
    if (this.sql.includes("FROM keyword_rules")) {
      return { results: this.db.rules.filter((r) => r.enabled) as T[] };
    }
    return { results: [] };
  }

  async run(): Promise<{ results?: unknown[]; meta: { changes?: number; last_row_id?: number } }> {
    if (this.sql.includes("INSERT INTO accounts")) {
      // Bind order mirrors writeAccount's INSERT column list.
      const a = this.args;
      this.db.accounts.push({
        rowid: this.db.accounts.length + 1,
        x_user_id: a[0] as string | null,
        handle: a[1] as string,
        verdict_label: a[8] as string,
        confidence: a[9] as number,
        reasons: a[10] as string | null,
        category: a[11] as string | null,
        status: a[13] as string,
        source: a[14] as string,
        signals_hash: a[15] as string | null,
        last_scored: a[18] as number,
        published_at: a[19] as number | null,
        published_tier: a[20] as string | null,
      });
      return { meta: { changes: 1, last_row_id: this.db.accounts.length } };
    }
    if (this.sql.includes("UPDATE accounts SET") && this.sql.includes("category=COALESCE")) {
      // Bind order mirrors writeAccount's UPDATE statement.
      const a = this.args;
      const rowid = a[a.length - 1] as number;
      const acc = this.db.accounts.find((x) => x.rowid === rowid);
      if (acc) {
        acc.verdict_label = a[8] as string;
        acc.confidence = a[9] as number;
        acc.reasons = a[10] as string | null;
        acc.category = (a[11] as string | null) ?? acc.category ?? null;
        acc.signals_hash = (a[14] as string | null) ?? acc.signals_hash ?? null;
        acc.last_scored = a[16] as number;
        const terminal = ["human_confirmed", "rejected", "removed", "whitelisted"];
        if (!terminal.includes(acc.status)) {
          acc.status = a[17] as string;
          acc.published_at = a[18] as number | null;
          acc.published_tier = a[19] as string | null;
        }
      }
      return { meta: { changes: 1 } };
    }
    if (
      this.sql.includes("UPDATE accounts SET") &&
      this.sql.includes("account_created_at=COALESCE") &&
      !this.sql.includes("verdict_label")
    ) {
      // updateAccountSignalSnapshot — count so tests can assert no write loop.
      this.db.snapshotWrites++;
      return { meta: { changes: 1 } };
    }
    if (this.sql.includes("UPDATE keyword_rules SET hit_count")) {
      const id = this.args[1] as number;
      const rule = this.db.rules.find((r) => r.id === id);
      if (rule) rule.hit_count++;
      return { meta: { changes: 1 } };
    }
    if (this.sql.includes("INSERT INTO review_log")) {
      this.db.reviewLog.push({
        action: this.args[2] as string,
        actor: this.args[3] as string,
        note: (this.args[4] as string) ?? "",
      });
      return { meta: { changes: 1 } };
    }
    return { meta: { changes: 1 } };
  }
}

class MockDB {
  accounts: Account[] = [];
  rules: Rule[] = [];
  reviewLog: { action: string; actor: string; note: string }[] = [];
  snapshotWrites = 0;
  prepare(sql: string) {
    return new MockStmt(this, sql);
  }
  async batch(stmts: MockStmt[]) {
    return Promise.all(stmts.map((s) => s.run()));
  }
  async dump() {
    return new Uint8Array();
  }
  async exec() {
    return { meta: { changes: 0 } };
  }
}

let llmCalls = 0;
let llmContent = '{"label":"legit","confidence":0.9,"reasons":["benign"]}';
globalThis.fetch = async (input: string | URL | Request) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url === "https://api.github.com/user") {
    return Response.json({ id: 42, created_at: "2020-01-01T00:00:00Z" });
  }
  if (url.startsWith("https://llm.invalid")) {
    llmCalls++;
    return Response.json({ choices: [{ message: { content: llmContent } }] });
  }
  return originalFetch(input as Request);
};

// One shared db/env for the whole file: getKeywordRules caches rules
// module-wide for 30s, so every test must see the same rule set.
const db = new MockDB();
const ruleDefaults = {
  category: null,
  enabled: 1,
  note: null,
  created_at: 1,
  hit_count: 0,
  last_hit_at: null,
};
db.rules = [
  { id: 1, pattern: "看我主页", field: "bio", action: "blacklist", verdict_label: "porn_bot", category: "porn", enabled: 1, note: null, created_at: 1, hit_count: 0, last_hit_at: null },
  { id: 2, pattern: "cheapfollowers", field: "handle", action: "blacklist", verdict_label: "spam", ...ruleDefaults },
];
const env = {
  DB: db,
  REPORT_SALT: "test-report-salt",
  REQUIRE_AUTH: "1",
  LLM_API_BASE: "https://llm.invalid",
  LLM_API_KEY: "test",
  LLM_API_MODEL: "test-model",
};

function post(path: string, body: Record<string, unknown>): Request {
  return new Request(`https://x.test${path}`, {
    method: "POST",
    headers: { authorization: "Bearer ok-token", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("classify: a fresh auto_legit verdict is overridden by a matching rule", async () => {
  llmCalls = 0;
  db.accounts.push({
    rowid: 90,
    x_user_id: "900",
    handle: "sleeperbot",
    status: "auto_legit",
    verdict_label: "legit",
    confidence: 0.9,
    signals_hash: "stale-hash",
    last_scored: Date.now() - 60_000, // fresh: auto_legit TTL is 30d
  });
  const res = await worker.fetch(
    post("/v1/classify", {
      userId: "900",
      handle: "sleeperbot",
      displayName: "小可爱",
      bio: "同城资源 看我主页 私信",
      recentTweets: ["hello"],
    }),
    env,
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as { cached?: boolean; matchedRule?: { id: number } };
  assert.equal(body.cached, false); // NOT served from the stale cache
  assert.equal(body.matchedRule?.id, 1);
  assert.equal(llmCalls, 0);
  const acc = db.accounts.find((a) => a.x_user_id === "900");
  assert.ok(acc);
  assert.equal(acc.status, "human_confirmed");
  assert.equal(acc.published_tier, "rule");
});

test("classify: rule destination == current status returns cached, no rewrite loop", async () => {
  llmCalls = 0;
  // High-follower → the blacklist hit is demoted to the queue, which is
  // exactly where the row already sits → must return cached, not rewrite.
  db.accounts.push({
    rowid: 91,
    x_user_id: "901",
    handle: "bigqueued",
    status: "auto_pending_review",
    verdict_label: "likely_spam",
    confidence: 0.7,
    signals_hash: "some-hash",
    last_scored: Date.now() - 60_000, // fresh: pending TTL is 24h
  });
  const before = db.snapshotWrites;
  const res = await worker.fetch(
    post("/v1/classify", {
      userId: "901",
      handle: "bigqueued",
      displayName: "网红",
      bio: "合作请私信 看我主页",
      followersCount: 500_000,
      recentTweets: ["日常"],
    }),
    env,
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as { cached?: boolean; record?: { status: string } };
  assert.equal(body.cached, true);
  assert.equal(body.record?.status, "auto_pending_review");
  assert.equal(llmCalls, 0);
  assert.equal(db.snapshotWrites, before + 1); // snapshot refresh only, no verdict rewrite
});

test("classify: a terminal human decision is never overridden by a rule", async () => {
  llmCalls = 0;
  db.accounts.push({
    rowid: 92,
    x_user_id: "902",
    handle: "humansaidno",
    status: "rejected",
    verdict_label: "legit",
    confidence: 1,
    signals_hash: "h",
    last_scored: 1, // ancient — but terminal TTL is Infinity → always fresh
  });
  const res = await worker.fetch(
    post("/v1/classify", {
      userId: "902",
      handle: "humansaidno",
      displayName: "ok",
      bio: "看我主页", // matches rule 1
      recentTweets: [],
    }),
    env,
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as { cached?: boolean; record?: { status: string } };
  assert.equal(body.cached, true);
  assert.equal(body.record?.status, "rejected");
  const acc = db.accounts.find((a) => a.x_user_id === "902");
  assert.equal(acc?.status, "rejected");
});

test("report: a reported account matching a blacklist rule publishes (tier rule), not queues", async () => {
  llmCalls = 0;
  const res = await worker.fetch(
    post("/v1/report", {
      userId: "903",
      handle: "cheapfollowers",
      displayName: "growth hack",
      recentTweets: ["buy now"],
    }),
    env,
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as { ok: boolean; status: string };
  assert.equal(body.ok, true);
  assert.equal(body.status, "human_confirmed");
  assert.equal(llmCalls, 0); // rule short-circuits the LLM on the report path too
  const acc = db.accounts.find((a) => a.x_user_id === "903");
  assert.ok(acc);
  assert.equal(acc.status, "human_confirmed");
  assert.equal(acc.published_tier, "rule");
  assert.equal(acc.source, "report"); // 来源 stays report — the rule is the actor, not the source
  const audit = db.reviewLog.find((l) => l.actor === "rule:2" && l.action === "keyword_blacklist");
  assert.ok(audit, "rule hit on the report path must leave a review_log audit");
  assert.equal(db.rules.find((r) => r.id === 2)?.hit_count, 1);
});

test("report: a reported high-follower rule match queues instead of publishing", async () => {
  llmCalls = 0;
  const res = await worker.fetch(
    post("/v1/report", {
      userId: "904",
      handle: "cheapfollowers2",
      displayName: "growth hack",
      followersCount: 200_000,
      recentTweets: ["buy now"],
    }),
    env,
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as { ok: boolean; status: string };
  // handle rule is 'cheapfollowers' word-bounded — "cheapfollowers2" has an
  // adjacent digit, so it does NOT match; this account goes down the normal
  // report path (prev-less → LLM) instead.
  assert.equal(body.status, "auto_pending_review");
  assert.equal(llmCalls, 1);
});
