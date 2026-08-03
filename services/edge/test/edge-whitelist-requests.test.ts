import assert from "node:assert/strict";
import { after, test } from "node:test";

// Shares the MockDB approach of edge-reporter-endpoints.test.ts: a tiny
// SQL-shape-matching in-memory D1 double, plus a fetch mock for the GitHub
// identity endpoint. The GitHub token picks the account age so the
// REPORTER_MIN_AGE_DAYS gate can be exercised both ways.

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
  reasons?: string | null;
  signals_hash?: string | null;
  last_scored?: number;
  category?: string | null;
}

interface WhitelistRequest {
  id: number;
  x_user_id: string | null;
  handle: string;
  reporter_fp: string;
  gh_age_days: number | null;
  note: string | null;
  status: string;
  created_at: number;
  decided_at: number | null;
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
    if (this.sql.includes("FROM whitelist_requests")) {
      // Pending-dup probe: status='pending' AND (reporter_fp=? OR lower(handle)=?)
      if (this.sql.includes("reporter_fp=? OR lower(handle)=?")) {
        const [fp, handle] = this.args as [string, string];
        return (
          (this.db.whitelistRequests.find(
            (r) =>
              r.status === "pending" &&
              (r.reporter_fp === fp || r.handle.toLowerCase() === handle),
          ) as T | undefined) ?? null
        );
      }
      // Latest-by-fp status probe.
      if (this.sql.includes("WHERE reporter_fp=?")) {
        const fp = this.args[0] as string;
        const mine = this.db.whitelistRequests.filter((r) => r.reporter_fp === fp);
        return (mine[mine.length - 1] as T | undefined) ?? null;
      }
      // Fetch-by-id for approve/reject.
      if (this.sql.includes("WHERE id=?")) {
        const id = Number(this.args[0]);
        return (this.db.whitelistRequests.find((r) => r.id === id) as T | undefined) ?? null;
      }
      return null;
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
    if (this.sql.includes("FROM whitelist_requests")) {
      const [status, status2, limit] = this.args as [string, string, number];
      void status2;
      const rows = this.db.whitelistRequests
        .filter((r) => status === "all" || r.status === status)
        .sort((a, b) => b.id - a.id)
        .slice(0, limit);
      return { results: rows as T[] };
    }
    if (this.sql.includes("FROM accounts WHERE lower(handle) IN")) {
      const handles = new Set(this.args.map((v) => String(v).toLowerCase()));
      const rows = this.db.accounts
        .filter((a) => handles.has(a.handle.toLowerCase()))
        .map((a) => ({
          x_user_id: a.x_user_id,
          h: a.handle.toLowerCase(),
          status: a.status,
          verdict_label: a.verdict_label,
          category: a.category ?? null,
          last_scored: a.last_scored ?? 0,
        }));
      return { results: rows as T[] };
    }
    return { results: [] };
  }

