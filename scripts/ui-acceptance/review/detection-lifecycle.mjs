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
    globalThis.releaseClassify = null;
    globalThis.fetch = async (url) => {
      if (String(url).endsWith("/v1/classify"))
        return new Promise((resolve) => {
          globalThis.releaseClassify = () =>
            resolve(
              Response.json({
                record: { verdict: { label: "spam", confidence: 1, reasons: ["fixture"] } },
              }),
            );
        });
      return new Response("{}", { status: 404 });
    };
    await chrome.storage.local.clear();
    await chrome.storage.local.set({
      "xss:settings": { edgeBase: "https://fixture.invalid", autoProcess: false },
      "xss:ghToken": "fixture-only",
      "xss:whitelist:local": {
        entries: [
          "someone",
          "spam_confirmed",
          "spam_auto",
          "rulehit_bot",
          "local_wl_user",
          "cached_spam",
        ].map((handle) => ({ handle, source: "manual", addedAt: 1 })),
        excluded: [],
      },
    });
  });
  const p = await ctx.newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(String(e)));
  await p.goto("https://x.com/home");
  const target = p.locator("article").filter({ hasText: "@ghost_user" });
  await target.locator(".xss-badge.analyzing").waitFor();
  // Wait for the background request to be held (bounded polling).
  for (let i = 0; i < 20; i++) {
    if (await sw.evaluate(() => !!globalThis.releaseClassify)) break;
    await p.waitForTimeout(50);
  }
  await sw.evaluate(async () => {
    const key = "xss:whitelist:local";
    const got = await chrome.storage.local.get(key);
    got[key].entries.push({ handle: "ghost_user", source: "manual", addedAt: 1 });
    await chrome.storage.local.set(got);
  });
  await target.locator(".xss-badge.analyzing").waitFor({ state: "detached" });
  await p.waitForTimeout(200);
  await sw.evaluate(() => globalThis.releaseClassify());
  await p.waitForTimeout(500);
  const classes = await target
    .locator(".xss-badge")
    .evaluateAll((nodes) => nodes.map((n) => n.className));
  const findingsText = await p.locator("xss-bubble .xss-bubble").innerText();
  console.log(JSON.stringify({ classes, errors, protectedAuthorInFindings: findingsText.includes("@ghost_user") }));
  await p.screenshot({ path: `${OUT}/detection-lifecycle.png`, fullPage: true });
  assert.ok(
    classes.every((c) => c.includes("ghost") || c.includes("checked")),
    "late classification must not badge a newly whitelisted account",
  );
  assert.ok(
    !findingsText.includes("@ghost_user"),
    "newly whitelisted author must not return to findings",
  );
  assert.deepEqual(errors, []);
} finally {
  await ctx.close();
}
