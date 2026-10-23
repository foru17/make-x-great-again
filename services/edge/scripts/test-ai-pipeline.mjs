// Bounded local workerd + SQLite DO + D1 + loopback provider verification.
// No credentials, cloud resources, GitHub calls or real inference.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import { Miniflare, Log, LogLevel, convertV4MiniflareOptions } from "miniflare";

const temp = await mkdtemp(join(tmpdir(), "mxga-ai-local-"));
const requests = [];
let mf;
const provider = createServer(async (req, res) => {
  try {
    assert.ok(requests.length < 12, "hard mock-provider request cap");
    let body = "";
    for await (const chunk of req) { body += chunk; assert.ok(body.length < 200_000); }
    const input = JSON.parse(body);
    const singleton = !input.messages[1].content.startsWith('{"items":');
    const items = singleton ? [{ id: "single", evidence: input.messages[1].content }] : JSON.parse(input.messages[1].content).items;
    requests.push({ accounts: items.length, at: Date.now() });
    if (items.some(item => item.evidence.includes("@fx_http_failure"))) {
      res.writeHead(524, { "Content-Type": "application/json" }); res.end('{"error":"fixture upstream failure"}'); return;
    }
    if (items.some(item => item.evidence.includes("@fx_failure"))) { req.socket.destroy(); return; }
    // Deliberately reverse output ordering: IDs must determine association.
    const results = [...items].reverse().map(item => ({ id: item.id, verdict: {
      label: "legit", confidence: 0.95, reasons: ["synthetic local fixture"],
    } }));
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ id: `mock-${requests.length}`, choices: [{ message: { content: JSON.stringify(singleton ? results[0].verdict : { results }) } }],
      usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120,
        completion_tokens_details: { reasoning_tokens: 5 }, prompt_tokens_details: { cached_tokens: 30 } } }));
  } catch (error) { res.statusCode = 500; res.end(String(error)); }
});
await new Promise(resolve => provider.listen(0, "127.0.0.1", resolve));

