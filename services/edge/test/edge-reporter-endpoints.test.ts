import assert from "node:assert/strict";
import { after, test } from "node:test";

declare global {
  interface D1PreparedStatement {
    bind(...args: unknown[]): D1PreparedStatement;
    run(): Promise<{ results?: unknown[]; meta: { changes?: number; last_row_id?: number } }>;
    first<T>(): Promise<T | null>;
    all<T>(): Promise<{ results?: T[]; meta?: { changes?: number } }>;
  }

  interface D1Database {
    prepare(sql: string): D1PreparedStatement;
    batch(
      stmts: D1PreparedStatement[],
    ): Promise<{ results?: unknown[]; meta: { changes?: number } }[]>;
    dump(): Promise<Uint8Array>;
    exec(sql: string): Promise<{ meta: { changes?: number } }>;
  }
}

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
  signals_hash?: string | null;
  last_scored?: number;
  reasons?: string | null;
  model?: string | null;
}

interface Report {
  x_user_id: string | null;
  handle: string;
  reporter_fp: string;
  reporter_age_days: number | null;
  evidence: string;
  created_at: number;
}

class MockStmt implements D1PreparedStatement {
  args: unknown[] = [];

  constructor(
    private db: MockDB,
    private sql: string,
  ) {}

  bind(...args: unknown[]): D1PreparedStatement {
    this.args = args;
    return this;
  }

  async first<T>(): Promise<T | null> {
    if (this.sql.includes("FROM reporter_bans")) {
      const [a, b, now] = this.args as [string, string, number];
      return (
        (this.db.bans.find(
          (ban) =>
            [a, b].includes(ban.reporter_fp) && (ban.expires_at == null || ban.expires_at > now),
        ) as T | undefined) ?? null
      );
    }
    if (this.sql.includes("FROM rate_log")) {
      const [a, b, since] = this.args as [string, string, number];
      const n = this.db.rateLog.filter(
        (r) => [a, b].includes(r.fp) && r.created_at >= since,
      ).length;
      return { n } as T;
    }
    if (this.sql.includes("count(DISTINCT CASE")) {
      const [legacy, canonical, handle, uid, _uid2, minAge] = this.args as [
        string,
        string,
        string,
        string | null,
        string | null,
        number,
      ];
      const reporters = new Set<string>();
      for (const r of this.db.reports) {
        if (r.handle.toLowerCase() !== handle) continue;
        if (uid !== null && r.x_user_id !== null && r.x_user_id !== uid) continue;
        if (r.reporter_age_days !== null && r.reporter_age_days < minAge) continue;
        reporters.add(r.reporter_fp === legacy ? canonical : r.reporter_fp);
      }
      return { n: reporters.size } as T;
    }
    if (this.sql.includes("FROM accounts")) {
      if (this.sql.includes("WHERE x_user_id=?")) {
        const uid = this.args[0] as string;
        return (this.db.accounts.find((a) => a.x_user_id === uid) as T | undefined) ?? null;
      }
      const handle = this.args[0] as string;
      const uid = this.args[1] as string | null;
      return (
        (this.db.accounts.find(
          (a) =>
            a.handle.toLowerCase() === handle &&
            (uid === null || a.x_user_id === null || a.x_user_id === uid),
        ) as T | undefined) ?? null
      );
    }
    return null;
  }

  async all<T>(): Promise<{ results?: T[]; meta?: { changes?: number } }> {
    if (this.sql.includes("reporter_fp AS fp")) {
      const fps = new Set<string>();
      for (const r of this.db.reports) if (r.reporter_fp.startsWith("gh:")) fps.add(r.reporter_fp);
      for (const r of this.db.rateLog) if (r.fp.startsWith("gh:")) fps.add(r.fp);
      for (const r of this.db.bans) if (r.reporter_fp.startsWith("gh:")) fps.add(r.reporter_fp);
      return { results: [...fps].map((fp) => ({ fp })) as T[] };
    }
    if (this.sql.includes("FROM reporter_bans")) {
      return { results: this.db.bans as T[] };
    }
    return { results: [] };
  }

