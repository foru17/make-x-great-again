// Review-queue split (2026-09-06).
//
// The maintainer queue is for SUSPECTED spam. Routing every non-high-
// confidence verdict there made 80.87% of the 24h queue legit/uncertain
// labels (2026-09-04 audit) and buried the real false positives. Now:
//   - legit at ANY confidence → auto_legit (never queued)
//   - uncertain → auto_unsure (never queued, short TTL, rule-overridable)
//   - spam-family labels → auto_pending_review (queued)
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

class MockDB {
  inserted: { status: string; label: string }[] = [];
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
        return null; // no prior row, no bans, no witnesses
      },
      async all<T>(): Promise<{ results?: T[] }> {
        return { results: [] as T[] };
      },
      async run() {
        if (sql.includes("INSERT INTO accounts")) {
          // Column order mirrors writeAccount's INSERT (see
          // handle-only-corroboration.test.ts): label at 8, status at 13.
          db.inserted.push({ label: args[8] as string, status: args[13] as string });
          return { meta: { changes: 1, last_row_id: db.inserted.length } };
        }
        return { meta: { changes: 1 } };
      },
    };
  }
  async batch(stmts: Array<{ run(): Promise<unknown> }>) {
    return Promise.all(stmts.map((s) => s.run()));
  }
}

let llmContent = "";
globalThis.fetch = async (input: string | URL | Request) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url === "https://api.github.com/user") {
    return Response.json({ id: 42, created_at: "2015-01-01T00:00:00Z" });
  }
  if (url.startsWith("https://llm.invalid")) {
    return Response.json({ choices: [{ message: { content: llmContent } }] });
  }
  return originalFetch(input as Request);
};

let db = new MockDB();
let env: Record<string, unknown>;
beforeEach(() => {
  db = new MockDB();
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

function classify(handle: string): Request {
  return new Request("https://x.test/v1/classify", {
    method: "POST",
    headers: { authorization: "Bearer user-42-token", "content-type": "application/json" },
    body: JSON.stringify({
      handle,
      displayName: "Someone",
      triggeringComment: "请更新 Antigravity IDE，谢谢",
      recentTweets: [],
    }),
  });
}

const cases: Array<[string, string, string]> = [
  ['{"label":"legit","confidence":0.55,"reasons":["ordinary request"]}', "legit", "auto_legit"],
  ['{"label":"legit","confidence":0.95,"reasons":["ordinary request"]}', "legit", "auto_legit"],
  ['{"label":"uncertain","confidence":0.4,"reasons":["too little"]}', "uncertain", "auto_unsure"],
  [
    '{"label":"likely_spam","confidence":0.6,"reasons":["maybe"],"category":"marketing"}',
    "likely_spam",
    "auto_pending_review",
  ],
  ['{"label":"spam","confidence":0.9,"reasons":["bait"],"category":"marketing"}', "spam", "auto_pending_review"],
];

for (const [content, label, status] of cases) {
  test(`${label} → ${status}`, async () => {
    llmContent = content;
    const res = await worker.fetch(classify(`u_${label}`), env); // ≤15 chars
    assert.equal(res.status, 200);
    const body = (await res.json()) as { record: { status: string; verdict: { label: string } } };
    assert.equal(body.record.verdict.label, label);
    assert.equal(body.record.status, status);
    assert.deepEqual(db.inserted, [{ label, status }]);
  });
}
