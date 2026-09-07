import assert from "node:assert/strict";
import test from "node:test";
import { edgeBase } from "../lib/list-sync";
import { postOnlineClassification } from "../lib/online-detection";
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  backupFileName,
  exportBackup,
  importBackup,
  parseBackup,
  sanitizeSettings,
} from "../lib/backup";

function installChrome(seed: Record<string, unknown> = {}) {
  const root = globalThis as unknown as { chrome?: unknown };
  const previous = root.chrome;
  const bag: Record<string, unknown> = { ...seed };
  root.chrome = {
    runtime: { getManifest: () => ({ version: "0.6.1" }) },
    storage: {
      local: {
        get: async (k: string | string[] | null) => {
          if (k === null) return { ...bag };
          const keys = Array.isArray(k) ? k : [k];
          return Object.fromEntries(keys.map((x) => [x, bag[x]]));
        },
        set: async (obj: Record<string, unknown>) => Object.assign(bag, obj),
      },
      onChanged: { addListener: () => {}, removeListener: () => {} },
    },
  };
  return {
    bag,
    restore() {
      if (previous === undefined) delete root.chrome;
      else root.chrome = previous;
    },
  };
}

const SEED = {
  "xss:settings": { actionMode: "mute", followingWhitelist: false, categoryActions: { porn: "hide" } },
  "xss:whitelist:local": { entries: [{ handle: "friend_one", userId: "2001", source: "following", addedAt: 5 }] },
  "xss:rules:custom": [{ pattern: "my-scam", field: "bio", category: "crypto" }],
  "xss:rules:disabled": ["约炮"],
  "xss:blocked": ["1001", "h:spammer"],
  "xss:blocklist:v2": [{ id: "1001", handle: "bot1001", source: "auto", ts: 7, verdict: { label: "spam", confidence: 0.9, reasons: ["x"] } }],
  "xss:stats": { detections: 10, cacheHits: 4, blocks: 3, byLabel: { spam: 2 } },
  mxga_stats_v1: { scanned: 100, hitPublic: 5, blocked: 3, firstUsedAt: 1000 },
  "xss:v1:1001": { verdict: { label: "spam", confidence: 0.9, reasons: [] }, signalsHash: "h", model: "m", ts: 9, handle: "bot1001" },
  "xss:ghToken": "SECRET-TOKEN",
  "xss:ghLogin": "me",
  "xss:list:v2": { entries: [["1", "x", "pph"]] },
  "xss:rulehits:v1": { queue: [{ p: "x" }] },
};

test("export carries the user's own data and nothing secret", async () => {
  const env = installChrome(SEED);
  try {
    const f = await exportBackup({ includeCache: true });
    assert.equal(f.format, BACKUP_FORMAT);
    assert.equal(f.version, BACKUP_VERSION);
    assert.equal(f.extensionVersion, "0.6.1");
    const text = JSON.stringify(f);
    assert.ok(!text.includes("SECRET-TOKEN"), "GitHub token must never be exported");
    assert.ok(!text.includes("ghLogin") && !text.includes("rulehits") && !text.includes("xss:list"));
    assert.equal(f.data.settings?.actionMode, "mute");
    assert.equal(f.data.localWhitelist?.[0]?.handle, "friend_one");
    assert.deepEqual(f.data.customRules, [{ pattern: "my-scam", field: "bio", category: "crypto" }]);
    assert.deepEqual(f.data.disabledRules, ["约炮"]);
    assert.deepEqual(new Set(f.data.hidden?.ids), new Set(["1001", "h:spammer"]));
    assert.equal(f.data.hidden?.records.length, 1);
    assert.equal(f.data.stats?.detections, 10);
    assert.equal(f.data.stats?.scanned, 100);
    assert.equal(Object.keys(f.data.cache ?? {}).length, 1);
    const lean = await exportBackup();
    assert.equal(lean.data.cache, undefined, "cache is opt-in");
    const d = new Date(2026, 8, 7, 9, 5); // local time 2026-09-07 09:05
    assert.equal(backupFileName(d), "mxga-2026-09-07-0905-export.json");
  } finally {
    env.restore();
  }
});

