// Handle-only auto-publish corroboration lane (2026-08-23).
//
// Context: /v1/classify's AI auto-publish lane required a numeric x_user_id,
// but the shipped extension can only read uid/bio/followers/account-age from
// X's React fiber — invisible to an isolated-world content script. Measured on
// production that day: ~98% of payloads are handle-only, the model quantizes
// its confident tier at 0.92 (the gate sat at 0.95), and the lane published
// exactly once in 72h against ~1000 confident porn_bot verdicts/day.
//
// Covers:
//   - the calibrated threshold: a uid-bearing porn_bot at 0.92 publishes
//   - one witness is not enough: a handle-only payload queues
//   - a second DISTINCT aged identity corroborates and publishes at tier 'ai'
//   - the same identity twice is still one witness (no self-corroboration)
//   - the high-reach guard still wins, using the follower count stored on the
//     row when the live handle-only payload has none
//   - the cache path also accrues witnesses (the 2nd viewer of a spam bot is
//     served from cache — if only fresh LLM calls counted, the bar would
//     never be reached)
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

interface Account {
  rowid: number;
  handle: string;
  x_user_id: string | null;
  status: string;
  verdict_label: string;
  confidence: number;
  followers_count: number | null;
  signals_hash: string | null;
  last_scored: number;
  published_at: number | null;
  published_tier: string | null;
  reasons: string | null;
  category: string | null;
}

class MockStmt {
  args: unknown[] = [];
  constructor(
    private db: MockDB,
    private sql: string,
  ) {}

  bind(...args: unknown[]) {
    this.args = args;
    return this;
  }

  async first<T>(): Promise<T | null> {
    if (this.sql.includes("FROM rate_log")) return { n: 0 } as T;
    if (this.sql.includes("FROM reporter_bans")) return null;
    if (this.sql.includes("FROM classify_witness")) {
      const key = this.args[0] as string;
      return { n: this.db.witnesses.filter((w) => w.handle_norm === key).length } as T;
    }
    if (this.sql.includes("SELECT followers_count FROM accounts")) {
      const rowid = this.args[0] as number;
      const acc = this.db.accounts.find((a) => a.rowid === rowid);
      return ({ followers_count: acc?.followers_count ?? null } as T) ?? null;
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

  async all<T>(): Promise<{ results?: T[] }> {
    if (this.sql.includes("FROM keyword_rules")) return { results: [] as T[] };
    return { results: [] };
  }

  async run(): Promise<{ meta: { changes?: number; last_row_id?: number } }> {
    if (this.sql.includes("INSERT INTO classify_witness")) {
      const [handle_norm, fp, first_at] = this.args as [string, string, number];
      const dupe = this.db.witnesses.some(
        (w) => w.handle_norm === handle_norm && w.fp === fp,
      );
      if (dupe) return { meta: { changes: 0 } };
      this.db.witnesses.push({ handle_norm, fp, first_at });
      return { meta: { changes: 1 } };
    }
    if (this.sql.includes("INSERT INTO review_log")) {
      this.db.reviewLog.push({ action: this.args[2] as string, actor: this.args[3] as string, note: this.args[4] as string });
      return { meta: { changes: 1 } };
    }
    if (
      this.sql.includes("UPDATE accounts") &&
      this.sql.includes("published_tier='ai'")
    ) {
      const [published_at, rowid] = this.args as [number, number];
      const acc = this.db.accounts.find(
        (a) => a.rowid === rowid && a.status === "auto_pending_review",
      );
      if (!acc) return { meta: { changes: 0 } };
      acc.status = "human_confirmed";
      acc.published_at = published_at;
      acc.published_tier = "ai";
      return { meta: { changes: 1 } };
    }
    if (this.sql.includes("INSERT INTO accounts")) {
      const a = this.args;
      this.db.accounts.push({
        rowid: this.db.accounts.length + 1,
        x_user_id: a[0] as string | null,
        handle: a[1] as string,
        followers_count: (a[6] as number | null) ?? null,
        verdict_label: a[8] as string,
        confidence: a[9] as number,
        reasons: a[10] as string | null,
        category: a[11] as string | null,
        status: a[13] as string,
        signals_hash: a[15] as string | null,
        last_scored: a[18] as number,
        published_at: a[19] as number | null,
        published_tier: a[20] as string | null,
      });
      return { meta: { changes: 1, last_row_id: this.db.accounts.length } };
    }
    if (this.sql.includes("UPDATE accounts SET") && this.sql.includes("category=COALESCE")) {
      const a = this.args;
      const rowid = a[a.length - 1] as number;
      const acc = this.db.accounts.find((x) => x.rowid === rowid);
      if (acc) {
        // COALESCE semantics: a handle-only payload must never erase a
        // follower count an earlier richer payload established.
        acc.followers_count = (a[6] as number | null) ?? acc.followers_count;
        acc.verdict_label = a[8] as string;
        acc.confidence = a[9] as number;
        acc.signals_hash = (a[14] as string | null) ?? acc.signals_hash;
        acc.last_scored = a[16] as number;
        const terminal = ["human_confirmed", "rejected", "removed", "whitelisted"];
        if (!terminal.includes(acc.status)) {
          acc.status = a[17] as string;
          acc.published_at = (a[18] as number | null) ?? acc.published_at;
          acc.published_tier = (a[19] as string | null) ?? acc.published_tier;
        }
      }
      return { meta: { changes: 1 } };
    }
    return { meta: { changes: 1 } };
  }
}

class MockDB {
  accounts: Account[] = [];
  witnesses: { handle_norm: string; fp: string; first_at: number }[] = [];
  reviewLog: { action: string; actor: string; note: string }[] = [];
  prepare(sql: string) {
    return new MockStmt(this, sql);
  }
  async batch(stmts: MockStmt[]) {
    return Promise.all(stmts.map((s) => s.run()));
  }
  async dump() {
    return new Uint8Array();
  }
  async exec() {
    return { meta: { changes: 0 } };
  }
}

let llmContent = '{"label":"porn_bot","confidence":0.92,"reasons":["redirect bait"],"category":"porn"}';
// Distinct bearer tokens map to distinct aged GitHub identities, so a test can
// express "two different people saw this handle".
globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url === "https://api.github.com/user") {
    const auth =
      (init?.headers as Record<string, string> | undefined)?.authorization ??
      (input as Request).headers?.get?.("authorization") ??
      "";
    const id = Number(auth.match(/user-(\d+)/)?.[1] ?? 42);
    return Response.json({ id, created_at: "2015-01-01T00:00:00Z" });
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
    AI_AUTO_PUBLISH_ENABLED: "1",
    LLM_API_BASE: "https://llm.invalid",
    LLM_API_KEY: "test",
    LLM_API_MODEL: "test-model",
  };
  llmContent = '{"label":"porn_bot","confidence":0.92,"reasons":["redirect bait"],"category":"porn"}';
});