async function start(overrides = {}) {
  return new Miniflare({ ...convertV4MiniflareOptions({
    name: "ai-fixture", modules: true, modulesRoot: temp, scriptPath: join(temp, "worker.mjs"),
    compatibilityDate: "2026-05-01", compatibilityFlags: ["nodejs_compat"],
    d1Databases: { DB: "local-ai" },
    durableObjects: { CLASSIFIER: { className: "ClassificationCoordinator", useSQLite: true } },
    log: new Log(LogLevel.ERROR),
    bindings: {
      REQUIRE_AUTH: "0", REPORT_SALT: "fixture", ADMIN_TOKEN: "fixture",
      AI_AUTO_PUBLISH_ENABLED: "0", AGENT_AUTO_BLACKLIST_ENABLED: "0",
      AI_COORDINATOR_ENABLED: "1", AI_USAGE_ENABLED: "1", AI_BATCH_ENABLED: "1",
      LLM_API_BASE: `http://127.0.0.1:${provider.address().port}`, LLM_API_KEY: "fixture", LLM_API_MODEL: "fixture",
      ...overrides,
    },
  }), resourcePersistencePath: join(temp, "storage"), isolatedResourcePersistencePath: join(temp, "isolated-storage") });
}
async function classify(handle, extra = {}) {
  return mf.dispatchFetch("http://local.invalid/v1/classify", { method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": "127.0.0.1" },
    body: JSON.stringify({ handle, recentTweets: [], ...extra }), signal: AbortSignal.timeout(15_000) });
}
try {
  await build({ entryPoints: ["src/worker.ts"], outfile: join(temp, "worker.mjs"), bundle: true,
    format: "esm", platform: "browser", target: "es2022", external: ["cloudflare:workers"], logLevel: "silent" });
  mf = await start();
  const db = (await mf.getBindings()).DB;
  for (const file of ["schema.sql", "migrations/2026-10-22-model-usage.sql"]) {
    const sql = (await readFile(file, "utf8")).replace(/--[^\n]*/g, "");
    const statements = sql.split(";").map(x => x.trim()).filter(Boolean);
    assert.ok(statements.length <= 100, "hard local schema statement cap");
    for (const statement of statements) await db.prepare(statement).run();
  }
  const t0 = Date.now();
  const concurrent = await Promise.all(Array.from({ length: 20 }, () => classify("fx_shared")));
  assert.ok(concurrent.every(r => r.status === 200), await concurrent[0].text());
  assert.equal(requests.length, 1, "cross-request single flight in actual DO runtime");
  assert.equal(requests[0].accounts, 1);
  const tailWaitMs = requests[0].at - t0;
  assert.ok(tailWaitMs >= 1800 && tailWaitMs < 5000, `2s tail dispatch (runtime tolerance): ${tailWaitMs}`);

  const handles = [];
  // At most 1000 synthetic candidate names to find 10 sharing a stable shard.
  for (let i = 0; i < 1000 && handles.length < 10; i++) {
    const handle = `fx_batch_${i}`;
    const key = createHash("sha256").update(JSON.stringify([handle])).digest("hex");
    if (parseInt(key.slice(0, 2), 16) % 4 === 0) handles.push(handle);
  }
  assert.equal(handles.length, 10);
  const t1 = Date.now();
  const batch = await Promise.all(handles.map(classify));
  assert.ok(batch.every(r => r.status === 200));
  assert.equal(requests.length, 2);
  assert.equal(requests[1].accounts, 10);
  const fullBatchWaitMs = requests[1].at - t1;
  assert.ok(fullBatchWaitMs < 2000, `full batch must not wait for tail deadline: ${fullBatchWaitMs}`);
  const ledger = await db.prepare("SELECT accounts,state,total_tokens,reasoning_tokens,cached_input_tokens FROM model_usage ORDER BY started_at").all();
  assert.deepEqual(ledger.results.map(r => [r.accounts,r.state,r.total_tokens,r.reasoning_tokens,r.cached_input_tokens]), [[1,"response",120,5,30],[10,"response",120,5,30]]);
  const admitted = await db.prepare("SELECT SUM(count) n FROM contrib_actives WHERE kind='classify_anon'").first();
  assert.equal(admitted.n, 11, "20 identical viewers reserve one logical operation");
  const admin = await mf.dispatchFetch("http://local.invalid/v1/admin/ai-usage", { headers: { "x-admin-token": "fixture" } });
  assert.equal(admin.status, 200);
  const stats = await admin.json();
  assert.equal(stats.list.reduce((n, r) => n + r.attempts, 0), 2);
  assert.equal(stats.list.reduce((n, r) => n + r.total_tokens, 0), 240);
  const httpFailure = await classify("fx_http_failure");
  assert.equal(httpFailure.status, 503);
  assert.equal((await httpFailure.json()).error, "model_http_error");
  const afterHttpFailure = requests.length;
  const changedEvidence = await classify("fx_http_failure", { triggeringComment: "changed context" });
  assert.equal(changedEvidence.status, 503);
  assert.equal(requests.length, afterHttpFailure, "changed evidence cannot bypass account cooldown");
  const failed = await classify("fx_failure");
  assert.equal(failed.status, 503);
  assert.equal((await failed.json()).error, "model_outcome_unknown");
  const beforeRestart = requests.length;
  await mf.dispose();
  mf = await start();
  const repeatedHttp = await classify("fx_http_failure", { triggeringComment: "yet another context" });
  assert.equal(repeatedHttp.status, 503);
  assert.equal(requests.length, beforeRestart, "HTTP failure cooldown persists in SQLite after restart");
  const repeated = await classify("fx_failure", { triggeringComment: "new context after ambiguous submission" });
  assert.equal(repeated.status, 503);
  assert.equal(requests.length, beforeRestart, "durable unknown outcome survives runtime restart without re-send");
  const db2 = (await mf.getBindings()).DB;
  const missing = await db2.prepare("SELECT state,total_tokens FROM model_usage WHERE state='unknown'").all();
  assert.deepEqual(missing.results.map(r => [r.state,r.total_tokens]), [["unknown",null]]);
  await db2.prepare("DROP TABLE model_usage").run();
  const noLedger = await classify("fx_no_ledger");
  assert.equal(noLedger.status, 503);
  assert.equal((await noLedger.json()).error, "usage_unavailable");
  assert.equal(requests.length, beforeRestart, "missing ledger fails before any provider submission");
  await mf.dispose();
  mf = await start({ LLM_GLOBAL_MAX_PER_WINDOW: "1" });
  const denied = await classify("fx_denied");
  assert.equal(denied.status, 429);
  assert.equal(requests.length, beforeRestart, "quota remains authoritative after batching");
  console.log(JSON.stringify({ result: "PASS", runtime: "workerd", concurrentViewers: 20,
    uniqueAccounts: 11, successfulProviderCalls: 2, mockTotalTokens: 240, tailWaitMs, fullBatchWaitMs,
    accountCooldownSurvivesRestart: true, changedEvidenceCannotBypassCooldown: true, unknownOutcomeSurvivesRestart: true, missingLedgerStopsSubmission: true, quotaReturns429: true,
    realProviderCalls: 0, cloudMutations: 0 }));
} finally {
  if (mf) await mf.dispose();
  provider.closeAllConnections();
  await new Promise(resolve => provider.close(resolve));
  await rm(temp, { recursive: true, force: true });
}
