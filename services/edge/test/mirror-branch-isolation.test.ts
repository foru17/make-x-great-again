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

interface GitHubCall {
  method: string;
  url: URL;
  body: Record<string, unknown> | null;
}

class MirrorStmt {
  constructor(
    private db: MirrorDB,
    private sql: string,
  ) {}

  bind(): MirrorStmt {
    return this;
  }

  async all<T>(): Promise<{ results: T[] }> {
    this.db.reads.push(this.sql);
    if (this.sql.includes("status='whitelisted'")) {
      return {
        results: [
          { x_user_id: "100", handle: "safe_user", last_scored: 1_700_000_000_000 },
        ] as T[],
      };
    }
    if (this.sql.includes("status='human_confirmed'")) {
      return { results: [] };
    }
    if (this.sql.includes("FROM keyword_rules")) return { results: [] };
    throw new Error(`unexpected SQL: ${this.sql}`);
  }
}

class MirrorDB {
  reads: string[] = [];

  prepare(sql: string): MirrorStmt {
    return new MirrorStmt(this, sql);
  }
}

const request = () =>
  new Request("https://edge.test/v1/admin/sync-mirror", {
    method: "POST",
    headers: { "x-admin-token": "admin" },
  });

function env(db: MirrorDB, branch?: string) {
  return {
    ADMIN_TOKEN: "admin",
    WHITELIST_SYNC_TOKEN: "github-token",
    WHITELIST_SYNC_REPO: "owner/repo",
    ...(branch ? { WHITELIST_SYNC_BRANCH: branch } : {}),
    DB: db,
  };
}

beforeEach(() => {
  globalThis.fetch = originalFetch;
});

test("mirror refuses to run without an explicit data branch", async () => {
  const db = new MirrorDB();
  let fetched = false;
  globalThis.fetch = (async () => {
    fetched = true;
    throw new Error("must not reach GitHub");
  }) as typeof fetch;

  const response = await worker.fetch(request(), env(db));

  assert.equal(response.status, 503);
  assert.equal(
    ((await response.json()) as { error: string }).error,
    "mirror_branch_not_configured",
  );
  assert.equal(fetched, false);
  assert.deepEqual(db.reads, []);
});

test("mirror reads and writes only the configured non-default branch", async () => {
  const db = new MirrorDB();
  const calls: GitHubCall[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    );
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
    calls.push({ method, url, body });
    if (url.pathname === "/repos/owner/repo") {
      return Response.json({ default_branch: "main" });
    }
    if (url.pathname === "/repos/owner/repo/git/ref/heads/curated-data") {
      return Response.json({ ref: "refs/heads/curated-data" });
    }
    if (method === "GET" && url.pathname.includes("/contents/")) {
      return new Response("missing file", { status: 404 });
    }
    if (method === "PUT" && url.pathname.includes("/contents/")) {
      return Response.json({ content: {}, commit: {} }, { status: 201 });
    }
    return new Response("unexpected", { status: 500 });
  }) as typeof fetch;

  const response = await worker.fetch(request(), env(db, "curated-data"));
  const payload = (await response.json()) as { ok: boolean };

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  const contentGets = calls.filter(
    (call) => call.method === "GET" && call.url.pathname.includes("/contents/"),
  );
  const contentPuts = calls.filter(
    (call) => call.method === "PUT" && call.url.pathname.includes("/contents/"),
  );
  assert.equal(contentGets.length, 3);
  assert.equal(contentPuts.length, 3);
  assert.ok(contentGets.every((call) => call.url.searchParams.get("ref") === "curated-data"));
  assert.ok(contentPuts.every((call) => call.body?.branch === "curated-data"));
});

test("mirror fails closed when the configured branch is the repository default", async () => {
  const db = new MirrorDB();
  const paths: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    );
    paths.push(url.pathname);
    return Response.json({ default_branch: "main" });
  }) as typeof fetch;

  const response = await worker.fetch(request(), env(db, "main"));

  assert.equal(response.status, 502);
  assert.deepEqual(paths, ["/repos/owner/repo"]);
  assert.deepEqual(db.reads, []);
});

test("mirror reports a missing data branch before reading D1 or writing files", async () => {
  const db = new MirrorDB();
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    );
    calls.push(url.pathname);
    if (url.pathname === "/repos/owner/repo") return Response.json({ default_branch: "main" });
    return new Response("missing branch", { status: 404 });
  }) as typeof fetch;

  const response = await worker.fetch(request(), env(db, "curated-data"));

  assert.equal(response.status, 502);
  assert.deepEqual(calls, [
    "/repos/owner/repo",
    "/repos/owner/repo/git/ref/heads/curated-data",
  ]);
  assert.deepEqual(db.reads, []);
});
