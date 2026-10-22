import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { providerChat, reportedUsage } from "../src/model-usage";
import worker, { classifyBatch, classifyForEval } from "../src/index";

function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
  sqlite.exec(readFileSync(new URL("../migrations/2026-10-22-model-usage.sql", import.meta.url), "utf8"));
  const db = { prepare(sql: string) {
    let args: Array<string | number | null> = [];
    return { bind(...values: Array<string | number | null>) { args = values; return this; },
      async run() { sqlite.prepare(sql).run(...args); return { meta: { changes: 1 } }; },
      async first() { return sqlite.prepare(sql).get(...args) ?? null; },
      async all() { return { results: sqlite.prepare(sql).all(...args) }; },
    };
  }, async batch(statements: Array<{ run(): Promise<unknown> }>) { return Promise.all(statements.map(s => s.run())); } };
  return { sqlite, env: { DB: db, AI_USAGE_ENABLED: "1", LLM_API_BASE: "https://fixture.invalid", LLM_API_MODEL: "fixture", LLM_API_KEY: "fixture" } };
}
const meta = { operationId: "fixture-operation", entrypoint: "classify", attempt: 1, accounts: 1 };

test("usage is provider-reported only; missing totals and reasoning stay NULL", () => {
  assert.deepEqual(reportedUsage(undefined), { input: null, output: null, total: null, reasoning: null, cached: null, status: "missing" });
  assert.deepEqual(reportedUsage({ prompt_tokens: 12, completion_tokens: 3 }), { input: 12, output: 3, total: null, reasoning: null, cached: null, status: "partial" });
  assert.equal(reportedUsage({ prompt_tokens: -1, total_tokens: "3" }).total, null);
});

test("valid usage survives invalid verdict and exactly one repair attempt", async () => {
  const { sqlite, env } = fixture();
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    assert.ok(++calls <= 2);
    return Response.json({ id: `fixture-${calls}`, usage: { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130,
      completion_tokens_details: { reasoning_tokens: 20 }, prompt_tokens_details: { cached_tokens: 40 } },
      choices: [{ message: { content: calls === 1 ? "malformed" : JSON.stringify({ label: "legit", confidence: 1, reasons: ["fixture"] }) } }] });
  };
  try {
    await classifyForEval(env as never, { handle: "fixture", recentTweets: [] });
    const rows = sqlite.prepare("SELECT * FROM model_usage ORDER BY attempt").all() as Array<Record<string, unknown>>;
    assert.equal(rows.length, 2);
    assert.equal(rows[0].operation_id, rows[1].operation_id);
    assert.deepEqual(rows.map(r => r.parse_status), ["invalid", "valid"]);
    assert.deepEqual(rows.map(r => [r.input_tokens, r.output_tokens, r.total_tokens, r.reasoning_tokens, r.cached_input_tokens]), [[100,30,130,20,40],[100,30,130,20,40]]);
  } finally { globalThis.fetch = original; sqlite.close(); }
});

test("HTTP failure, invalid JSON, missing usage and ambiguous timeout remain distinct", async () => {
  const { sqlite, env } = fixture();
  let calls = 0;
  const call = (response: () => Promise<Response>) => providerChat(env as never, {}, meta, async () => { assert.ok(++calls <= 4); return response(); });
  try {
    await assert.rejects(call(async () => Response.json({ error: "fixture" }, { status: 429 })), /model_http_error/);
    await assert.rejects(call(async () => new Response("bad JSON")), /model_payload_invalid/);
    await call(async () => Response.json({ choices: [] }));
    await assert.rejects(call(async () => { throw new DOMException("timeout", "TimeoutError"); }), /model_outcome_unknown/);
    const rows = sqlite.prepare("SELECT state,usage_status,total_tokens FROM model_usage ORDER BY rowid").all();
    assert.deepEqual(rows.map(r => [r.state,r.usage_status,r.total_tokens]), [
      ["http_error","missing",null], ["response","missing",null], ["response","missing",null], ["unknown","missing",null],
    ]);
    sqlite.exec("DROP TABLE model_usage");
    await assert.rejects(call(async () => Response.json({})), /usage_unavailable/);
    assert.equal(calls, 4, "missing preflight ledger cannot spend a provider call");
  } finally { sqlite.close(); }
});

