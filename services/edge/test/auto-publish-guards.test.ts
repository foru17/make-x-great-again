// Auto-publish guardrails added after the 2026-07-24 high-follower FP audit.
//
// Covers:
//   - ASCII keyword patterns require word boundaries: "visa" must NOT hit
//     display name "Visakan" (the real incident that published a 205k-follower
//     author at confidence=1), while a standalone "visa" still fires
//   - a 'blacklist' rule hit on a known ≥100k-follower account queues for
//     review instead of publishing
//   - a 'blacklist' rule whose verdict_label is not a spam label ('uncertain')
//     can never publish
//   - the porn_bot AI auto-publish path (conf ≥0.95) also respects the
//     high-follower guard
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
const ruleDefaults = { category: null, enabled: 1, note: null, created_at: 1, hit_count: 0, last_hit_at: null };
db.rules = [
  { id: 1, pattern: "visa", field: "display_name", action: "blacklist", verdict_label: "spam", ...ruleDefaults },
  { id: 2, pattern: "同城上门", field: "tweet", action: "blacklist", verdict_label: "porn_bot", category: "porn", enabled: 1, note: null, created_at: 1, hit_count: 0, last_hit_at: null },
  { id: 3, pattern: "annotationonly", field: "bio", action: "blacklist", verdict_label: "uncertain", ...ruleDefaults },
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

test("ASCII pattern needs word boundaries: 'visa' does not hit 'Visakan'", async () => {
  llmCalls = 0;
  llmContent = '{"label":"legit","confidence":0.9,"reasons":["benign"]}';
  const res = await worker.fetch(
    classify({
      userId: "700",
      handle: "visakanv",
      displayName: "Visakan Veerasamy",
      recentTweets: ["do 100 things"],
    }),
    env,
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as { matchedRule?: unknown };
  assert.equal(body.matchedRule, undefined); // substring no longer matches
  assert.equal(llmCalls, 1); // fell through to the LLM
});

test("ASCII pattern still fires on a standalone word hit", async () => {
  llmCalls = 0;
  const res = await worker.fetch(
    classify({
      userId: "701",
      handle: "cheapdocs99",
      displayName: "cheap visa & passport services",
      recentTweets: ["DM for documents"],
    }),
    env,
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as { matchedRule?: { id: number } };
  assert.equal(body.matchedRule?.id, 1);
  assert.equal(llmCalls, 0);
  const acc = db.accounts.find((a) => a.x_user_id === "701");
  assert.ok(acc);
  assert.equal(acc.status, "human_confirmed"); // low/unknown followers → publishes
});

test("blacklist rule hit on a known ≥100k-follower account queues instead of publishing", async () => {
  llmCalls = 0;
  const res = await worker.fetch(
    classify({
      userId: "702",
      handle: "bigcjkaccount",
      displayName: "同城资源小姐姐",
      followersCount: 150_000,
      recentTweets: ["同城上门服务，看主页"],
    }),
    env,
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as { matchedRule?: { id: number }; record?: { status: string } };
  assert.equal(body.matchedRule?.id, 2); // rule still matched (audit intact)
  assert.equal(body.record?.status, "auto_pending_review"); // but no publish
  const acc = db.accounts.find((a) => a.x_user_id === "702");
  assert.ok(acc);
  assert.equal(acc.status, "auto_pending_review");
  assert.equal(acc.published_tier ?? null, null);
});

test("blacklist rule with a non-spam verdict label can never publish", async () => {
  llmCalls = 0;
  const res = await worker.fetch(
    classify({
      userId: "703",
      handle: "annotated1",
      displayName: "Somebody",
      bio: "annotationonly marker here",
      recentTweets: ["hello"],
    }),
    env,
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as { record?: { status: string } };
  assert.equal(body.record?.status, "auto_pending_review");
  const acc = db.accounts.find((a) => a.x_user_id === "703");
  assert.ok(acc);
  assert.equal(acc.status, "auto_pending_review");
  assert.equal(acc.published_tier ?? null, null);
});

test("porn_bot AI auto-publish (conf ≥0.95) respects the high-follower guard", async () => {
  llmCalls = 0;
  llmContent = '{"label":"porn_bot","confidence":0.97,"reasons":["solicitation"],"category":"porn"}';
  const res = await worker.fetch(
    classify({
      userId: "704",
      handle: "bigcreator",
      displayName: "big creator",
      followersCount: 500_000,
      recentTweets: ["check my page"],
    }),
    env,
  );
  assert.equal(res.status, 200);
  assert.equal(llmCalls, 1);
  const acc = db.accounts.find((a) => a.x_user_id === "704");
  assert.ok(acc);
  assert.equal(acc.status, "auto_pending_review"); // would have auto-published pre-guard
  assert.equal(acc.published_tier ?? null, null);
});

test("porn_bot AI auto-publish still fires for a low-follower account", async () => {
  llmCalls = 0;
  llmContent = '{"label":"porn_bot","confidence":0.97,"reasons":["solicitation"],"category":"porn"}';
  const res = await worker.fetch(
    classify({
      userId: "705",
      handle: "tinybot123",
      displayName: "dm me",
      followersCount: 12,
      recentTweets: ["check my page"],
    }),
    env,
  );
  assert.equal(res.status, 200);
  const acc = db.accounts.find((a) => a.x_user_id === "705");
  assert.ok(acc);
  assert.equal(acc.status, "human_confirmed");
  assert.equal(acc.published_tier, "ai");
});

test("production policy keeps a low-follower AI verdict in review", async () => {
  llmCalls = 0;
  llmContent = '{"label":"porn_bot","confidence":0.97,"reasons":["solicitation"],"category":"porn"}';
  const res = await worker.fetch(
    classify({
      userId: "706",
      handle: "policyqueue706",
      displayName: "dm me",
      followersCount: 12,
      recentTweets: ["check my page"],
    }),
    { ...env, AI_AUTO_PUBLISH_ENABLED: "0" },
  );
  assert.equal(res.status, 200);
  const acc = db.accounts.find((a) => a.x_user_id === "706");
  assert.ok(acc);
  assert.equal(acc.status, "auto_pending_review");
  assert.equal(acc.published_tier ?? null, null);
});
