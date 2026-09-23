import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import worker from "../src/index";

// Real SQLite executes the Worker's queries; a substring-aware mock would
// conceal precisely the SQL/JavaScript mismatch this regression covers.
class DB {
  sqlite = new DatabaseSync(":memory:");
  constructor() {
    this.sqlite.exec(readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
    this.sqlite.exec(
      readFileSync(new URL("../migrations/2026-05-27-agent-pipeline.sql", import.meta.url), "utf8"),
    );
  }
  prepare(sql: string) {
    const stmt = this.sqlite.prepare(sql);
    let args: any[] = [];
    const wrapped = {
      bind(...values: any[]) {
        args = values;
        return wrapped;
      },
      async first() {
        return stmt.get(...args) ?? null;
      },
      async all() {
        return { results: stmt.all(...args) };
      },
      async run() {
        const r = stmt.run(...args);
        return { meta: { changes: Number(r.changes) } };
      },
    };
    return wrapped;
  }
  async batch(stmts: ReturnType<DB["prepare"]>[]) {
    const results = [];
    for (const statement of stmts) results.push(await statement.run());
    return results;
  }
}
const plain = "我福不黑";
const hidden = "\u2060\u2060\u200c我福\u2060\u200c不\u200d\u200c黑\u2060\u200c\u2060\u2060";
const db = new DB();
const env = { DB: db, ADMIN_TOKEN: "fixture" } as any;
function seed(handle: string, text: string, status = "auto_pending_review") {
  db.sqlite
    .prepare(
      `INSERT INTO accounts(handle,display_name,evidence_text,verdict_label,confidence,status,first_seen,last_scored) VALUES (?,?,?,'spam',1,?,1,1)`,
    )
    .run(handle, text, text, status);
}
seed("plain", plain);
seed("hidden", hidden);
seed("split", "我\u200b福不\ufeff黑");
seed("unrelated", "我福很好");
async function get(path: string, body?: object) {
  const response = await worker.fetch(
    new Request(`https://test.invalid${path}`, {
      method: body ? "POST" : "GET",
      headers: { "x-admin-token": "fixture", "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    }),
    env,
  );
  assert.equal(response.status, 200);
  return response.json() as Promise<any>;
}
test("queue search finds all visible-equivalent terms, with accurate count and pagination", async () => {
  for (const q of [plain, hidden]) {
    const first = await get(
      `/v1/admin/queue?${new URLSearchParams({ q, total: "1", limit: "2" })}`,
    );
    assert.equal(first.total, 3);
    assert.equal(first.queue.length, 2);
    const second = await get(
      `/v1/admin/queue?${new URLSearchParams({ q, offset: "2", limit: "2" })}`,
    );
    assert.equal(new Set([...first.queue, ...second.queue].map((r) => r.handle)).size, 3);
  }
});
test("structured filters and batch dry-run share visible-text search", async () => {
  for (const key of ["display_name", "evidence"]) {
    const result = await get(
      `/v1/admin/queue?${new URLSearchParams({ [key]: hidden, total: "1" })}`,
    );
    assert.equal(result.total, 3);
  }
  const result = await get("/v1/admin/decide-by-filter", {
    action: "approve",
    dryRun: true,
    filters: { q: hidden },
  });
  assert.equal(result.matched, 3);
});
test("blacklist search normalizes stored names and query", async () => {
  seed("listed", hidden, "human_confirmed");
  const result = await get(`/v1/admin/blacklist?${new URLSearchParams({ q: plain, total: "1" })}`);
  assert.equal(result.total, 1);
});
test("rule preview sees invisible-character variants", async () => {
  const result = await get("/v1/admin/keyword-rules/preview", {
    pattern: plain,
    field: "display_name",
  });
  assert.equal(result.count, 3);
});
test("queue sweep reaches invisible-character variants through its SQL prefilter", async () => {
  await get("/v1/admin/keyword-rules", {
    pattern: plain,
    field: "display_name",
    action: "reject",
    verdict_label: "spam",
  });
  const result = await get("/v1/admin/keyword-rules/apply-to-queue", {});
  assert.equal(result.matched, 3);
});

test("preview and sweep agree on literal text, ASCII boundaries and evidence fields", async () => {
  seed("word_hit", "Get VI\u200bSA now");
  seed("word_false", "Vi\u2060sakan");
  seed("reason_only", "ordinary");
  db.sqlite
    .prepare("UPDATE accounts SET reasons=? WHERE handle='reason_only'")
    .run('["no visa solicitation"]');
  const result = await get("/v1/admin/keyword-rules/preview", { pattern: "visa", field: "any" });
  assert.equal(result.count, 1);
  seed("percent_hit", "50% off");
  seed("percent_false", "50 dollars off");
  assert.equal(
    (await get("/v1/admin/keyword-rules/preview", { pattern: "50%", field: "display_name" })).count,
    1,
  );
  await get("/v1/admin/keyword-rules", {
    pattern: "visa",
    field: "any",
    action: "reject",
    verdict_label: "spam",
  });
  assert.equal((await get("/v1/admin/keyword-rules/apply-to-queue", {})).matched, 1);
});
test("Unicode case variants cannot be discarded by SQL before rule matching", async () => {
  seed("cyrillic", "ПРИ\u2060ВЕТ");
  assert.equal(
    (await get("/v1/admin/keyword-rules/preview", { pattern: "привет", field: "display_name" }))
      .count,
    1,
  );
  await get("/v1/admin/keyword-rules", {
    pattern: "привет",
    field: "display_name",
    action: "reject",
    verdict_label: "spam",
  });
  assert.equal((await get("/v1/admin/keyword-rules/apply-to-queue", {})).matched, 1);
});
