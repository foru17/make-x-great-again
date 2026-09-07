import { chromium, CHROME, OUT } from "./runtime.mjs";
import { page as fixture } from "../inpage/fixture.mjs";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import assert from "node:assert/strict";
const ext = resolve("extension/.output/chrome-mv3");
const ctx = await chromium.launchPersistentContext(mkdtempSync(`${tmpdir()}/mxga-actions-`), {
  executablePath: CHROME,
  headless: true,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
const calls = [];
try {
  await ctx.route("https://x.com/**", (r) => {
    if (r.request().method() === "POST") {
      calls.push(r.request().url());
      return r.fulfill({ json: {} });
    }
    return r.fulfill({
      contentType: "text/html",
      body: fixture({ path: new URL(r.request().url()).pathname, theme: "lightsout" }),
    });
  });
  await ctx.route("https://pbs.twimg.com/**", (r) => r.abort());
  await ctx.addCookies([{ name: "ct0", value: "fixture-only", domain: "x.com", path: "/" }]);
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent("serviceworker"));
  await sw.evaluate(async () => {
    await chrome.storage.local.clear();
    await chrome.storage.local.set({
      "xss:settings": {
        edgeBase: "https://127.0.0.1:1",
        actionMode: "block",
        autoProcess: false,
        followingWhitelist: true,
      },
      "xss:whitelist:local": {
        entries: [{ handle: "spam_confirmed", userId: "1001", source: "manual", addedAt: 1 }],
        excluded: [],
      },
      "xss:blocked": ["h:spam_confirmed", "1001"],
      "xss:pending-actions": [{ id: "1001", handle: "spam_confirmed", action: "block", ts: 1 }],
    });
  });
  const p = await ctx.newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(String(e)));
  await p.goto("https://x.com/home");
  await p.locator("article").first().locator(".xss-mount").waitFor();
  await p.waitForTimeout(2500);
  const visible = await p.locator("article").filter({ hasText: "@spam_confirmed" }).isVisible();
  const result = { calls, visible, errors };
  console.log(JSON.stringify(result));
  writeFileSync(`${OUT}/whitelist-actions-result.json`, JSON.stringify(result, null, 2));
  await p.screenshot({ path: `${OUT}/whitelist-actions.png`, fullPage: true });
  assert.deepEqual(calls, [], "a whitelisted account must never resume an X action");
  assert.equal(visible, true, "whitelist protection outranks an old hidden ID");
  assert.deepEqual(errors, []);
} finally {
  await ctx.close();
}
