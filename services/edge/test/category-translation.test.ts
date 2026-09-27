// Category taxonomy + X auto-translate guard tests for /v1/classify.
//
// Covers:
//   - CJK keyword rule on tweet text is SUPPRESSED for a CJK-free profile
//     (X auto-translate false-positive guard) → falls through to the LLM
//   - the same rule fires normally for a CJK profile and stamps the rule's
//     maintainer-curated category onto the account
//   - tweetsTranslated:true from a new-style client suppresses tweet-text
//     rule matching even on a CJK profile
//   - the LLM verdict's explicit category is persisted on the account row
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
        signals_hash: a[15] as string | null,
        last_scored: a[18] as number,
        published_at: a[19] as number | null,
        published_tier: a[20] as string | null,
      });
      return { meta: { changes: 1, last_row_id: this.db.accounts.length } };
    }
    if (this.sql.includes("UPDATE accounts SET") && this.sql.includes("category=COALESCE")) {
      // writeAccount's UPDATE path; last bind is the rowid.
      const a = this.args;
      const rowid = a[a.length - 1] as number;
      const acc = this.db.accounts.find((x) => x.rowid === rowid);
      if (acc) {
        acc.verdict_label = a[8] as string;
        acc.confidence = a[9] as number;
        acc.reasons = a[10] as string | null;
        acc.category = (a[11] as string | null) ?? acc.category ?? null;
        const terminal = ["human_confirmed", "rejected", "removed", "whitelisted"];
        if (!terminal.includes(acc.status)) acc.status = a[17] as string;
      }
      return { meta: { changes: 1 } };
    }
    return { meta: { changes: 1 } };
  }
}

