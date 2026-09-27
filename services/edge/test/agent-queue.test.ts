import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { after, test } from "node:test";

const edgeModuleUrl = new URL("../src/index.ts", import.meta.url).href;
const { loadAgentQueue } = (await import(edgeModuleUrl)) as {
  loadAgentQueue(
    db: D1Database,
    agentId: string,
    limit: number,
  ): Promise<Array<{ x_user_id: string; handle: string }>>;
};

const sqlite = new DatabaseSync(":memory:");
after(() => sqlite.close());

sqlite.exec(`
  CREATE TABLE accounts (
    x_user_id TEXT,
    handle TEXT NOT NULL,
    display_name TEXT,
    avatar_url TEXT,
    verdict_label TEXT NOT NULL,
    confidence REAL NOT NULL,
    account_created_at TEXT,
    account_age_days INTEGER,
    followers_count INTEGER,
    following_count INTEGER,
    reasons TEXT,
    evidence_text TEXT,
    last_scored INTEGER NOT NULL,
    signals_hash TEXT,
    status TEXT NOT NULL,
    agent_id TEXT,
    agent_at INTEGER,
    agent_signals_hash TEXT,
    agent_attempts INTEGER NOT NULL DEFAULT 0
  )
`);

class SqliteD1Statement {
  private args: unknown[] = [];

  constructor(private readonly sql: string) {}

  bind(...args: unknown[]) {
    this.args = args;
    return this;
  }

  async all<T>() {
    const statement = sqlite.prepare(this.sql);
    return { results: statement.all(...this.args) as T[] };
  }
}

const db = {
  prepare(sql: string) {
    return new SqliteD1Statement(sql);
  },
} as unknown as D1Database;

function insertAccount(input: {
  id: string;
  label: string;
  confidence?: number;
  following?: number | null;
  status?: string;
  agentId?: string | null;
  attempts?: number;
  signalsHash?: string | null;
  agentSignalsHash?: string | null;
  agentAt?: number | null;
  lastScored?: number;
}) {
  sqlite.prepare(
    `INSERT INTO accounts (
       x_user_id, handle, verdict_label, confidence, following_count,
       last_scored, signals_hash, status, agent_id, agent_at,
       agent_signals_hash, agent_attempts
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    input.id,
    `user_${input.id}`,
    input.label,
    input.confidence ?? 0.5,
    input.following ?? 0,
    input.lastScored ?? 1,
    input.signalsHash ?? "signals-v1",
    input.status ?? "auto_pending_review",
    input.agentId ?? null,
    input.agentAt ?? null,
    input.agentSignalsHash ?? null,
    input.attempts ?? 0,
  );
}

insertAccount({
  id: "high-following",
  label: "legit",
  following: 100_001,
  agentId: "openai",
});
insertAccount({
  id: "porn",
  label: "porn_bot",
  confidence: 0.97,
  agentId: "openai",
});
insertAccount({
  id: "spam-old-failures",
  label: "spam",
  confidence: 0.99,
  agentId: "hermes",
  attempts: 3,
});
insertAccount({
  id: "likely-spam",
  label: "likely_spam",
  confidence: 0.95,
  agentId: "openai",
});
insertAccount({ id: "unreviewed", label: "uncertain" });
insertAccount({
  id: "same-agent-fresh",
  label: "porn_bot",
  confidence: 1,
  agentId: "batch-openai-v2",
  agentAt: 10,
  agentSignalsHash: "signals-v1",
});
insertAccount({
  id: "same-agent-stale",
  label: "spam",
  confidence: 0.98,
  agentId: "batch-openai-v2",
  agentAt: 10,
  signalsHash: "signals-v2",
  agentSignalsHash: "signals-v1",
});
insertAccount({
  id: "same-agent-exhausted",
  label: "porn_bot",
  confidence: 1,
  agentId: "batch-openai-v2",
  attempts: 3,
  agentAt: 10,
  signalsHash: "signals-v2",
  agentSignalsHash: "signals-v1",
});
insertAccount({
  id: "not-pending",
  label: "porn_bot",
  confidence: 1,
  status: "human_confirmed",
});

test("agent queue re-reviews other agents and prioritizes actionable buckets", async () => {
  const queue = await loadAgentQueue(db, "batch-openai-v2", 10);

  assert.deepEqual(
    queue.map((row) => row.x_user_id),
    [
      "high-following",
      "porn",
      "spam-old-failures",
      "same-agent-stale",
      "likely-spam",
      "unreviewed",
    ],
  );
});

test("agent queue enforces the requested logical batch limit", async () => {
  const queue = await loadAgentQueue(db, "batch-openai-v2", 3);

  assert.deepEqual(
    queue.map((row) => row.x_user_id),
    ["high-following", "porn", "spam-old-failures"],
  );
});