test("parse rejects junk, strips unknown/off-enum values, keeps the rest", () => {
  assert.equal(parseBackup("not json").ok, false);
  assert.equal(parseBackup(JSON.stringify({ format: "other" })).ok, false);
  assert.equal(parseBackup(JSON.stringify({ format: BACKUP_FORMAT, version: 99 })).ok, false);
  const r = parseBackup(
    JSON.stringify({
      format: BACKUP_FORMAT,
      version: 1,
      data: {
        settings: { actionMode: "nuke", autoScope: "all", evil: true, edgeBase: "javascript:alert(1)", categoryActions: { porn: "block", bogus: "block" } },
        localWhitelist: [{ handle: "ok_one", source: "manual" }, { handle: "bad handle" }],
        customRules: [{ pattern: "x", field: "bio", category: "porn" }, { pattern: "", field: "bio", category: "porn" }],
        disabledRules: ["a", 5, "a"],
        hidden: { ids: ["123", "h:good", "nope!"], records: [{ id: "123", handle: "good", source: "weird", ts: "x" }] },
        cache: { "123": { verdict: { label: "spam", confidence: 2, reasons: [] }, ts: 1 }, "bad key!": { verdict: { label: "spam", confidence: 1, reasons: [] }, ts: 1 } },
      },
    }),
  );
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.deepEqual(r.file.data.settings, { autoScope: "all", categoryActions: { porn: "block", crypto: "badge", gambling: "badge", resource: "badge", marketing: "badge", other: "badge" } });
  assert.equal(r.summary.localWhitelist, 1);
  assert.equal(r.summary.customRules, 1);
  assert.equal(r.summary.disabledRules, 1);
  assert.equal(r.summary.hiddenIds, 2);
  assert.equal(r.file.data.hidden?.records[0]?.source, "manual");
  assert.equal(typeof r.file.data.hidden?.records[0]?.ts, "number");
  assert.equal(r.summary.cache, 1);
  assert.equal(r.file.data.cache?.["123"]?.verdict.confidence, 1, "confidence clamped");
  assert.deepEqual(sanitizeSettings({ edgeBase: "https://staging.example" }), {});
});

test("a backup cannot redirect authenticated requests or export endpoint credentials", async () => {
  const env = installChrome({
    ...SEED,
    "xss:settings": { edgeBase: "https://trusted.example", legacySecret: "PRIVATE-SETTING" },
  });
  try {
    const parsed = parseBackup(JSON.stringify({
      format: BACKUP_FORMAT, version: 1,
      data: { settings: { edgeBase: "https://untrusted.example", enabled: true } },
    }));
    assert.ok(parsed.ok);
    await importBackup(parsed.file, "merge");
    let destination = "";
    await postOnlineClassification({
      base: await edgeBase(), token: "TEST-ONLY-TOKEN",
      sig: { isProfile: false, handle: "fixture", displayName: "Fixture", bio: "", recentTweets: [], hasDefaultAvatar: false },
      fetcher: (async (url) => {
        destination = String(url);
        return new Response("{}", { status: 200 });
      }) as typeof fetch,
    });
    assert.equal(destination, "https://trusted.example/v1/classify");
    env.bag["xss:settings"] = { edgeBase: "https://user:PRIVATE-ENDPOINT@trusted.example", legacySecret: "PRIVATE-SETTING" };
    const exported = JSON.stringify(await exportBackup());
    assert.ok(!exported.includes("PRIVATE-"), "export only portable, known preference keys");
  } finally {
    env.restore();
  }
});