  async run(): Promise<{ results?: unknown[]; meta: { changes?: number; last_row_id?: number } }> {
    if (this.sql.includes("INSERT INTO whitelist_requests")) {
      const [uid, handle, fp, age, note, now] = this.args as [
        string | null,
        string,
        string,
        number,
        string | null,
        number,
      ];
      this.db.whitelistRequests.push({
        id: this.db.whitelistRequests.length + 1,
        x_user_id: uid,
        handle,
        reporter_fp: fp,
        gh_age_days: age,
        note,
        status: "pending",
        created_at: now,
        decided_at: null,
      });
      return { meta: { changes: 1, last_row_id: this.db.whitelistRequests.length } };
    }
    if (this.sql.includes("UPDATE whitelist_requests SET status='approved'")) {
      const [decidedAt, id] = this.args as [number, number];
      const row = this.db.whitelistRequests.find((r) => r.id === id);
      if (row) {
        row.status = "approved";
        row.decided_at = decidedAt;
      }
      return { meta: { changes: row ? 1 : 0 } };
    }
    if (this.sql.includes("UPDATE whitelist_requests SET status='rejected'")) {
      const [decidedAt, id] = this.args as [number, number];
      const row = this.db.whitelistRequests.find((r) => r.id === id);
      if (row) {
        row.status = "rejected";
        row.decided_at = decidedAt;
      }
      return { meta: { changes: row ? 1 : 0 } };
    }
    if (
      this.sql.includes("UPDATE accounts SET status=?") &&
      this.sql.includes("WHERE lower(handle)=? AND x_user_id=?")
    ) {
      const [status, _publishedAt, _publishedTier, _category, handle, uid] = this.args as [
        string,
        number | null,
        string | null,
        string | null,
        string,
        string,
      ];
      const existing = this.db.accounts.find(
        (account) =>
          account.x_user_id === uid && account.handle.toLowerCase() === handle.toLowerCase(),
      );
      if (existing) existing.status = status;
      return { meta: { changes: existing ? 1 : 0 } };
    }
    if (
      this.sql.includes("UPDATE accounts SET status=?, published_at=NULL") &&
      this.sql.includes("x_user_id IS NULL")
    ) {
      const [status, handle] = this.args as [string, string];
      let changes = 0;
      for (const account of this.db.accounts) {
        if (
          account.x_user_id === null &&
          account.status === "auto_pending_review" &&
          account.handle.toLowerCase() === handle.toLowerCase()
        ) {
          account.status = status;
          changes++;
        }
      }
      return { meta: { changes } };
    }
    if (
      this.sql.includes("UPDATE accounts") &&
      this.sql.includes("x_user_id=COALESCE(x_user_id, ?)") &&
      this.sql.includes("WHERE rowid=?")
    ) {
      const [uid, handle, reasons, _now, _displayName, _avatarUrl, rowid] = this.args as [
        string | null,
        string,
        string,
        number,
        string | null,
        string | null,
        number,
      ];
      const existing = this.db.accounts.find((account) => account.rowid === rowid);
      if (existing) {
        existing.x_user_id = existing.x_user_id ?? uid;
        existing.handle = handle;
        existing.status = "whitelisted";
        existing.verdict_label = "legit";
        existing.confidence = 1;
        existing.reasons = reasons;
      }
      return { meta: { changes: existing ? 1 : 0 } };
    }
    if (
      this.sql.includes("UPDATE accounts") &&
      this.sql.includes("source='auto_dedup_to_uid_twin'") &&
      this.sql.includes("WHERE rowid<>?")
    ) {
      const [keepRowid, handle] = this.args as [number, string];
      let changes = 0;
      for (const account of this.db.accounts) {
        if (
          account.rowid !== keepRowid &&
          account.x_user_id === null &&
          account.status !== "removed" &&
          account.handle.toLowerCase() === handle.toLowerCase()
        ) {
          account.status = "removed";
          changes++;
        }
      }
      return { meta: { changes } };
    }
    if (this.sql.includes("INSERT INTO accounts") && this.sql.includes("ON CONFLICT")) {
      // whitelistUpsert: any physical identity guard converges on one row.
      const [uid, handle, _dn, _av, reasons] = this.args as [
        string | null,
        string,
        string,
        string | null,
        string,
      ];
      const existing = this.db.accounts.find(
        (a) =>
          (uid !== null && a.x_user_id === uid) ||
          (uid === null &&
            a.x_user_id === null &&
            a.status !== "removed" &&
            a.handle.toLowerCase() === handle.toLowerCase()),
      );
      if (existing) {
        existing.status = "whitelisted";
        existing.verdict_label = "legit";
        existing.confidence = 1.0;
        existing.reasons = reasons;
      } else {
        this.db.accounts.push({
          rowid: this.db.accounts.length + 1,
          handle,
          x_user_id: uid,
          status: "whitelisted",
          verdict_label: "legit",
          confidence: 1.0,
          reasons,
        });
      }
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
      this.db.reviewLog.push({
        handle: this.args[1] as string,
        action: this.args[2] as string,
        actor: this.args[3] as string,
      });
      return { meta: { changes: 1 } };
    }
    return { meta: { changes: 1 } };
  }
}

