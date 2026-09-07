// Exercise the actual deployment entrypoint in workerd, not just Node imports.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

const port = await freePort();
const inspector = await freePort();
const state = await mkdtemp(join(tmpdir(), "mxga-worker-smoke-"));
const child = spawn(
  process.execPath,
  [
    "node_modules/wrangler/bin/wrangler.js",
    "dev",
    "--local",
    "--ip",
    "127.0.0.1",
    "--port",
    String(port),
    "--inspector-port",
    String(inspector),
    "--persist-to",
    state,
    "--var",
    "REQUIRE_AUTH:1",
    "--var",
    "REPORT_SALT:fixture",
    "--var",
    "ADMIN_TOKEN:fixture",
    "--var",
    "AGENT_TOKEN:fixture",
    "--var",
    "LLM_API_BASE:https://fixture.invalid",
    "--var",
    "LLM_API_KEY:fixture",
    "--var",
    "LLM_API_MODEL:fixture",
  ],
  {
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, CI: "true", WRANGLER_SEND_METRICS: "false" },
  },
);
let output = "";
for (const stream of [child.stdout, child.stderr]) {
  stream.on("data", (chunk) => {
    output = (output + chunk).slice(-64_000);
  });
}
const exited = new Promise((resolve) => child.once("exit", resolve));
const base = `http://127.0.0.1:${port}`;
try {
  let ready = false;
  // At most 40 startup probes and 6 route requests; no scheduled events.
  for (let attempt = 0; attempt < 40; attempt++) {
    if (child.exitCode !== null) throw new Error(`workerd exited: ${child.exitCode}`);
    try {
      const response = await fetch(`${base}/v1/health`, { signal: AbortSignal.timeout(500) });
      ready = response.ok && (await response.json()).ok === true;
    } catch {
      /* startup is still in progress */
    }
    if (ready) break;
    await delay(250);
  }
  assert.ok(ready, "workerd must start and answer health probes");
  const checks = [
    ["GET", "/v1/health", 200],
    ["GET", "/", 200],
    ["GET", "/admin", 200],
    ["GET", "/v1/admin/stats", 403],
    ["GET", "/v1/agent/queue", 403],
    ["POST", "/v1/classify", 401],
  ];
  for (const [method, path, expected] of checks) {
    const response = await fetch(`${base}${path}`, { method, signal: AbortSignal.timeout(3000) });
    await response.arrayBuffer();
    assert.equal(response.status, expected, `${method} ${path}`);
  }
  console.log(JSON.stringify({ passed: true, runtime: "workerd", checks }));
} catch (error) {
  console.error(output);
  throw error;
} finally {
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    /* already exited */
  }
  await Promise.race([exited, delay(2000)]);
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    /* already exited */
  }
  await rm(state, { recursive: true, force: true });
}
