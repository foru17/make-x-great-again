// Read-only diagnostic, deliberately red until withdrawn verdicts stop resurfacing.
// Run: node_modules/.bin/tsx scripts/diagnostics/terminal-verdict-replay.ts
// Uses the real Worker route and client classifier; all I/O is local and mocked.
import assert from "node:assert/strict";
import worker from "../../services/edge/src/index";
import { classifyAndCache, onlineVerdictVisibility } from "../../extension/lib/online-detection";
import type { Cached } from "../../extension/lib/cache";

const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error("Network forbidden in this diagnostic"); };
const failures: string[] = [];

try {
  for (const status of ["removed", "rejected", "whitelisted"] as const) {
    const stored = {
      rowid: 1,
      handle: "audit_fixture",
      x_user_id: null,
      status,
      verdict_label: "spam",
      confidence: 0.9,
      reasons: '["historical verdict withdrawn by moderation"]',
      model: "fixture",
      signals_hash: "different-old-input",
      last_scored: 1,
      followers_count: null,
    };
    let queries = 0;
    const DB = {
      prepare(sql: string) {
        assert.ok(++queries <= 4, "local query cap");
        return {
          bind() { return this; },
          async first() {
            assert.match(sql, /FROM accounts/);
            return stored;
          },
          async all() {
            assert.match(sql, /FROM keyword_rules/);
            return { results: [] };
          },
          async run() { throw new Error("Unexpected database mutation"); },
        };
      },
    };
    const writes: Cached[] = [];
    const result = await classifyAndCache("h:audit_fixture", {
      isProfile: false,
      handle: "audit_fixture",
      displayName: "Audit fixture",
      bio: "",
      hasDefaultAvatar: false,
      triggeringComment: "An ordinary conversation with no advertising.",
      recentTweets: ["An ordinary conversation with no advertising."],
    }, {
      send: async (message) => {
        if (message.type !== "classify") throw new Error("Unexpected background request");
        const response = await worker.fetch(new Request("https://local.invalid/v1/classify", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(message.sig),
        }), { DB, AI_AUTO_PUBLISH_ENABLED: "0" } as never, {} as never);
        assert.equal(response.status, 200);
        return { ok: true, data: { status: response.status, body: await response.json() } };
      },
      writeCache: async (_key, entry) => { writes.push(entry); },
      now: () => 1788482400000,
    });
    const visible = result.status === "classified" && onlineVerdictVisibility(result.verdict) === "badge";
    const storedSpam = writes.some((entry) => ["spam", "porn_bot", "likely_spam"].includes(entry.verdict.label));
    console.log(JSON.stringify({ status, result, cacheWrites: writes.length, visible, storedSpam, queries }));
    if (visible || storedSpam) failures.push(`${status}: withdrawn verdict displayed and/or re-cached`);
  }
} finally {
  globalThis.fetch = originalFetch;
}

assert.deepEqual(failures, [], "Withdrawn verdicts must not become fresh client warnings");