function classify(body: Record<string, unknown>, user: number): Request {
  return new Request("https://x.test/v1/classify", {
    method: "POST",
    headers: {
      authorization: `Bearer user-${user}-token`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

// Vary the tweet text per caller so the signals_hash differs — otherwise the
// second call is an exact-hash cache hit, which is exercised separately below.
const payload = (n: number, extra: Record<string, unknown> = {}) => ({
  handle: "sexbot9911",
  displayName: "小可爱",
  recentTweets: [`看主页 @dispatcher0${n}`],
  triggeringComment: `看主页 @dispatcher0${n}`,
  ...extra,
});

test("calibrated threshold: a uid-bearing porn_bot at 0.92 publishes", async () => {
  const res = await worker.fetch(
    classify({ ...payload(1), userId: "123456" }, 1),
    env,
  );
  assert.equal(res.status, 200);
  const acc = db.accounts[0];
  assert.equal(acc?.status, "human_confirmed");
  assert.equal(acc?.published_tier, "ai");
});

test("one witness is not enough: a handle-only payload queues", async () => {
  await worker.fetch(classify(payload(1), 1), env);
  assert.equal(db.accounts[0]?.status, "auto_pending_review");
  assert.equal(db.accounts[0]?.published_tier, null);
  assert.equal(db.witnesses.length, 1);
});

test("the same identity twice is still one witness", async () => {
  await worker.fetch(classify(payload(1), 7), env);
  await worker.fetch(classify(payload(2), 7), env);
  assert.equal(db.witnesses.length, 1);
  assert.equal(db.accounts[0]?.status, "auto_pending_review");
});

test("a second distinct aged identity corroborates and publishes at tier 'ai'", async () => {
  await worker.fetch(classify(payload(1), 1), env);
  assert.equal(db.accounts[0]?.status, "auto_pending_review");
  await worker.fetch(classify(payload(2), 2), env);
  assert.equal(db.accounts[0]?.status, "human_confirmed");
  assert.equal(db.accounts[0]?.published_tier, "ai");
  assert.ok(
    db.reviewLog.some((r) => r.actor === "ai:witness" && r.note.includes("witnesses=2")),
    "publish is audited as a witness-corroborated AI publish",
  );
});

test("high-reach guard still wins, using the follower count stored on the row", async () => {
  // First caller supplies the follower count; it is high-reach, so it queues.
  await worker.fetch(classify(payload(1, { followersCount: 250_000 }), 1), env);
  assert.equal(db.accounts[0]?.status, "auto_pending_review");
  // Second caller is handle-only (no follower count in the payload) — the
  // guard must fall back to what the row already knows and keep it queued.
  await worker.fetch(classify(payload(2), 2), env);
  assert.equal(db.accounts[0]?.status, "auto_pending_review");
  assert.equal(db.accounts[0]?.published_tier, null);
});

test("the cache path accrues witnesses and can publish", async () => {
  const body = payload(1);
  await worker.fetch(classify(body, 1), env);
  assert.equal(db.accounts[0]?.status, "auto_pending_review");
  // Byte-identical payload from a DIFFERENT identity => exact signals_hash
  // cache hit, no LLM call. It must still count as corroboration.
  const res = await worker.fetch(classify(body, 2), env);
  const json = (await res.json()) as { cached: boolean; record: { status: string } };
  assert.equal(json.cached, true);
  assert.equal(json.record.status, "human_confirmed");
  assert.equal(db.accounts[0]?.status, "human_confirmed");
  assert.equal(db.accounts[0]?.published_tier, "ai");
});

test("disabled policy never records witnesses or publishes from cache", async () => {
  env.AI_AUTO_PUBLISH_ENABLED = "0";
  const body = payload(9);
  await worker.fetch(classify(body, 1), env);
  const res = await worker.fetch(classify(body, 2), env);
  const json = (await res.json()) as { cached: boolean; record: { status: string } };
  assert.equal(json.cached, true);
  assert.equal(json.record.status, "auto_pending_review");
  assert.equal(db.accounts[0]?.status, "auto_pending_review");
  assert.equal(db.accounts[0]?.published_tier, null);
  assert.equal(db.witnesses.length, 0);
  assert.equal(db.reviewLog.some((r) => r.action === "ai_blacklist"), false);
});
