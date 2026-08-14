// User-facing rule config: official master switch, per-rule disables and
// custom local rules (matchLocalRules), plus the anonymous rule-hit telemetry
// queue (rule-telemetry). chrome.storage is mocked with a live in-memory map
// so the read-modify-write paths run for real.
import assert from "node:assert/strict";
import test from "node:test";
import {
  matchLocalRules,
  setCustomRules,
  setDisabledPatterns,
  setLocalRules,
  setOfficialRulesEnabled,
  validateCustomRules,
} from "../lib/local-rules";
import type { Signals } from "../lib/types";

const sig = (over: Partial<Signals> = {}): Signals => ({
  isProfile: false,
  handle: "SpamBot1",
  displayName: "普通昵称",
  bio: "",
  hasDefaultAvatar: false,
  recentTweets: [],
  ...over,
});

function resetRules() {
  setLocalRules([["约炮", "d", "pp"]]);
  setCustomRules([]);
  setDisabledPatterns([]);
  setOfficialRulesEnabled(true);
}

test("official master switch gates official rules but not custom rules", () => {
  resetRules();
  setCustomRules([{ pattern: "my-scam-word", field: "bio", category: "crypto" }]);
  const spam = sig({ displayName: "同城约炮", bio: "my-scam-word inside" });

  let hit = matchLocalRules(spam);
  assert.equal(hit?.origin, "official");
  assert.equal(hit?.pattern, "约炮");

  setOfficialRulesEnabled(false);
  hit = matchLocalRules(spam);
  assert.equal(hit?.origin, "custom");
  assert.equal(hit?.pattern, "my-scam-word");
  assert.equal(hit?.label, "spam");
  assert.equal(hit?.category, "crypto");
});

test("per-rule disable suppresses exactly that official pattern", () => {
  resetRules();
  setLocalRules([
    ["约炮", "d", "pp"],
    ["资源自取", "d", "sr"],
  ]);
  setDisabledPatterns(["约炮"]);
  assert.equal(matchLocalRules(sig({ displayName: "同城约炮" })), null);
  const still = matchLocalRules(sig({ displayName: "资源自取看主页" }));
  assert.equal(still?.pattern, "资源自取");
});

test("custom porn rules map to porn_bot and respect the translate guard", () => {
  resetRules();
  setCustomRules([{ pattern: "涩涩暗号", field: "tweet", category: "porn" }]);
  const hit = matchLocalRules(sig({ recentTweets: ["来找涩涩暗号"] }));
  assert.equal(hit?.origin, "custom");
  assert.equal(hit?.label, "porn_bot");
  // Same CJK-pattern translate guard as official rules.
  assert.equal(
    matchLocalRules(sig({ recentTweets: ["来找涩涩暗号"], tweetsTranslated: true })),
    null,
  );
});

test("validateCustomRules drops malformed rows, dupes and over-cap input", () => {
  const clean = validateCustomRules([
    { pattern: " ok ", field: "bio", category: "porn" },
    { pattern: "OK", field: "bio", category: "porn" }, // dupe (case-insensitive)
    { pattern: "", field: "bio", category: "porn" },
    { pattern: "x".repeat(201), field: "bio", category: "porn" },
    { pattern: "bad-field", field: "everything", category: "porn" },
    { pattern: "bad-cat", field: "bio", category: "nope" },
    "not-an-object",
  ]);
  assert.deepEqual(clean, [{ pattern: "ok", field: "bio", category: "porn" }]);
});

// ---- telemetry queue ----

function mockChrome() {
  const store = new Map<string, unknown>();
  const root = globalThis as unknown as { chrome?: unknown };
  const previous = root.chrome;
  root.chrome = {
    storage: {
      local: {
        get: async (keys: string | string[]) => {
          const list = Array.isArray(keys) ? keys : [keys];
          return Object.fromEntries(list.map((k) => [k, store.get(k)]));
        },
        set: async (obj: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(obj)) store.set(k, v);
        },
      },
    },
  };
  return {
    store,
    restore: () => {
      if (previous === undefined) delete root.chrome;
      else root.chrome = previous;
    },
  };
}

test("telemetry: enqueue dedups, respects the setting, flush posts one batch and remembers", async () => {
  const { store, restore } = mockChrome();
  const originalFetch = globalThis.fetch;
  const posts: { url: string; body: unknown }[] = [];
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    posts.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify({ ok: true, stored: 1 }), { status: 200 });
  }) as typeof fetch;
  try {
    const { enqueueRuleHit, flushRuleHits, RULE_HITS_STORE_KEY } = await import(
      "../lib/rule-telemetry"
    );

    // Toggle off → nothing queues.
    store.set("xss:settings", { ruleTelemetry: false });
    await enqueueRuleHit({ pattern: "约炮", handle: "SpamBot1" });
    assert.equal(store.get(RULE_HITS_STORE_KEY), undefined);

    store.set("xss:settings", {});
    await enqueueRuleHit({ pattern: "约炮", handle: "SpamBot1", xUserId: "123", category: "porn" });
    await enqueueRuleHit({ pattern: "约炮", handle: "spambot1" }); // dupe
    await enqueueRuleHit({ pattern: "约炮", handle: "bad handle!" }); // invalid
    let st = store.get(RULE_HITS_STORE_KEY) as { queue: unknown[] };
    assert.equal(st.queue.length, 1);

    await flushRuleHits();
    assert.equal(posts.length, 1);
    assert.match(posts[0]!.url, /\/v1\/rule-hits$/);
    assert.deepEqual(posts[0]!.body, {
      hits: [{ pattern: "约炮", handle: "SpamBot1", xUserId: "123", category: "porn" }],
    });
    st = store.get(RULE_HITS_STORE_KEY) as { queue: unknown[]; sent: Record<string, number> };
    assert.equal(st.queue.length, 0);

    // Already-sent hits do not re-queue inside the 7-day memory.
    await enqueueRuleHit({ pattern: "约炮", handle: "SPAMBOT1" });
    st = store.get(RULE_HITS_STORE_KEY) as { queue: unknown[] };
    assert.equal(st.queue.length, 0);
    // Empty queue → no extra request.
    await flushRuleHits();
    assert.equal(posts.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});

test("telemetry: a failed flush keeps the queue for the next tick", async () => {
  const { store, restore } = mockChrome();
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return new Response("upstream boom", { status: 503 });
  }) as typeof fetch;
  try {
    // Fresh module state is irrelevant here: the queue lives in storage.
    const { enqueueRuleHit, flushRuleHits, RULE_HITS_STORE_KEY } = await import(
      "../lib/rule-telemetry"
    );
    store.set("xss:settings", {});
    store.set(RULE_HITS_STORE_KEY, { queue: [], sent: {} });
    await enqueueRuleHit({ pattern: "约炮", handle: "RetryBot" });
    await flushRuleHits();
    assert.equal(calls, 1);
    const st = store.get(RULE_HITS_STORE_KEY) as { queue: unknown[] };
    assert.equal(st.queue.length, 1); // still queued, will retry on the alarm
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});
