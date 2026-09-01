import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

const edgeModuleUrl = new URL("../src/index.ts", import.meta.url).href;
const worker = (await import(edgeModuleUrl)).default as {
  fetch(req: Request, env: Record<string, unknown>): Promise<Response>;
};

interface Account {
  rowid: number;
  x_user_id: string | null;
  handle: string;
  display_name: string | null;
  evidence_text: string | null;
  status: string;
  last_scored: number | null;
  published_at: number | null;
  published_tier: string | null;
  last_decided_by?: string | null;
  last_decided_at?: number | null;
}

interface Rule {
  id: number;
  pattern: string;
  field: string;
  action: string;
  verdict_label: string;
  category: string | null;
  enabled: number;
  note: string | null;
  created_at: number;
  hit_count: number;
  last_hit_at: number | null;
}

class Stmt {
  args: unknown[] = [];

  constructor(
    readonly db: DB,
    readonly sql: string,
  ) {}

  bind(...args: unknown[]) {
    this.args = args;
    return this;
  }

  async first<T>(): Promise<T | null> {
    return null;
  }

  async all<T>(): Promise<{ results?: T[] }> {
    if (this.sql.includes("FROM keyword_rules")) {
      return { results: this.db.rules.filter((rule) => rule.enabled === 1) as T[] };
    }
    if (
      this.sql.includes("FROM accounts") &&
      this.sql.includes("status='human_confirmed'") &&
      this.sql.includes("rowid>?")
    ) {
      const cursor = Number(this.args[0]);
      const limit = Number(this.args[1]);
      const rows = this.db.accounts
        .filter((account) => account.status === "human_confirmed" && account.rowid > cursor)
        .sort((a, b) => a.rowid - b.rowid)
        .slice(0, limit);
      return { results: rows as T[] };
    }
    return { results: [] };
  }

  async run() {
    if (
      this.sql.includes("UPDATE accounts") &&
      this.sql.includes("last_decided_by='human:rule-only-cleanup'")
    ) {
      const now = Number(this.args[0]);
      let changes = 0;
      for (let i = 1; i < this.args.length; i += 2) {
        const rowid = Number(this.args[i]);
        const lastScored = this.args[i + 1] as number | null;
        const row = this.db.accounts.find(
          (account) =>
            account.rowid === rowid &&
            account.status === "human_confirmed" &&
            account.last_scored === lastScored,
        );
        if (!row) continue;
        row.status = "removed";
        row.published_at = null;
        row.published_tier = null;
        row.last_decided_by = "human:rule-only-cleanup";
        row.last_decided_at = now;
        changes++;
      }
      return { meta: { changes } };
    }
    if (this.sql.includes("INSERT INTO review_log")) {
      this.db.audit.push({
        action: String(this.args[2]),
        note: String(this.args[4]),
      });
      return { meta: { changes: 1 } };
    }
    return { meta: { changes: 0 } };
  }
}

class DB {
  accounts: Account[] = [];
  audit: Array<{ action: string; note: string }> = [];
  readonly rules: Rule[] = [
    {
      id: 1,
      pattern: "约",
      field: "display_name",
      action: "blacklist",
      verdict_label: "porn_bot",
      category: "porn",
      enabled: 1,
      note: null,
      created_at: 1,
      hit_count: 0,
      last_hit_at: null,
    },
    {
      id: 2,
      pattern: "visa",
      field: "display_name",
      action: "blacklist",
      verdict_label: "spam",
      category: "other",
      enabled: 1,
      note: null,
      created_at: 1,
      hit_count: 0,
      last_hit_at: null,
    },
    {
      id: 3,
      pattern: "主页",
      field: "tweet",
      action: "blacklist",
      verdict_label: "porn_bot",
      category: "porn",
      enabled: 1,
      note: null,
      created_at: 1,
      hit_count: 0,
      last_hit_at: null,
    },
    {
      id: 4,
      pattern: "trusted",
      field: "any",
      action: "whitelist",
      verdict_label: "legit",
      category: null,
      enabled: 1,
      note: null,
      created_at: 1,
      hit_count: 0,
      last_hit_at: null,
    },
  ];

