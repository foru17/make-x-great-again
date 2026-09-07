import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/index";

test("expired classifier cache cannot ignore new profile facts or rendering context", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  let row: Record<string, unknown> | null = null;
  const db = {
    prepare(sql: string) {
      let args: unknown[] = [];
      return {
        bind(...values: unknown[]) { args = values; return this; },
        async first() {
          if (sql.includes("FROM rate_log")) return { n: 0 };
          if (sql.includes("SELECT rowid, verdict_label")) return row;
          return null;
        },
        async all() { return { results: [] }; },
        async run() {
          if (sql.includes("INSERT INTO accounts")) {
            const columns = sql.match(/INSERT INTO accounts\s*\(([^)]+)\)/)?.[1]?.split(",").map(x=>x.trim()) ?? [];
            row = { rowid: 1, ...Object.fromEntries(columns.map((column,i)=>[column,args[i]])) };
          }
          return { meta: { changes: 1, last_row_id: 1 } };
        },
      };
    },
    async batch(statements: Array<{ run(): Promise<unknown> }>) { return Promise.all(statements.map(s=>s.run())); },
  };
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === "https://api.github.com/user") return Response.json({ id: 42, created_at: "2015-01-01T00:00:00Z" });
    assert.ok(url.startsWith("https://llm.invalid/"), "no live provider requests");
    assert.ok(++calls <= 4, "hard request cap");
    return Response.json({ choices: [{ message: { content: JSON.stringify({ label: "legit", confidence: 0.9, reasons: ["fixture"] }) } }] });
  };
  const env = { DB: db, REPORT_SALT: "fixture-salt", REQUIRE_AUTH: "1", AI_AUTO_PUBLISH_ENABLED: "0", LLM_API_BASE: "https://llm.invalid", LLM_API_KEY: "fixture", LLM_API_MODEL: "fixture" };
  const classify = (extra: object) => worker.fetch(new Request("https://fixture.invalid/v1/classify", {
    method: "POST", headers: { authorization: "Bearer fixture", "content-type": "application/json" },
    body: JSON.stringify({ handle: "fixture", displayName: "Fixture", bio: "", recentTweets: [], ...extra }),
  }), env as never, {} as never);
  try {
    assert.equal((await classify({})).status, 200);
    assert.ok(row);
    for (const extra of [{ followersCount: 1000 }, { surface: "thread", isReply: true }, { location: "Tokyo" }]) {
      (row as Record<string, unknown>).last_scored = Date.now() - 100 * 86_400_000;
      const response = await classify(extra);
      assert.equal(response.status, 200);
      const body = await response.json() as { cached: boolean };
      assert.equal(body.cached, false, JSON.stringify(extra));
    }
    assert.equal(calls, 4);
  } finally { globalThis.fetch = originalFetch; }
});