  async run(): Promise<{ results?: unknown[]; meta: { changes?: number; last_row_id?: number } }> {
    if (this.sql.includes("WITH quota AS MATERIALIZED")) {
      const [identity, since, perIdentity, global, globalSince, globalMax, , , now] = this.args as [string, number, number, string, number, number, string, string, number];
      const count = (fp: string, start: number) => this.db.rateLog.filter(r=>r.fp === fp && r.created_at >= start).length;
      if (count(identity, since) >= perIdentity || count(global, globalSince) >= globalMax) return { meta: { changes: 0 } };
      this.db.rateLog.push({ fp: identity, created_at: now }, { fp: global, created_at: now });
      return { meta: { changes: 2 } };
    }
    if (this.sql.includes("INSERT INTO reports")) {
      const [_, uid, handle, fp, age, evidence, now, lookupHandle, a, b] = this.args as [
        string,
        string | null,
        string,
        string,
        number,
        string,
        number,
        string,
        string,
        string,
      ];
      const exists = this.db.reports.some(
        (r) => r.handle.toLowerCase() === lookupHandle && [a, b].includes(r.reporter_fp),
      );
      if (exists) return { meta: { changes: 0 } };
      this.db.reports.push({
        x_user_id: uid,
        handle,
        reporter_fp: fp,
        reporter_age_days: age,
        evidence,
        created_at: now,
      });
      return { meta: { changes: 1 } };
    }
    if (this.sql.includes("INSERT INTO rate_log")) {
      const [fp, createdAt] = this.args as [string, number];
      this.db.rateLog.push({ fp, created_at: createdAt });
      return { meta: { changes: 1 } };
    }
    if (this.sql.includes("DELETE FROM rate_log")) {
      const before = this.args[0] as number;
      const prev = this.db.rateLog.length;
      this.db.rateLog = this.db.rateLog.filter((r) => r.created_at >= before);
      return { meta: { changes: prev - this.db.rateLog.length } };
    }
    if (this.sql.includes("INSERT INTO review_log")) {
      this.db.reviewLog.push({ actor: this.args[3] as string, action: this.args[2] as string });
      return { meta: { changes: 1 } };
    }
    if (this.sql.includes("INSERT INTO reporter_bans")) {
      this.db.bans.push({
        id: this.db.bans.length + 1,
        reporter_fp: this.args[0] as string,
        reason: this.args[1] as string | null,
        created_by: "admin",
        created_at: this.args[2] as number,
        expires_at: this.args[3] as number | null,
      });
      return { meta: { changes: 1, last_row_id: this.db.bans.length } };
    }
    if (this.sql.includes("DELETE FROM reporter_bans")) {
      const id = Number(this.args[0]);
      const prev = this.db.bans.length;
      this.db.bans = this.db.bans.filter((b) => b.id !== id);
      return { meta: { changes: prev - this.db.bans.length } };
    }
    if (this.sql.includes("UPDATE reports SET reporter_fp")) {
      const [next, prev] = this.args as [string, string];
      let changes = 0;
      for (const r of this.db.reports) {
        if (r.reporter_fp === prev) {
          r.reporter_fp = next;
          changes++;
        }
      }
      return { meta: { changes } };
    }
    if (this.sql.includes("UPDATE rate_log SET fp")) {
      const [next, prev] = this.args as [string, string];
      let changes = 0;
      for (const r of this.db.rateLog) {
        if (r.fp === prev) {
          r.fp = next;
          changes++;
        }
      }
      return { meta: { changes } };
    }
    if (this.sql.includes("UPDATE reporter_bans SET reporter_fp")) {
      const [next, prev] = this.args as [string, string];
      let changes = 0;
      for (const r of this.db.bans) {
        if (r.reporter_fp === prev) {
          r.reporter_fp = next;
          changes++;
        }
      }
      return { meta: { changes } };
    }
    return { meta: { changes: 1 } };
  }
}

class MockDB implements D1Database {
  accounts: Account[] = [
    {
      rowid: 1,
      handle: "target",
      x_user_id: "100",
      status: "auto_pending_review",
      verdict_label: "spam",
      confidence: 0.95,
    },
  ];
  reports: Report[] = [];
  rateLog: { fp: string; created_at: number }[] = [];
  bans: {
    id: number;
    reporter_fp: string;
    reason: string | null;
    created_by: string;
    created_at: number;
    expires_at: number | null;
  }[] = [];
  reviewLog: { actor: string; action: string }[] = [];