test("import merge unions lists and sums counters; replace overwrites; excluded keys untouched", async () => {
  const env = installChrome(SEED);
  try {
    const incoming = {
      format: BACKUP_FORMAT,
      version: 1,
      data: {
        settings: { actionMode: "local" },
        localWhitelist: [{ handle: "friend_one", source: "manual", addedAt: 1 }, { handle: "new_pal", source: "manual", addedAt: 2 }],
        customRules: [{ pattern: "my-scam", field: "bio", category: "crypto" }, { pattern: "other", field: "tweet", category: "porn" }],
        disabledRules: ["约炮", "看主页"],
        hidden: { ids: ["1001", "2002"], records: [{ id: "2002", handle: "bot2002", source: "manual", ts: 3 }] },
        stats: { detections: 5, cacheHits: 1, blocks: 2, byLabel: { spam: 1, porn_bot: 4 }, scanned: 50, hitPublic: 1, blocked: 2, firstUsedAt: 500 },
        cache: { "1001": { verdict: { label: "legit", confidence: 1, reasons: [] }, signalsHash: "n", model: "m", ts: 99 }, "3003": { verdict: { label: "spam", confidence: 0.9, reasons: [] }, signalsHash: "n", model: "m", ts: 99 } },
      },
    };
    const parsed = parseBackup(JSON.stringify(incoming));
    assert.ok(parsed.ok);
    if (!parsed.ok) return;
    const applied = await importBackup(parsed.file, "merge");
    assert.equal(applied.localWhitelist, 1);
    assert.equal(applied.customRules, 1);
    assert.equal(applied.disabledRules, 1);
    assert.equal(applied.hiddenIds, 1);
    assert.equal(applied.hiddenRecords, 1);
    assert.equal(applied.cache, 1, "existing cache entry is not overwritten in merge");
    const wl = (env.bag["xss:whitelist:local"] as { entries: { handle: string; source: string; userId?: string }[] }).entries;
    assert.deepEqual(wl.map((e) => [e.handle, e.source, e.userId]), [["friend_one", "manual", "2001"], ["new_pal", "manual", undefined]]);
    assert.deepEqual(new Set(env.bag["xss:blocked"] as string[]), new Set(["1001", "h:spammer", "2002"]));
    assert.equal((env.bag["xss:blocklist:v2"] as unknown[]).length, 2);
    assert.deepEqual(env.bag["xss:stats"], { detections: 15, cacheHits: 5, blocks: 5, byLabel: { spam: 3, porn_bot: 4 } });
    assert.deepEqual(env.bag.mxga_stats_v1, { scanned: 150, hitPublic: 6, blocked: 5, firstUsedAt: 500 });
    assert.equal((env.bag["xss:settings"] as { actionMode: string; followingWhitelist: boolean }).actionMode, "local");
    assert.equal((env.bag["xss:settings"] as { followingWhitelist: boolean }).followingWhitelist, false, "untouched keys survive");
    assert.equal((env.bag["xss:v1:1001"] as { verdict: { label: string } }).verdict.label, "spam");
    assert.equal(env.bag["xss:ghToken"], "SECRET-TOKEN");
    assert.deepEqual(env.bag["xss:list:v2"], SEED["xss:list:v2"]);

    const replaced = await importBackup(parsed.file, "replace", { stats: false });
    assert.equal(replaced.localWhitelist, 2);
    assert.deepEqual((env.bag["xss:whitelist:local"] as { entries: { handle: string }[] }).entries.map((e) => e.handle), ["friend_one", "new_pal"]);
    assert.deepEqual(new Set(env.bag["xss:blocked"] as string[]), new Set(["1001", "2002"]));
    assert.deepEqual(env.bag["xss:rules:disabled"], ["约炮", "看主页"]);
    assert.deepEqual(env.bag["xss:stats"], { detections: 15, cacheHits: 5, blocks: 5, byLabel: { spam: 3, porn_bot: 4 } }, "stats section skipped");
  } finally {
    env.restore();
  }
});
