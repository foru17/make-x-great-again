// Local fixture preview: real Worker routes + SQLite, no production credentials.
import { createServer } from "node:http";
import { readFileSync, appendFileSync, mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { resolve, extname } from "node:path";
import worker from "../../../services/edge/src/index.ts";
const root = resolve(import.meta.dirname, "../../..");
const edge = resolve(root, "services/edge");
mkdirSync(resolve(root, ".ui-acceptance/2026-09-23-unified"), { recursive: true });
const db = new DatabaseSync(":memory:");
db.exec(readFileSync(resolve(edge, "schema.sql"), "utf8"));
db.exec(readFileSync(resolve(edge, "migrations/2026-05-27-agent-pipeline.sql"), "utf8"));
const DB = {
  prepare(sql: string) {
    const stmt = db.prepare(sql);
    let args: any[] = [];
    const wrapper = {
      bind(...values: any[]) {
        args = values;
        return wrapper;
      },
      async first() {
        return stmt.get(...args) ?? null;
      },
      async all() {
        return { results: stmt.all(...args) };
      },
      async run() {
        return { meta: { changes: Number(stmt.run(...args).changes) } };
      },
    };
    return wrapper;
  },
  async batch(statements: any[]) {
    db.exec("BEGIN");
    try {
      const r = [];
      for (const s of statements) r.push(await s.run());
      db.exec("COMMIT");
      return r;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  },
};
function seed() {
  db.exec("DELETE FROM accounts; DELETE FROM review_log;");
  const statuses = ["auto_pending_review", "agent_pending", "agent_blacklist", "agent_whitelist"];
  for (let i = 0; i < 112; i++) {
    const status = statuses[i % 4];
    db.prepare(`INSERT INTO accounts(handle,x_user_id,display_name,verdict_label,confidence,status,source,evidence_text,reasons,
    first_seen,last_scored,category,followers_count,following_count,account_created_at,
    agent_id,agent_label,agent_confidence,agent_reasons,agent_signals,agent_evidence,agent_at,agent_model)
    VALUES (?,?,?,'spam',0.92,?,'report',?,'["初筛发现重复推广，需要结合上下文复核"]',?,?,?,?,25,'2024-03-01',?,?,?,?,?,?,?,'fixture-model')`).run(
      `review_${i}`,
      String(90000 + i),
      ["示例 · 社区推广账号", "示例 · 内容不足待判断", "示例 · 重复商业引流", "示例 · 独立创作者"][
        i % 4
      ],
      status,
      i % 4 === 3
        ? "正在发布自己创作的摄影作品，欢迎交流。"
        : "演示证据：重复发布推广文案，需要维护者核对上下文。",
      Date.now() - 86400000,
      Date.now() - i * 60000,
      i % 4 === 2 ? "porn" : "marketing",
      i % 4 === 3 ? 25000 : 32,
      i % 4 ? "fixture-reviewer" : null,
      i % 4 === 3 ? "legit" : i % 4 === 2 ? "spam" : "uncertain",
      i % 4 === 1 ? 0.4 : 0.98,
      i % 4 === 1
        ? '["insufficient hard evidence"]'
        : i % 4 === 2
          ? '["hard evidence P3"]'
          : '["no blacklistable evidence"]',
      i % 4 === 2 ? '["P3"]' : "[]",
      JSON.stringify({ followers_count: 32 }),
      Date.now() - 3600000,
    );
  }
}
seed();
const avatar = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" rx="20" fill="#64748b"/><text x="20" y="26" text-anchor="middle" font-family="sans-serif" font-size="18" fill="white">R</text></svg>').toString("base64")}`;
db.prepare("UPDATE accounts SET avatar_url=?").run(avatar);
let calls = 0;
createServer(async (req, res) => {
  if (++calls > 600) {
    res.writeHead(429);
    res.end("fixture request cap reached");
    return;
  }
  const url = new URL(req.url!, "http://127.0.0.1:4318");
  try {
    if (url.pathname === "/__fixture/reset" && req.method === "POST") {
      seed();
      db.prepare("UPDATE accounts SET avatar_url=?").run(avatar);
      res.end("reset");
      return;
    }
    if (url.pathname === "/__fixture/state") {
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          counts: db.prepare("SELECT status,count(*) n FROM accounts GROUP BY status").all(),
          log: db.prepare("SELECT action,count(*) n FROM review_log GROUP BY action").all(),
        }),
      );
      return;
    }
    if (url.pathname.startsWith("/v1/admin/")) {
      let body = "";
      for await (const part of req) body += part;
      if (url.searchParams.get("q") === "force_error") {
        res.writeHead(503);
        res.end("fixture failure");
        return;
      }
      const response = await worker.fetch(
        new Request(url, {
          method: req.method,
          headers: req.headers as HeadersInit,
          ...(body ? { body } : {}),
        }),
        { DB, ADMIN_TOKEN: "fixture" } as any,
      );
      const result = await response.text();
      appendFileSync(
        resolve(root, ".ui-acceptance/2026-09-23-unified/requests.jsonl"),
        JSON.stringify({
          method: req.method,
          path: req.url,
          body: body ? JSON.parse(body) : null,
          status: response.status,
        }) + "\n",
      );
      res.writeHead(response.status, { "content-type": "application/json" });
      res.end(result);
      return;
    }
    if (req.method !== "GET") {
      res.writeHead(405);
      res.end();
      return;
    }
    const path =
      url.pathname === "/admin"
        ? resolve(edge, "static/app/index.html")
        : resolve(edge, "static", "." + url.pathname);
    if (!path.startsWith(resolve(edge, "static") + "/")) throw Error("path");
    let data = readFileSync(path);
    const types: Record<string, string> = {
      ".html": "text/html",
      ".js": "text/javascript",
      ".css": "text/css",
      ".svg": "image/svg+xml",
      ".png": "image/png",
    };
    if (extname(path) === ".html")
      data = Buffer.from(
        data
          .toString()
          .replace(
            "<head>",
            '<head><script>sessionStorage.setItem("xss_admin","fixture")</script>',
          ),
      );
    res.writeHead(200, { "content-type": types[extname(path)] ?? "application/octet-stream" });
    res.end(data);
  } catch (e) {
    console.error(e);
    res.writeHead(500);
    res.end("fixture error");
  }
}).listen(4318, "127.0.0.1", () =>
  console.log(
    "Fixture preview: http://127.0.0.1:4318/admin — 112 simulated accounts, cap 600 requests",
  ),
);