  prepare(sql: string): D1PreparedStatement {
    return new MockStmt(this, sql);
  }

  async batch(
    stmts: D1PreparedStatement[],
  ): Promise<{ results?: unknown[]; meta: { changes?: number } }[]> {
    return Promise.all(stmts.map((stmt) => stmt.run()));
  }

  async dump(): Promise<Uint8Array> {
    return new Uint8Array();
  }

  async exec(): Promise<{ meta: { changes?: number } }> {
    return { meta: { changes: 0 } };
  }
}

function env(db = new MockDB()): Record<string, unknown> {
  return {
    DB: db,
    REPORT_SALT: "test-report-salt",
    REQUIRE_AUTH: "1",
    LLM_API_BASE: "https://llm.invalid",
    LLM_API_KEY: "test",
    LLM_API_MODEL: "test-model",
  };
}

function reportRequest(token = "ok-token"): Request {
  return new Request("https://x.test/v1/report", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      userId: "100",
      handle: "target",
      displayName: "Target",
      bio: "full bio should not be stored",
      recentTweets: ["short public snippet"],
    }),
  });
}

async function reporterFp(raw = "gh:42", salt = "test-report-salt"): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(salt),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw));
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  return `rpt:${hex.slice(0, 32)}`;
}

// Counts how many times the (mocked) LLM endpoint is hit, so reuse tests can
// assert "no LLM call". Reset it at the top of each test that inspects it.
let llmCalls = 0;
// The raw `message.content` the mocked LLM returns. Tests that exercise the
// JSON extractor override this to simulate fenced / reasoning-prose answers.
const DEFAULT_LLM_CONTENT = '{"label":"spam","confidence":0.9,"reasons":["fresh"]}';
let llmContent = DEFAULT_LLM_CONTENT;
globalThis.fetch = async (input: string | URL | Request) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url === "https://api.github.com/user") {
    return Response.json({ id: 42, created_at: "2020-01-01T00:00:00Z" });
  }
  if (url.startsWith("https://llm.invalid")) {
    llmCalls++;
    return Response.json({ choices: [{ message: { content: llmContent } }] });
  }
  return originalFetch(input);
};

test("report endpoint returns 401 without GitHub auth when REQUIRE_AUTH is on", async () => {
  const db = new MockDB();
  const res = await worker.fetch(
    new Request("https://x.test/v1/report", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "100", handle: "target" }),
    }),
    env(db),
  );
  assert.equal(res.status, 401);
  assert.equal(db.reports.length, 0);
});

test("report endpoint returns 403 for a banned reporter and writes no signal", async () => {
  const db = new MockDB();
  db.bans.push({
    id: 1,
    reporter_fp: await reporterFp(),
    reason: "abuse",
    created_by: "admin",
    created_at: Date.now(),
    expires_at: null,
  });
  const res = await worker.fetch(reportRequest(), env(db));
  assert.equal(res.status, 403);
  assert.equal(db.reports.length, 0);
  assert.equal(db.rateLog.length, 0);
});

test("report endpoint returns 429 when reporter is rate-limited and writes no signal", async () => {
  const db = new MockDB();
  const fp = await reporterFp();
  const now = Date.now();
  for (let i = 0; i < 10; i++) db.rateLog.push({ fp, created_at: now - i * 1000 });
  const res = await worker.fetch(reportRequest(), env(db));
  assert.equal(res.status, 429);
  assert.equal(db.reports.length, 0);
});

test("report endpoint stores HMAC fingerprint and minimized evidence without raw GitHub id", async () => {
  const db = new MockDB();
  const res = await worker.fetch(reportRequest(), env(db));
  assert.equal(res.status, 200);
  assert.equal(db.reports.length, 1);
  const report = db.reports[0];
  assert.ok(report);
  assert.match(report.reporter_fp, /^rpt:[0-9a-f]{32}$/);
  assert.notEqual(report.reporter_fp, "gh:42");
  assert.ok(!report.evidence.includes("full bio should not be stored"));
  assert.ok(db.reviewLog[0]?.actor.startsWith("reporter:"));
  assert.notEqual(db.reviewLog[0]?.actor, "gh:42");
});