class MockDB implements D1Database {
  accounts: Account[] = [];
  whitelistRequests: WhitelistRequest[] = [];
  rateLog: { fp: string; created_at: number }[] = [];
  bans: {
    id: number;
    reporter_fp: string;
    reason: string | null;
    created_by: string;
    created_at: number;
    expires_at: number | null;
  }[] = [];
  reviewLog: { handle: string; action: string; actor: string }[] = [];

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
    ADMIN_TOKEN: "admin",
  };
}

// Token → GitHub identity mapping: "aged-token" is a 2020 account (old
// enough), "young-token" registered yesterday (fails the 90d gate).
globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url === "https://api.github.com/user") {
    const headers = new Headers(
      input instanceof Request ? input.headers : (init?.headers ?? {}),
    );
    const auth = headers.get("authorization") ?? "";
    if (auth.includes("young-token")) {
      return Response.json({
        id: 7,
        created_at: new Date(Date.now() - 86_400_000).toISOString(),
      });
    }
    return Response.json({ id: 42, created_at: "2020-01-01T00:00:00Z" });
  }
  return originalFetch(input as never, init);
};

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

function applyRequest(token = "aged-token", body: Record<string, unknown> = { handle: "myself" }) {
  return new Request("https://x.test/v1/whitelist/apply", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function adminWhitelistRequest(body: Record<string, unknown>) {
  return new Request("https://x.test/v1/admin/whitelist", {
    method: "POST",
    headers: { "x-admin-token": "admin", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function adminDecideRequest(body: Record<string, unknown>) {
  return new Request("https://x.test/v1/admin/decide", {
    method: "POST",
    headers: { "x-admin-token": "admin", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("whitelist apply rejects a GH account younger than 90 days with 403", async () => {
  const db = new MockDB();
  const res = await worker.fetch(applyRequest("young-token"), env(db));
  assert.equal(res.status, 403);
  const body = (await res.json()) as { error: string };
  assert.equal(body.error, "gh_account_too_young");
  assert.equal(db.whitelistRequests.length, 0);
});

test("whitelist apply returns 401 without GitHub auth when REQUIRE_AUTH is on", async () => {
  const db = new MockDB();
  const res = await worker.fetch(
    new Request("https://x.test/v1/whitelist/apply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ handle: "myself" }),
    }),
    env(db),
  );
  assert.equal(res.status, 401);
});

test("whitelist apply fails closed (503) when REPORT_SALT is unset", async () => {
  const db = new MockDB();
  const { REPORT_SALT: _salt, ...noSalt } = env(db);
  const res = await worker.fetch(applyRequest(), noSalt);
  assert.equal(res.status, 503);
  assert.equal(db.whitelistRequests.length, 0);
});

test("whitelist apply returns 409 when the fingerprint already has a pending request", async () => {
  const db = new MockDB();
  db.whitelistRequests.push({
    id: 1,
    x_user_id: null,
    handle: "earlier",
    reporter_fp: await reporterFp(),
    gh_age_days: 2000,
    note: null,
    status: "pending",
    created_at: Date.now(),
    decided_at: null,
  });
  const res = await worker.fetch(applyRequest("aged-token", { handle: "myself" }), env(db));
  assert.equal(res.status, 409);
  const body = (await res.json()) as { error: string };
  assert.equal(body.error, "already_pending");
  assert.equal(db.whitelistRequests.length, 1);
});

test("whitelist apply returns 409 when the handle already has a pending request", async () => {
  const db = new MockDB();
  db.whitelistRequests.push({
    id: 1,
    x_user_id: null,
    handle: "myself",
    reporter_fp: "rpt:someoneelse",
    gh_age_days: 2000,
    note: null,
    status: "pending",
    created_at: Date.now(),
    decided_at: null,
  });
  const res = await worker.fetch(applyRequest(), env(db));
  assert.equal(res.status, 409);
  assert.equal(db.whitelistRequests.length, 1);
});

test("whitelist apply returns 403 for a banned reporter", async () => {
  const db = new MockDB();
  db.bans.push({
    id: 1,
    reporter_fp: await reporterFp(),
    reason: "abuse",
    created_by: "admin",
    created_at: Date.now(),
    expires_at: null,
  });
  const res = await worker.fetch(applyRequest(), env(db));
  assert.equal(res.status, 403);
  const body = (await res.json()) as { error: string };
  assert.equal(body.error, "reporter_banned");
  assert.equal(db.whitelistRequests.length, 0);
});

test("whitelist apply short-circuits with already_whitelisted for a whitelisted account", async () => {
  const db = new MockDB();
  db.accounts.push({
    rowid: 1,
    handle: "myself",
    x_user_id: "900",
    status: "whitelisted",
    verdict_label: "legit",
    confidence: 1,
  });
  const res = await worker.fetch(applyRequest(), env(db));
  assert.equal(res.status, 200);
  const body = (await res.json()) as { status: string };
  assert.equal(body.status, "already_whitelisted");
  assert.equal(db.whitelistRequests.length, 0);
});

test("whitelist apply queues a pending request with HMAC fp, audit row, and rate sample", async () => {
  const db = new MockDB();
  const res = await worker.fetch(
    applyRequest("aged-token", { handle: "@Myself", userId: "900", note: "I am a real human" }),
    env(db),
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as { ok: boolean; status: string };
  assert.equal(body.ok, true);
  assert.equal(body.status, "pending");
  assert.equal(db.whitelistRequests.length, 1);
  const row = db.whitelistRequests[0];
  assert.ok(row);
  assert.equal(row.handle, "myself"); // normalized: @ stripped, lowercased
  assert.equal(row.x_user_id, "900");
  assert.equal(row.reporter_fp, await reporterFp());
  assert.notEqual(row.reporter_fp, "gh:42");
  assert.equal(row.note, "I am a real human");
  assert.ok((row.gh_age_days ?? 0) >= 90);
  assert.equal(db.reviewLog[0]?.action, "whitelist_apply");
  assert.ok(db.reviewLog[0]?.actor.startsWith("reporter:"));
  assert.equal(db.rateLog.length, 1);
});

test("whitelist apply status returns the latest application for the identity", async () => {
  const db = new MockDB();
  db.whitelistRequests.push({
    id: 1,
    x_user_id: null,
    handle: "myself",
    reporter_fp: await reporterFp(),
    gh_age_days: 2000,
    note: null,
    status: "approved",
    created_at: 1000,
    decided_at: 2000,
  });
  const res = await worker.fetch(
    new Request("https://x.test/v1/whitelist/apply/status", {
      headers: { authorization: "Bearer aged-token" },
    }),
    env(db),
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as { status: string; handle?: string };
  assert.equal(body.status, "approved");
  assert.equal(body.handle, "myself");
});

test("whitelist apply status returns none for an identity that never applied", async () => {
  const db = new MockDB();
  const res = await worker.fetch(
    new Request("https://x.test/v1/whitelist/apply/status", {
      headers: { authorization: "Bearer aged-token" },
    }),
    env(db),
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as { status: string };
  assert.equal(body.status, "none");
});

test("admin whitelist-requests list flags an applicant that is on the blacklist", async () => {
  const db = new MockDB();
  db.accounts.push({
    rowid: 1,
    handle: "badguy",
    x_user_id: "700",
    status: "human_confirmed",
    verdict_label: "spam",
    confidence: 0.97,
  });
  db.whitelistRequests.push({
    id: 1,
    x_user_id: "700",
    handle: "badguy",
    reporter_fp: "rpt:abc",
    gh_age_days: 400,
    note: "please",
    status: "pending",
    created_at: Date.now(),
    decided_at: null,
  });
  const res = await worker.fetch(
    new Request("https://x.test/v1/admin/whitelist-requests?status=pending", {
      headers: { "x-admin-token": "admin" },
    }),
    env(db),
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    list: { handle: string; account_status: string | null; account_verdict_label: string | null }[];
  };
  assert.equal(body.list.length, 1);
  assert.equal(body.list[0]?.account_status, "human_confirmed");
  assert.equal(body.list[0]?.account_verdict_label, "spam");
});

test("admin approve flips the account to whitelisted and settles the request", async () => {
  const db = new MockDB();
  db.accounts.push({
    rowid: 1,
    handle: "myself",
    x_user_id: "900",
    status: "auto_pending_review",
    verdict_label: "uncertain",
    confidence: 0.5,
  });
  db.whitelistRequests.push({
    id: 1,
    x_user_id: "900",
    handle: "myself",
    reporter_fp: await reporterFp(),
    gh_age_days: 2000,
    note: "real human",
    status: "pending",
    created_at: Date.now(),
    decided_at: null,
  });
  const res = await worker.fetch(
    new Request("https://x.test/v1/admin/whitelist-requests/1/approve", {
      method: "POST",
      headers: { "x-admin-token": "admin" },
    }),
    env(db),
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as { ok: boolean; status: string };
  assert.equal(body.ok, true);
  assert.equal(body.status, "approved");
  assert.equal(db.accounts[0]?.status, "whitelisted");
  assert.equal(db.accounts[0]?.verdict_label, "legit");
  assert.equal(db.whitelistRequests[0]?.status, "approved");
  assert.ok(db.whitelistRequests[0]?.decided_at);
  assert.equal(db.reviewLog[0]?.action, "whitelist_request_approve");
});

test("admin approve whitelists the canonical uid row even after a handle rename", async () => {
  // The classic appeal shape: blacklisted under the old handle, applicant has
  // since renamed. The uid row must be updated in place — a plain (uid,handle)
  // INSERT would trip the uid-only partial unique index and 500.
  const db = new MockDB();
  db.accounts.push({
    rowid: 1,
    handle: "old_name",
    x_user_id: "900",
    status: "human_confirmed",
    verdict_label: "spam",
    confidence: 0.9,
  });
  db.whitelistRequests.push({
    id: 1,
    x_user_id: "900",
    handle: "new_name",
    reporter_fp: await reporterFp(),
    gh_age_days: 2000,
    note: "renamed since",
    status: "pending",
    created_at: Date.now(),
    decided_at: null,
  });
  const res = await worker.fetch(
    new Request("https://x.test/v1/admin/whitelist-requests/1/approve", {
      method: "POST",
      headers: { "x-admin-token": "admin" },
    }),
    env(db),
  );
  assert.equal(res.status, 200);
  assert.equal(db.accounts.length, 1);
  assert.equal(db.accounts[0]?.status, "whitelisted");
  assert.equal(db.accounts[0]?.handle, "new_name");
  assert.equal(db.whitelistRequests[0]?.status, "approved");
});

test("admin add with a numeric uid collapses a pre-existing handle-only sibling", async () => {
  const db = new MockDB();
  db.accounts.push(
    {
      rowid: 1,
      handle: "same_person",
      x_user_id: "900",
      status: "auto_pending_review",
      verdict_label: "uncertain",
      confidence: 0.5,
    },
    {
      rowid: 2,
      handle: "same_person",
      x_user_id: null,
      status: "auto_pending_review",
      verdict_label: "uncertain",
      confidence: 0.5,
    },
  );

  const res = await worker.fetch(
    adminWhitelistRequest({ handle: "same_person", xUserId: "900" }),
    env(db),
  );

  assert.equal(res.status, 200);
  const whitelisted = db.accounts.filter((account) => account.status === "whitelisted");
  assert.equal(whitelisted.length, 1);
  assert.equal(whitelisted[0]?.x_user_id, "900");
  assert.equal(db.accounts.find((account) => account.x_user_id === null)?.status, "removed");
});

test("admin add with a numeric uid does not whitelist a different uid sharing the handle", async () => {
  const db = new MockDB();
  db.accounts.push(
    {
      rowid: 1,
      handle: "recycled_handle",
      x_user_id: "900",
      status: "auto_pending_review",
      verdict_label: "uncertain",
      confidence: 0.5,
    },
    {
      rowid: 2,
      handle: "recycled_handle",
      x_user_id: "800",
      status: "human_confirmed",
      verdict_label: "spam",
      confidence: 0.9,
    },
  );

  const res = await worker.fetch(
    adminWhitelistRequest({ handle: "recycled_handle", xUserId: "900" }),
    env(db),
  );

  assert.equal(res.status, 200);
  const whitelisted = db.accounts.filter((account) => account.status === "whitelisted");
  assert.deepEqual(
    whitelisted.map((account) => account.x_user_id),
    ["900"],
  );
  assert.equal(
    db.accounts.find((account) => account.x_user_id === "800")?.status,
    "human_confirmed",
  );
});

test("admin handle-only whitelist add is idempotent", async () => {
  const db = new MockDB();
  const requestBody = { handle: "no_uid_person" };

  const first = await worker.fetch(adminWhitelistRequest(requestBody), env(db));
  const second = await worker.fetch(adminWhitelistRequest(requestBody), env(db));

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  const whitelisted = db.accounts.filter((account) => account.status === "whitelisted");
  assert.equal(whitelisted.length, 1);
});

test("admin mixed-case handle-only whitelist add reuses the canonical row", async () => {
  const db = new MockDB();
  db.accounts.push({
    rowid: 1,
    handle: "realchaindoctor",
    x_user_id: null,
    status: "whitelisted",
    verdict_label: "legit",
    confidence: 1,
  });

  const requestBody = { handle: "realChainDoctor" };
  const first = await worker.fetch(adminWhitelistRequest(requestBody), env(db));
  const second = await worker.fetch(adminWhitelistRequest(requestBody), env(db));

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  const whitelisted = db.accounts.filter((account) => account.status === "whitelisted");
  assert.equal(whitelisted.length, 1);
  assert.equal(whitelisted[0]?.handle, "realchaindoctor");
});

test("admin blacklist with a numeric uid removes a pending handle-only sibling", async () => {
  const db = new MockDB();
  db.accounts.push(
    {
      rowid: 1,
      handle: "same_person",
      x_user_id: "900",
      status: "auto_pending_review",
      verdict_label: "spam",
      confidence: 0.9,
    },
    {
      rowid: 2,
      handle: "same_person",
      x_user_id: null,
      status: "auto_pending_review",
      verdict_label: "uncertain",
      confidence: 0.5,
    },
  );

  const res = await worker.fetch(
    adminDecideRequest({ handle: "same_person", xUserId: "900", action: "approve" }),
    env(db),
  );

  assert.equal(res.status, 200);
  const blacklisted = db.accounts.filter((account) => account.status === "human_confirmed");
  assert.equal(blacklisted.length, 1);
  assert.equal(blacklisted[0]?.x_user_id, "900");
  assert.equal(db.accounts.find((account) => account.x_user_id === null)?.status, "removed");
});

test("admin reject settles the request without touching the account", async () => {
  const db = new MockDB();
  db.accounts.push({
    rowid: 1,
    handle: "myself",
    x_user_id: "900",
    status: "auto_pending_review",
    verdict_label: "uncertain",
    confidence: 0.5,
  });
  db.whitelistRequests.push({
    id: 1,
    x_user_id: "900",
    handle: "myself",
    reporter_fp: "rpt:abc",
    gh_age_days: 2000,
    note: null,
    status: "pending",
    created_at: Date.now(),
    decided_at: null,
  });
  const res = await worker.fetch(
    new Request("https://x.test/v1/admin/whitelist-requests/1/reject", {
      method: "POST",
      headers: { "x-admin-token": "admin" },
    }),
    env(db),
  );
  assert.equal(res.status, 200);
  assert.equal(db.whitelistRequests[0]?.status, "rejected");
  assert.equal(db.accounts[0]?.status, "auto_pending_review");
});

test("admin approve returns 409 for an already-decided request", async () => {
  const db = new MockDB();
  db.whitelistRequests.push({
    id: 1,
    x_user_id: null,
    handle: "myself",
    reporter_fp: "rpt:abc",
    gh_age_days: 2000,
    note: null,
    status: "rejected",
    created_at: Date.now(),
    decided_at: Date.now(),
  });
  const res = await worker.fetch(
    new Request("https://x.test/v1/admin/whitelist-requests/1/approve", {
      method: "POST",
      headers: { "x-admin-token": "admin" },
    }),
    env(db),
  );
  assert.equal(res.status, 409);
});

test("admin whitelist-requests endpoints reject a wrong token with 403", async () => {
  const db = new MockDB();
  const res = await worker.fetch(
    new Request("https://x.test/v1/admin/whitelist-requests", {
      headers: { "x-admin-token": "nope" },
    }),
    env(db),
  );
  assert.equal(res.status, 403);
});
