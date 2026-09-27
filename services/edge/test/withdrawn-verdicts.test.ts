// Withdrawn verdicts must not resurface (2026-09-04 audit, root cause #4).
//
// A moderator's `removed` (taken off the list after an appeal) or `rejected`
// (report declined) is terminal, yet the row keeps the ORIGINAL spam verdict
// and /v1/classify used to echo it back — so every client that asked about an
// appealed account re-badged it and re-cached the spam label for 30 days.
//
// Covers:
//   - removed / rejected → legit + the status, no LLM call
//   - whitelisted keeps its existing short-circuit
//   - a live auto_pending_review spam row is still served as-is (control)
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";

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
  followers_count: number | null;
  signals_hash: string | null;
  last_scored: number;
  reasons: string | null;
  model: string | null;
}

let llmCalls = 0;
class MockDB {
  accounts: Account[] = [];
  writes = 0;
  prepare(sql: string) {
    const db = this;
    let args: unknown[] = [];
    return {
      bind(...a: unknown[]) {
        args = a;
        return this;
      },
      async first<T>(): Promise<T | null> {
        if (sql.includes("FROM rate_log")) return { n: 0 } as T;
        if (sql.includes("FROM reporter_bans")) return null;
        if (sql.includes("FROM classify_witness")) return { n: 0 } as T;
        if (sql.includes("FROM accounts")) {
          if (sql.includes("WHERE x_user_id=?")) {
            return (db.accounts.find((a) => a.x_user_id === args[0]) as T | undefined) ?? null;
          }
          const handle = args[0] as string;
          return (
            (db.accounts.find((a) => a.handle.toLowerCase() === handle) as T | undefined) ?? null
          );
        }
        return null;
      },
      async all<T>(): Promise<{ results?: T[] }> {
        return { results: [] as T[] };
      },
      async run() {
        // Signal-snapshot refreshes and rate-log rows are fine; anything that
        // would rewrite the verdict is what this test guards against.
        if (sql.includes("verdict_label")) db.writes += 1;
        return { meta: { changes: 1 } };
      },
    };
  }
  async batch(stmts: Array<{ run(): Promise<unknown> }>) {
    return Promise.all(stmts.map((s) => s.run()));
  }
}

globalThis.fetch = async (input: string | URL | Request) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url === "https://api.github.com/user") {
    return Response.json({ id: 42, created_at: "2015-01-01T00:00:00Z" });
  }
  if (url.startsWith("https://llm.invalid")) {
    llmCalls += 1;
    return Response.json({
      choices: [{ message: { content: '{"label":"spam","confidence":0.9,"reasons":["x"]}' } }],
    });
  }
  return originalFetch(input as Request);
};

let db = new MockDB();
let env: Record<string, unknown>;
beforeEach(() => {
  db = new MockDB();
  llmCalls = 0;
  env = {
    DB: db,
    REPORT_SALT: "test-report-salt",
    REQUIRE_AUTH: "1",
    AI_AUTO_PUBLISH_ENABLED: "0",
    LLM_API_BASE: "https://llm.invalid",
    LLM_API_KEY: "test",
    LLM_API_MODEL: "test-model",
  };
});

function seed(status: string): Account {
  const row: Account = {
    rowid: 1,
    handle: "appealed_user",
    x_user_id: "9001",
    status,
    verdict_label: "spam",
    confidence: 0.9,
    followers_count: 120,
    signals_hash: "stale-hash",
    last_scored: 1,
    reasons: '["historical verdict"]',
    model: "fixture",
  };
  db.accounts.push(row);
  return row;
}

function classify(body: Record<string, unknown>): Request {
  return new Request("https://x.test/v1/classify", {
    method: "POST",
    headers: { authorization: "Bearer user-42-token", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const payload = {
  handle: "appealed_user",
  userId: "9001",
  displayName: "Appealed",
  recentTweets: ["an ordinary tweet"],
  triggeringComment: "an ordinary tweet",
};

for (const status of ["removed", "rejected"] as const) {
  test(`${status}: served as legit with the status, no LLM, no verdict rewrite`, async () => {
    seed(status);
    const res = await worker.fetch(classify(payload), env);
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      cached: boolean;
      record: { verdict: { label: string; confidence: number }; status: string };
    };
    assert.equal(body.cached, true);
    assert.equal(body.record.status, status);
    assert.equal(body.record.verdict.label, "legit");
    assert.equal(body.record.verdict.confidence, 1);
    assert.equal(llmCalls, 0);
    assert.equal(db.writes, 0);
    assert.equal(db.accounts[0]?.status, status, "terminal status untouched");
  });
}

test("whitelisted keeps its short-circuit", async () => {
  seed("whitelisted");
  const body = (await (await worker.fetch(classify(payload), env)).json()) as {
    record: { verdict: { label: string }; status: string };
  };
  assert.equal(body.record.status, "whitelisted");
  assert.equal(body.record.verdict.label, "legit");
  assert.equal(llmCalls, 0);
});

test("control: a live pending spam row is still served as spam", async () => {
  seed("auto_pending_review");
  db.accounts[0]!.last_scored = Date.now(); // fresh per RESCORE_TTL → cache path
  const body = (await (await worker.fetch(classify(payload), env)).json()) as {
    record: { verdict: { label: string }; status: string };
  };
  assert.equal(body.record.status, "auto_pending_review");
  assert.equal(body.record.verdict.label, "spam");
  assert.equal(llmCalls, 0);
});