test("report carries the reporter's category claim into the evidence (2026-09-06)", async () => {
  const db = new MockDB();
  const res = await worker.fetch(
    new Request("https://x.test/v1/report", {
      method: "POST",
      headers: { authorization: "Bearer ok-token", "content-type": "application/json" },
      body: JSON.stringify({
        userId: "101",
        handle: "netdisk_bait",
        displayName: "资源分享",
        recentTweets: ["夸克网盘 链接见主页"],
        reportCategory: "resource",
      }),
    }),
    env(db),
  );
  assert.equal(res.status, 200);
  const report = db.reports[0];
  assert.ok(report);
  assert.equal(JSON.parse(report.evidence).reportCategory, "resource");

  // An unknown category is a schema error, not silently accepted.
  const bad = await worker.fetch(
    new Request("https://x.test/v1/report", {
      method: "POST",
      headers: { authorization: "Bearer ok-token", "content-type": "application/json" },
      body: JSON.stringify({ handle: "someone", reportCategory: "politics" }),
    }),
    env(db),
  );
  assert.equal(bad.status, 400);
});

test("legacy gh:<id> report aliases to the HMAC fingerprint and is not double-counted", async () => {
  const db = new MockDB();
  db.reports.push({
    x_user_id: "100",
    handle: "target",
    reporter_fp: "gh:42",
    reporter_age_days: 1000,
    evidence: "{}",
    created_at: Date.now() - 10_000,
  });
  const res = await worker.fetch(reportRequest(), env(db));
  const body = (await res.json()) as { duplicate?: boolean; reporters?: number };
  assert.equal(res.status, 200);
  assert.equal(body.duplicate, true);
  assert.equal(body.reporters, 1);
  assert.equal(db.reports.length, 1);
});

test("classify endpoint returns 429 once the per-reporter throttle is exhausted", async () => {
  const db = new MockDB();
  const fp = await reporterFp("classify|gh:42");
  const now = Date.now();
  for (let i = 0; i < 60; i++) db.rateLog.push({ fp, created_at: now - i * 1000 });
  const res = await worker.fetch(
    new Request("https://x.test/v1/classify", {
      method: "POST",
      headers: { authorization: "Bearer ok-token", "content-type": "application/json" },
      body: JSON.stringify({ userId: "100", handle: "target" }),
    }),
    env(db),
  );
  assert.equal(res.status, 429);
  assert.equal(db.rateLog.length, 60); // throttled request adds no sample
});

test("classify endpoint fails closed (503) when REPORT_SALT is unset", async () => {
  const db = new MockDB();
  const { REPORT_SALT: _salt, ...noSalt } = env(db);
  const res = await worker.fetch(
    new Request("https://x.test/v1/classify", {
      method: "POST",
      headers: { authorization: "Bearer ok-token", "content-type": "application/json" },
      body: JSON.stringify({ userId: "100", handle: "target" }),
    }),
    noSalt,
  );
  assert.equal(res.status, 503);
});

test("classify endpoint returns 400 on a malformed body (invalid handle charset)", async () => {
  const db = new MockDB();
  const res = await worker.fetch(
    new Request("https://x.test/v1/classify", {
      method: "POST",
      headers: { authorization: "Bearer ok-token", "content-type": "application/json" },
      body: JSON.stringify({ handle: "bad|pipe" }),
    }),
    env(db),
  );
  assert.equal(res.status, 400);
});

function classifyRequest(recentTweets: string[]): Request {
  return new Request("https://x.test/v1/classify", {
    method: "POST",
    headers: { authorization: "Bearer ok-token", "content-type": "application/json" },
    body: JSON.stringify({ userId: "100", handle: "target", displayName: "T", recentTweets }),
  });
}

test("classify reuses a fresh prior verdict on signal drift without calling the LLM", async () => {
  const db = new MockDB();
  // Already-decided legit account, scored just now. New tweets (different
  // signals_hash) must NOT trigger a re-classification.
  db.accounts = [
    {
      rowid: 1,
      handle: "target",
      x_user_id: "100",
      status: "auto_legit",
      verdict_label: "legit",
      confidence: 0.92,
      reasons: '["benign"]',
      signals_hash: "stale-hash",
      last_scored: Date.now(),
    },
  ];
  llmCalls = 0;
  const res = await worker.fetch(classifyRequest(["a brand new tweet that drifts the hash"]), env(db));
  assert.equal(res.status, 200);
  const body = (await res.json()) as { cached?: boolean; record?: { verdict?: { label?: string } } };
  assert.equal(body.cached, true);
  assert.equal(body.record?.verdict?.label, "legit");
  assert.equal(llmCalls, 0); // freshness TTL short-circuited the LLM
});