test("HTTP classify/report/confirm and scheduled category backfill use the same ledger", async () => {
  const { sqlite, env } = fixture();
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async input => {
    if (String(input) === "https://api.github.com/user") return Response.json({ id: 42, created_at: "2015-01-01T00:00:00Z" });
    assert.ok(String(input).startsWith("https://fixture.invalid/"));
    assert.ok(++calls <= 4);
    return Response.json({ usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 }, choices: [{ message: {
      content: JSON.stringify({ label: "legit", confidence: 1, reasons: ["fixture"], categories: [{ i: 0, c: "other" }] }),
    } }] });
  };
  const bindings = { ...env, REQUIRE_AUTH: "1", REPORT_SALT: "fixture", ADMIN_TOKEN: "fixture", AI_AUTO_PUBLISH_ENABLED: "0" };
  try {
    for (const path of ["classify", "report", "confirm"]) {
      const response = await worker.fetch(new Request(`https://local.invalid/v1/${path}`, { method: "POST",
        headers: { authorization: "Bearer fixture", "content-type": "application/json" },
        body: JSON.stringify({ handle: `fx_${path}`, recentTweets: [] }),
      }), bindings as never, {} as never);
      assert.equal(response.status, 200, path);
    }
    sqlite.exec("INSERT INTO accounts(handle,verdict_label,confidence,status,first_seen,last_scored) VALUES ('fixture_backfill','spam',1,'human_confirmed',1,1)");
    const pending: Promise<unknown>[] = [];
    worker.scheduled({ cron: "*/10 * * * *" } as never, bindings as never, { waitUntil(p: Promise<unknown>) { pending.push(p); } } as never);
    await Promise.all(pending);
    assert.deepEqual(sqlite.prepare("SELECT entrypoint FROM model_usage ORDER BY entrypoint").all().map(r => r.entrypoint), ["category_backfill", "classify", "confirm", "report"]);
    const summary = await worker.fetch(new Request("https://local.invalid/v1/admin/ai-usage", { headers: { "x-admin-token": "fixture" } }), bindings as never, {} as never);
    assert.equal(summary.status, 200);
    const body = await summary.json() as { list: Array<{ attempts: number; total_tokens: number }> };
    assert.equal(body.list.reduce((n,r) => n + r.attempts, 0), 4);
    assert.equal(body.list.reduce((n,r) => n + r.total_tokens, 0), 48);
    assert.equal((await worker.fetch(new Request("https://local.invalid/v1/admin/ai-usage"), bindings as never, {} as never)).status, 403);
  } finally { globalThis.fetch = original; sqlite.close(); }
});

test("post-submission ledger failure stays ambiguous and does not retry", async () => {
  const { sqlite, env } = fixture();
  let calls = 0;
  try {
    sqlite.exec("CREATE TRIGGER reject_usage_update BEFORE UPDATE ON model_usage BEGIN SELECT RAISE(ABORT,'fixture ledger failure'); END");
    await assert.rejects(providerChat(env as never, {}, meta, async () => {
      assert.ok(++calls <= 1);
      return Response.json({ usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
    }), /model_outcome_unknown/);
    assert.equal(sqlite.prepare("SELECT state FROM model_usage").get()?.state, "started", "durable intent remains available for reconciliation");
    assert.equal(calls, 1);
  } finally { sqlite.close(); }
});

test("batch repair meters physical requests once, with only unresolved account counts", async () => {
  const { sqlite, env } = fixture();
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (_input, init) => {
    assert.ok(++calls <= 2);
    const body = JSON.parse(String(init?.body));
    if (calls === 2) {
      assert.ok(!body.messages[1].content.startsWith('{"items":'), "single repair uses the original provider contract");
      return Response.json({ usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 }, choices: [{ message: {
        content: JSON.stringify({ label: "legit", confidence: 1, reasons: ["fixture"] }),
      } }] });
    }
    const items = JSON.parse(body.messages[1].content).items as Array<{ id: string }>;
    const results = (calls === 1 ? items.slice(0, 1) : items).map(item => ({ id: item.id,
      verdict: { label: "legit", confidence: 1, reasons: ["fixture"] } }));
    return Response.json({ usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 },
      choices: [{ message: { content: JSON.stringify({ results }) } }] });
  };
  try {
    const results = await classifyBatch(env as never, ["a","b"].map(id => ({ id, signals: { handle: id, recentTweets: [] } })));
    assert.ok(results.every(r => "value" in r));
    const rows = sqlite.prepare("SELECT operation_id,accounts,attempt,total_tokens,parse_status FROM model_usage ORDER BY attempt").all();
    assert.equal(rows[0].operation_id, rows[1].operation_id);
    assert.deepEqual(rows.map(r => [r.accounts,r.attempt,r.total_tokens,r.parse_status]), [[2,1,110,"invalid"],[1,2,110,"valid"]]);
  } finally { globalThis.fetch = original; sqlite.close(); }
});