  prepare(sql: string) {
    return new Stmt(this, sql);
  }

  async batch(stmts: Stmt[]) {
    const results = [];
    for (const stmt of stmts) results.push(await stmt.run());
    return results;
  }

  async dump() {
    return new Uint8Array();
  }

  async exec() {
    return { meta: { changes: 0 } };
  }
}

const db = new DB();
const env = { DB: db, ADMIN_TOKEN: "admin" };
const headers = { "x-admin-token": "admin", "content-type": "application/json" };

function fixtures(): Account[] {
  return [
    {
      rowid: 1,
      x_user_id: "1",
      handle: "cjk-hit",
      display_name: "同城约会",
      evidence_text: null,
      status: "human_confirmed",
      last_scored: 101,
      published_at: 1,
      published_tier: "rule",
    },
    {
      rowid: 2,
      x_user_id: "2",
      handle: "boundary-miss",
      display_name: "Visakan",
      evidence_text: null,
      status: "human_confirmed",
      last_scored: 102,
      published_at: 2,
      published_tier: "human",
    },
    {
      rowid: 3,
      x_user_id: "3",
      handle: "evidence-hit",
      display_name: "普通账号",
      evidence_text: "更多内容看我主页",
      status: "human_confirmed",
      last_scored: 103,
      published_at: 3,
      published_tier: "human",
    },
    {
      rowid: 4,
      x_user_id: "4",
      handle: "ascii-hit",
      display_name: "visa services",
      evidence_text: null,
      status: "human_confirmed",
      last_scored: 104,
      published_at: 4,
      published_tier: null,
    },
    {
      rowid: 5,
      x_user_id: "5",
      handle: "non-blacklist-action",
      display_name: "trusted account",
      evidence_text: null,
      status: "human_confirmed",
      last_scored: 105,
      published_at: 5,
      published_tier: "human",
    },
    {
      rowid: 6,
      x_user_id: "6",
      handle: "protected-whitelist",
      display_name: "Visakan",
      evidence_text: null,
      status: "whitelisted",
      last_scored: 106,
      published_at: null,
      published_tier: null,
    },
    {
      rowid: 7,
      x_user_id: "7",
      handle: "protected-pending",
      display_name: "Visakan",
      evidence_text: null,
      status: "auto_pending_review",
      last_scored: 107,
      published_at: null,
      published_tier: null,
    },
  ];
}

beforeEach(() => {
  db.accounts = fixtures();
  db.audit = [];
});

async function call(body: Record<string, unknown>, requestHeaders = headers) {
  return worker.fetch(
    new Request("https://edge.test/v1/admin/rule-only-blacklist-cleanup", {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify(body),
    }),
    env,
  );
}

test("rule-only cleanup requires admin authentication", async () => {
  const res = await call({}, { "content-type": "application/json" });
  assert.equal(res.status, 403);
});

test("rule-only cleanup defaults to a read-only exact stored-row rescan", async () => {
  const res = await call({});
  assert.equal(res.status, 200);
  const body = (await res.json()) as Record<string, unknown>;
  assert.equal(body.dryRun, true);
  assert.equal(body.scanned, 5);
  assert.equal(body.retained, 3);
  assert.equal(body.removable, 2);
  assert.equal(body.processed, 0);
  assert.equal(body.ruleCount, 3);
  assert.match(String(body.ruleFingerprint), /^[a-f0-9]{64}$/);
  assert.match(String(body.planHash), /^[a-f0-9]{64}$/);
  assert.deepEqual(db.accounts.map((account) => account.status), [
    "human_confirmed",
    "human_confirmed",
    "human_confirmed",
    "human_confirmed",
    "human_confirmed",
    "whitelisted",
    "auto_pending_review",
  ]);
  assert.equal(db.audit.length, 0);
});