test("classify cache hit is served even when the throttle budget is exhausted", async () => {
  // Regression: the per-identity cap must gate only the LLM path, never the
  // free cache-reuse short-circuit. A browser extension scanning a timeline is
  // almost all cache hits — they must not 429 once the window fills.
  const db = new MockDB();
  const fp = await reporterFp("classify|gh:42");
  const now = Date.now();
  for (let i = 0; i < 60; i++) db.rateLog.push({ fp, created_at: now - i * 1000 }); // budget full
  db.accounts = [
    {
      rowid: 1,
      handle: "target",
      x_user_id: "100",
      status: "auto_legit",
      verdict_label: "legit",
      confidence: 0.92,
      reasons: '["benign"]',
      signals_hash: "stale-hash",
      last_scored: Date.now(),
    },
  ];
  llmCalls = 0;
  const res = await worker.fetch(classifyRequest(["drifted tweet"]), env(db));
  assert.equal(res.status, 200); // not 429 — cache hit bypasses the throttle
  const body = (await res.json()) as { cached?: boolean };
  assert.equal(body.cached, true);
  assert.equal(llmCalls, 0); // no LLM call → no budget consumed
  assert.equal(db.rateLog.length, 60); // cache hit records no rate sample
});

test("classify re-scores a stale prior verdict (TTL lapsed) via the LLM", async () => {
  const db = new MockDB();
  db.accounts = [
    {
      rowid: 1,
      handle: "target",
      x_user_id: "100",
      status: "auto_legit",
      verdict_label: "legit",
      confidence: 0.92,
      reasons: '["benign"]',
      signals_hash: "stale-hash",
      last_scored: Date.now() - 40 * 86_400_000, // older than the 30d auto_legit TTL
    },
  ];
  llmCalls = 0;
  const res = await worker.fetch(classifyRequest(["promo spam now"]), env(db));
  assert.equal(res.status, 200);
  const body = (await res.json()) as { cached?: boolean };
  assert.equal(body.cached, false);
  assert.equal(llmCalls, 1); // TTL lapsed → fresh classification
});

// Reasoning models (minimax-m3, deepseek, …) wrap the verdict in ```json
// fences, prepend chain-of-thought prose containing stray braces, or emit an
// echo object first. A greedy first-`{`…last-`}` match mis-parsed all of these
// and stranded the account unclassified — these must all parse cleanly now.
for (const [shape, content] of [
  ["fenced json", '```json\n{"label":"spam","confidence":0.8,"reasons":["promo"]}\n```'],
  [
    "prose with braces before the object",
    'The account {@target} looks off-topic. Verdict:\n{"label":"spam","confidence":0.8,"reasons":["promo"]}',
  ],
  [
    "echo object then the real verdict",
    '{"note":"analyzing {target}"}\nFinal answer:\n{"label":"spam","confidence":0.8,"reasons":["promo"]}',
  ],
  [
    "trailing prose with braces after the object",
    '{"label":"spam","confidence":0.8,"reasons":["promo"]}\nNote: matches {redirect} template.',
  ],
] as const) {
  test(`classify parses a verdict from ${shape}`, async () => {
    const db = new MockDB();
    db.accounts = [
      {
        rowid: 1,
        handle: "target",
        x_user_id: "100",
        status: "auto_legit",
        verdict_label: "legit",
        confidence: 0.92,
        reasons: '["benign"]',
        signals_hash: "stale-hash",
        last_scored: Date.now() - 40 * 86_400_000, // stale → forces a fresh LLM call
      },
    ];
    llmContent = content;
    try {
      const res = await worker.fetch(classifyRequest(["promo spam now"]), env(db));
      assert.equal(res.status, 200);
      const body = (await res.json()) as { record?: { verdict?: { label?: string } } };
      assert.equal(body.record?.verdict?.label, "spam");
    } finally {
      llmContent = DEFAULT_LLM_CONTENT;
    }
  });
}

