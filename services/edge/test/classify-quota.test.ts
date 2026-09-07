import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import worker from "../src/index";

// Real SQLite statements with an asynchronous D1-shaped adapter: independent
// route calls interleave at awaits, reproducing COUNT-then-INSERT races.
function database() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
  let reads = 0;
  const barriers = Array.from({ length: 2 }, () => Promise.withResolvers<void>());
  return {
    sqlite,
    prepare(sql: string) {
      let args: Array<string | number | null> = [];
      return {
        bind(...values: Array<string | number | null>) { args = values; return this; },
        async first() {
          const result = sqlite.prepare(sql).get(...args) ?? null;
          if (sql.includes("FROM rate_log") && reads < 6) {
            const barrier = barriers[Math.floor(reads / 3)];
            reads += 1;
            if (reads % 3 === 0) barrier?.resolve();
            await barrier?.promise;
          }
          return result;
        },
        async all() { return { results: sqlite.prepare(sql).all(...args) }; },
        async run() { const r = sqlite.prepare(sql).run(...args); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
      };
    },
    async batch(statements: Array<{ run(): Promise<unknown> }>) { return Promise.all(statements.map(s=>s.run())); },
  };
}

test("concurrent classifications cannot overshoot the global quota, and unavailable accounting fails closed", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (input) => {
    if (String(input) === "https://api.github.com/user") return Response.json({ id: 42, created_at: "2015-01-01T00:00:00Z" });
    assert.ok(String(input).startsWith("https://llm.invalid/"));
    assert.ok(++calls <= 4, "hard mock-provider request cap");
    return Response.json({ choices: [{ message: { content: JSON.stringify({ label: "legit", confidence: 1, reasons: ["fixture"] }) } }] });
  };
  const db = database();
  const env = { DB: db, REPORT_SALT: "fixture-salt", REQUIRE_AUTH: "1", AI_AUTO_PUBLISH_ENABLED: "0", LLM_GLOBAL_MAX_PER_WINDOW: "1", LLM_API_BASE: "https://llm.invalid", LLM_API_KEY: "fixture", LLM_API_MODEL: "fixture" };
  const classify = (handle: string) => worker.fetch(new Request("https://fixture.invalid/v1/classify", {
    method: "POST", headers: { authorization: "Bearer fixture", "content-type": "application/json" },
    body: JSON.stringify({ handle, recentTweets: [] }),
  }), env as never, {} as never);
  try {
    const responses = await Promise.all(["first", "second", "third"].map(classify));
    assert.deepEqual(responses.map(r=>r.status).sort(), [200, 429, 429]);
    assert.equal(calls, 1);
    assert.equal(db.sqlite.prepare("SELECT count(*) n FROM rate_log").get()?.n, 2, "one identity and one global reservation");
    db.sqlite.exec("DROP TABLE rate_log");
    assert.equal((await classify("no_accounting")).status, 503);
    assert.equal(calls, 1, "accounting failure cannot spend provider calls");
  } finally { globalThis.fetch = originalFetch; db.sqlite.close(); }
});