test("rule-only cleanup enforces bounded keyset pagination", async () => {
  const first = await call({ limit: 2 });
  const firstBody = (await first.json()) as { scanned: number; nextCursor: number; done: boolean };
  assert.equal(firstBody.scanned, 2);
  assert.equal(firstBody.nextCursor, 2);
  assert.equal(firstBody.done, false);

  const second = await call({ cursor: firstBody.nextCursor, limit: 2 });
  const secondBody = (await second.json()) as {
    scanned: number;
    nextCursor: number;
    done: boolean;
  };
  assert.equal(secondBody.scanned, 2);
  assert.equal(secondBody.nextCursor, 4);
  assert.equal(secondBody.done, false);
});

test("rule-only cleanup rejects execution without all explicit safety gates", async () => {
  const res = await call({ dryRun: false, confirm: "REMOVE_NON_RULE_BLACKLIST" });
  assert.equal(res.status, 400);
  assert.equal(db.accounts.filter((account) => account.status === "removed").length, 0);
});

test("rule-only cleanup rejects a changed rule set before reading or writing the page", async () => {
  const preview = (await (await call({})).json()) as { planHash: string };
  const res = await call({
    dryRun: false,
    cleanupId: "rule-only-2026-09-01",
    expectedRuleFingerprint: "0".repeat(64),
    expectedPlanHash: preview.planHash,
    confirm: "REMOVE_NON_RULE_BLACKLIST",
  });
  assert.equal(res.status, 409);
  assert.equal(db.accounts.filter((account) => account.status === "removed").length, 0);
  assert.equal(db.audit.length, 0);
});

test("rule-only cleanup removes only non-matches and leaves whitelist and pending untouched", async () => {
  const preview = (await (await call({})).json()) as {
    ruleFingerprint: string;
    planHash: string;
  };
  const res = await call({
    dryRun: false,
    cleanupId: "rule-only-2026-09-01",
    expectedRuleFingerprint: preview.ruleFingerprint,
    expectedPlanHash: preview.planHash,
    confirm: "REMOVE_NON_RULE_BLACKLIST",
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { ok: boolean; processed: number; skipped: number };
  assert.equal(body.ok, true);
  assert.equal(body.processed, 2);
  assert.equal(body.skipped, 0);

  assert.equal(db.accounts.find((account) => account.rowid === 1)?.status, "human_confirmed");
  assert.equal(db.accounts.find((account) => account.rowid === 2)?.status, "removed");
  assert.equal(db.accounts.find((account) => account.rowid === 3)?.status, "human_confirmed");
  assert.equal(db.accounts.find((account) => account.rowid === 4)?.status, "human_confirmed");
  assert.equal(db.accounts.find((account) => account.rowid === 5)?.status, "removed");
  assert.equal(db.accounts.find((account) => account.rowid === 6)?.status, "whitelisted");
  assert.equal(db.accounts.find((account) => account.rowid === 7)?.status, "auto_pending_review");
  assert.equal(db.accounts.find((account) => account.rowid === 2)?.last_decided_by, "human:rule-only-cleanup");
  assert.equal(db.audit.length, 1);
  assert.equal(db.audit[0]?.action, "rule_only_cleanup_batch");
  assert.match(db.audit[0]?.note ?? "", /removable=2/);
});

test("rule-only cleanup rejects a stale page plan before writing", async () => {
  const preview = (await (await call({})).json()) as {
    ruleFingerprint: string;
    planHash: string;
  };
  const row = db.accounts.find((account) => account.rowid === 2);
  assert.ok(row);
  row.last_scored = 999;
  const res = await call({
    dryRun: false,
    cleanupId: "rule-only-2026-09-01",
    expectedRuleFingerprint: preview.ruleFingerprint,
    expectedPlanHash: preview.planHash,
    confirm: "REMOVE_NON_RULE_BLACKLIST",
  });
  assert.equal(res.status, 409);
  assert.equal(row.status, "human_confirmed");
  assert.equal(db.audit.length, 0);
});