test("report endpoint returns 400 on a malformed body instead of 500", async () => {
  const db = new MockDB();
  const res = await worker.fetch(
    new Request("https://x.test/v1/report", {
      method: "POST",
      headers: { authorization: "Bearer ok-token", "content-type": "application/json" },
      body: JSON.stringify({ handle: "target", recentTweets: "not-an-array" }),
    }),
    env(db),
  );
  assert.equal(res.status, 400);
  assert.equal(db.reports.length, 0);
});

test("appeal endpoint returns 429 once the per-IP throttle is exhausted", async () => {
  const db = new MockDB();
  const fp = await reporterFp("appeal|ip:9.9.9.9");
  const now = Date.now();
  for (let i = 0; i < 5; i++) db.rateLog.push({ fp, created_at: now - i * 1000 });
  const res = await worker.fetch(
    new Request("https://x.test/v1/appeal", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": "9.9.9.9" },
      body: JSON.stringify({ handle: "target" }),
    }),
    env(db),
  );
  assert.equal(res.status, 429);
});

test("appeal endpoint under the throttle records a rate sample and answers", async () => {
  const db = new MockDB();
  const res = await worker.fetch(
    new Request("https://x.test/v1/appeal", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": "9.9.9.9" },
      body: JSON.stringify({ handle: "target" }),
    }),
    env(db),
  );
  assert.equal(res.status, 200); // mock row is auto_pending_review → not_listed
  assert.equal(db.rateLog.length, 1);
  assert.equal(db.rateLog[0]?.fp, await reporterFp("appeal|ip:9.9.9.9"));
});

test("admin decide rejects an unknown action with 400 instead of mapping it to rejected", async () => {
  const db = new MockDB();
  const res = await worker.fetch(
    new Request("https://x.test/v1/admin/decide", {
      method: "POST",
      headers: { "x-admin-token": "admin", "content-type": "application/json" },
      body: JSON.stringify({ handle: "target", xUserId: "100", action: "nuke" }),
    }),
    { ...env(db), ADMIN_TOKEN: "admin" },
  );
  assert.equal(res.status, 400);
  assert.equal(db.reviewLog.length, 0);
});

test("admin decide still accepts a known action (timing-safe token compare)", async () => {
  const db = new MockDB();
  const res = await worker.fetch(
    new Request("https://x.test/v1/admin/decide", {
      method: "POST",
      headers: { "x-admin-token": "admin", "content-type": "application/json" },
      body: JSON.stringify({ handle: "target", xUserId: "100", action: "approve" }),
    }),
    { ...env(db), ADMIN_TOKEN: "admin" },
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as { ok: boolean; status: string };
  assert.equal(body.ok, true);
  assert.equal(body.status, "human_confirmed");
});

test("admin decide rejects a wrong token with 403", async () => {
  const db = new MockDB();
  const res = await worker.fetch(
    new Request("https://x.test/v1/admin/decide", {
      method: "POST",
      headers: { "x-admin-token": "nope", "content-type": "application/json" },
      body: JSON.stringify({ handle: "target", xUserId: "100", action: "approve" }),
    }),
    { ...env(db), ADMIN_TOKEN: "admin" },
  );
  assert.equal(res.status, 403);
});

test("admin backfill migrates legacy report, rate, and ban fingerprints", async () => {
  const db = new MockDB();
  db.reports.push({
    x_user_id: "100",
    handle: "target",
    reporter_fp: "gh:42",
    reporter_age_days: 1000,
    evidence: "{}",
    created_at: Date.now(),
  });
  db.rateLog.push({ fp: "gh:42", created_at: Date.now() });
  db.bans.push({
    id: 1,
    reporter_fp: "gh:42",
    reason: "legacy",
    created_by: "admin",
    created_at: Date.now(),
    expires_at: null,
  });
  const res = await worker.fetch(
    new Request("https://x.test/v1/admin/reporter-fingerprints/backfill", {
      method: "POST",
      headers: { "x-admin-token": "admin" },
    }),
    { ...env(db), ADMIN_TOKEN: "admin" },
  );
  assert.equal(res.status, 200);
  const fp = await reporterFp();
  assert.equal(db.reports[0]?.reporter_fp, fp);
  assert.equal(db.rateLog[0]?.fp, fp);
  assert.equal(db.bans[0]?.reporter_fp, fp);
});