class MockDB {
  accounts: Account[] = [];
  rules: Rule[] = [];
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
let llmContent = '{"label":"spam","confidence":0.9,"reasons":["fresh"]}';
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
db.rules = [
  {
    id: 1,
    pattern: "同城上门",
    field: "tweet",
    action: "blacklist",
    verdict_label: "porn_bot",
    category: "porn",
    enabled: 1,
    note: null,
    created_at: 1,
    hit_count: 0,
    last_hit_at: null,
  },
];
const env = {
  DB: db,
  REPORT_SALT: "test-report-salt",
  REQUIRE_AUTH: "1",
  AI_AUTO_PUBLISH_ENABLED: "1",
  LLM_API_BASE: "https://llm.invalid",
  LLM_API_KEY: "test",
  LLM_API_MODEL: "test-model",
};

function classify(body: Record<string, unknown>): Request {
  return new Request("https://x.test/v1/classify", {
    method: "POST",
    headers: { authorization: "Bearer ok-token", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("CJK tweet rule is suppressed for a CJK-free profile (auto-translate guard)", async () => {
  llmCalls = 0;
  llmContent = '{"label":"legit","confidence":0.9,"reasons":["benign"]}';
  const res = await worker.fetch(
    classify({
      userId: "555",
      handle: "johnny",
      displayName: "John Doe",
      bio: "surf, coffee, code",
      recentTweets: ["同城上门服务，看主页"], // X-translated body of a legit tweet
    }),
    env,
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as { matchedRule?: unknown };
  assert.equal(body.matchedRule, undefined); // rule did NOT fire
  assert.equal(llmCalls, 1); // fell through to the LLM instead
});

test("the same CJK tweet rule fires for a CJK profile and stamps the rule category", async () => {
  llmCalls = 0;
  const res = await worker.fetch(
    classify({
      userId: "556",
      handle: "zhaopin88",
      displayName: "同城资源小姐姐",
      recentTweets: ["同城上门服务，看主页"],
    }),
    env,
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as { matchedRule?: { pattern: string } };
  assert.equal(body.matchedRule?.pattern, "同城上门");
  assert.equal(llmCalls, 0); // keyword short-circuit, no LLM spend
  const acc = db.accounts.find((a) => a.x_user_id === "556");
  assert.ok(acc);
  assert.equal(acc.status, "human_confirmed");
  assert.equal(acc.category, "porn"); // maintainer-curated rule category
});

test("tweetsTranslated:true suppresses tweet-text rules even on a CJK profile", async () => {
  llmCalls = 0;
  llmContent = '{"label":"legit","confidence":0.9,"reasons":["benign"]}';
  const res = await worker.fetch(
    classify({
      userId: "557",
      handle: "kotomi_jp",
      displayName: "琴美です", // CJK (Japanese kanji) profile
      recentTweets: ["同城上门服务"],
      tweetsTranslated: true,
    }),
    env,
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as { matchedRule?: unknown };
  assert.equal(body.matchedRule, undefined);
  assert.equal(llmCalls, 1);
});

test("LLM verdict category is persisted on the account row", async () => {
  llmCalls = 0;
  llmContent =
    '{"label":"spam","confidence":0.97,"reasons":["shills a token"],"category":"crypto"}';
  const res = await worker.fetch(
    classify({
      userId: "600",
      handle: "coinshill",
      displayName: "Moon Boy",
      recentTweets: ["buy my coin, 100x guaranteed"],
    }),
    env,
  );
  assert.equal(res.status, 200);
  assert.equal(llmCalls, 1);
  const acc = db.accounts.find((a) => a.x_user_id === "600");
  assert.ok(acc);
  assert.equal(acc.category, "crypto");
});

test("LLM verdict without category falls back to label mapping (porn_bot → porn)", async () => {
  llmCalls = 0;
  llmContent = '{"label":"porn_bot","confidence":0.97,"reasons":["escort solicitation"]}';
  const res = await worker.fetch(
    classify({
      userId: "601",
      handle: "hotgirl9000",
      displayName: "DM me",
      recentTweets: ["check my page"],
    }),
    env,
  );
  assert.equal(res.status, 200);
  const acc = db.accounts.find((a) => a.x_user_id === "601");
  assert.ok(acc);
  assert.equal(acc.category, "porn");
});

// ——— AI auto-publish gate (the PR's core safety line) ———
// porn_bot AND conf>=0.95 AND uid present AND aged GH identity → publish as
// tier 'ai'. Everything else queues for human review. These four tests pin
// each leg of the gate.

test("auto-publish: high-conf porn_bot with uid publishes as tier 'ai'", async () => {
  llmCalls = 0;
  llmContent = '{"label":"porn_bot","confidence":0.97,"reasons":["escort template"],"category":"porn"}';
  const res = await worker.fetch(
    classify({
      userId: "700",
      handle: "autopub_target",
      displayName: "DM 💕",
      recentTweets: ["看我主页"],
    }),
    env,
  );
  assert.equal(res.status, 200);
  const acc = db.accounts.find((a) => a.x_user_id === "700");
  assert.ok(acc);
  assert.equal(acc.status, "human_confirmed");
  assert.equal(acc.published_tier, "ai");
  assert.ok(acc.published_at);
});

test("auto-publish: generic spam NEVER auto-publishes, even at 0.99", async () => {
  llmCalls = 0;
  llmContent = '{"label":"spam","confidence":0.99,"reasons":["shill"],"category":"crypto"}';
  const res = await worker.fetch(
    classify({
      userId: "701",
      handle: "spam_but_queued",
      displayName: "Moon",
      recentTweets: ["buy now"],
    }),
    env,
  );
  assert.equal(res.status, 200);
  const acc = db.accounts.find((a) => a.x_user_id === "701");
  assert.ok(acc);
  assert.equal(acc.status, "auto_pending_review");
  assert.equal(acc.published_tier ?? null, null);
});

test("auto-publish: porn_bot below the 0.95 bar queues for review", async () => {
  llmCalls = 0;
  llmContent = '{"label":"porn_bot","confidence":0.9,"reasons":["maybe"],"category":"porn"}';
  const res = await worker.fetch(
    classify({
      userId: "702",
      handle: "lowconf_porn",
      displayName: "hi",
      recentTweets: ["hello"],
    }),
    env,
  );
  assert.equal(res.status, 200);
  const acc = db.accounts.find((a) => a.x_user_id === "702");
  assert.ok(acc);
  assert.equal(acc.status, "auto_pending_review");
  assert.equal(acc.published_tier ?? null, null);
});

test("auto-publish: handle-only porn_bot (no uid) queues for review", async () => {
  llmCalls = 0;
  llmContent = '{"label":"porn_bot","confidence":0.99,"reasons":["escort template"],"category":"porn"}';
  const res = await worker.fetch(
    classify({
      handle: "no_uid_porn",
      displayName: "DM 💕",
      recentTweets: ["看我主页"],
    }),
    env,
  );
  assert.equal(res.status, 200);
  const acc = db.accounts.find((a) => a.handle === "no_uid_porn");
  assert.ok(acc);
  assert.equal(acc.status, "auto_pending_review");
  assert.equal(acc.published_tier ?? null, null);
});
