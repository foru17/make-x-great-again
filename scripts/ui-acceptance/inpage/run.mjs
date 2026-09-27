// In-page UI acceptance: real build + simulated X pages, 3 X themes × 2 viewports.
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { page as fixture, AVATAR } from "./fixture.mjs";

const EXT = resolve(process.env.EXT ?? new URL("../../../extension/.output/chrome-mv3", import.meta.url).pathname);
const OUT = resolve(process.env.OUT ?? `.ui-acceptance/${new Date().toISOString().slice(0, 10)}-inpage`);
const CHROME =
  process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
mkdirSync(OUT, { recursive: true });

const PNG_1x1 =
  "iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAAQklEQVR42u3OMQEAAAgDoK1/aM3g4QcFSKvV8oQg4RCCEIQgBCEIQQhCEIIQhCAEIQhBCEIQghCEIAQhCEEI4hM8w1kB6sK+pZoAAAAASUVORK5CYII=";

const userDataDir = resolve(process.env.PROFILE ?? `${tmpdir()}/mxga-inpage-profile`);
const ctx = await chromium.launchPersistentContext(userDataDir, {
  executablePath: CHROME,
  headless: false,
  viewport: { width: 1440, height: 900 },
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, "--no-first-run", "--hide-scrollbars"],
  serviceWorkers: "allow",
});
let theme = "lightsout";
let mobile = false;
await ctx.route("https://x.com/**", (route) => {
  const u = new URL(route.request().url());
  if (route.request().resourceType() !== "document") return route.abort();
  return route.fulfill({ contentType: "text/html; charset=utf-8", body: fixture({ path: u.pathname, theme, mobile }) });
});
await ctx.route("https://pbs.twimg.com/**", (route) =>
  route.fulfill({ contentType: "image/png", body: Buffer.from(PNG_1x1, "base64") }),
);
await ctx.route("https://x.zuoluo.tv/**", (route) => route.abort());

let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 15000 });
await new Promise((r) => setTimeout(r, 1500));
const now = Date.now();
await sw.evaluate(async (now) => {
  await chrome.storage.local.set({
    "xss:settings": { autoProcess: false, followingWhitelist: true, bubble: true, bubblePos: "tr", edgeBase: "https://127.0.0.1:1" },
    "xss:list:v2": {
      version: "fixture",
      fetchedAt: now,
      count: 3,
      entries: [
        ["1001", "spam_confirmed", "pph"],
        ["1002", "spam_auto", "sma"],
        ["1003", "local_wl_user", "pph"],
      ],
      rules: [["主页能打", "t", "pp"]],
    },
    "xss:whitelist:v1": { fetchedAt: now, count: 1, entries: [["", "official_wl"]] },
    "xss:whitelist:local": { entries: [{ handle: "local_wl_user", userId: "1003", source: "manual", addedAt: now }] },
    "xss:v1:h:cached_spam": {
      verdict: { label: "spam", confidence: 0.9, reasons: ["网盘资源导流模板"] },
      signalsHash: "stale",
      model: "fixture",
      ts: now - 3600_000,
      handle: "cached_spam",
    },
  });
  return Object.keys(await chrome.storage.local.get(null));
}, now).then((k) => console.log("seeded:", k.join(",")));
await new Promise((r) => setTimeout(r, 4000));
await sw.evaluate(async (now) => {
  await chrome.storage.local.set({
    "xss:list:v2": { version: "fixture", fetchedAt: now, count: 3, entries: [["1001","spam_confirmed","pph"],["1002","spam_auto","sma"],["1003","local_wl_user","pph"]], rules: [["主页能打","t","pp"]] },
  });
  const l = (await chrome.storage.local.get("xss:list:v2"))["xss:list:v2"];
  return l.count + ":" + l.version;
}, now).then((v) => console.log("reseeded list", v));

const page = await ctx.newPage();
const shot = async (name, opts = {}) => {
  await page.screenshot({ path: `${OUT}/${name}.png`, ...opts });
  console.log("📸", name);
};
const badge = (handle) => page.locator("article", { hasText: `@${handle}` }).first().locator(".xss-badge").first();
const open = async (path) => {
  await page.goto(`https://x.com${path}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1800); // scan debounce + mounts
};

const report = [];
for (theme of ["light", "dim", "lightsout"]) {
  mobile = false;
  await page.setViewportSize({ width: 1440, height: 900 });
  await open("/home");
  await shot(`home-${theme}-desktop`);
  // popovers
  for (const h of ["spam_confirmed", "ghost_user", "local_wl_user", "rulehit_bot"]) {
    const b = badge(h);
    if ((await b.count()) === 0) {
      report.push(`MISSING badge for @${h} (${theme})`);
      continue;
    }
    await b.hover();
    await page.waitForTimeout(350);
    await shot(`popover-${h}-${theme}-desktop`);
    if (h === "ghost_user") {
      const rep = page.locator(".xss.pop [data-report]").first();
      if (await rep.count()) {
        await rep.click();
        await page.waitForTimeout(250);
        await shot(`popover-report-cats-${theme}-desktop`);
      } else report.push(`no report button on ghost popover (${theme})`);
    }
    await page.mouse.move(5, 5);
    await page.waitForTimeout(300);
  }
  // bubble card
  const pill = page.locator(".xss-bubble .pill").first();
  if (await pill.count()) {
    await pill.click();
    await page.waitForTimeout(400);
    await shot(`bubble-open-${theme}-desktop`);
    await pill.click();
  } else report.push(`no bubble pill (${theme})`);
  await open("/someone/status/100");
  await shot(`thread-${theme}-desktop`);
  await open("/spam_confirmed");
  await shot(`profile-${theme}-desktop`);

  mobile = true;
  await page.setViewportSize({ width: 390, height: 844 });
  await open("/home");
  await shot(`home-${theme}-mobile`);
  const b = badge("spam_confirmed");
  if (await b.count()) {
    await b.tap().catch(() => b.click());
    await page.waitForTimeout(350);
    await shot(`popover-spam_confirmed-${theme}-mobile`);
  }
  const pillM = page.locator(".xss-bubble .pill").first();
  if (await pillM.count()) {
    await pillM.click();
    await page.waitForTimeout(400);
    await shot(`bubble-open-${theme}-mobile`);
  }
}

// Auto-processing theatre (thread page, autoProcess on, porn → hide)
await sw.evaluate(async () => {
  const s = (await chrome.storage.local.get("xss:settings"))["xss:settings"] ?? {};
  await chrome.storage.local.set({ "xss:settings": { ...s, autoProcess: true, categoryActions: { porn: "hide", marketing: "hide" } } });
});
theme = "lightsout";
mobile = false;
await page.setViewportSize({ width: 1440, height: 900 });
await open("/someone/status/100");
await page.waitForTimeout(900);
await shot("thread-autoprocess-lightsout-desktop");
await page.waitForTimeout(6000);
await shot("thread-autoprocess-done-lightsout-desktop");

// Collect computed diagnostics from the page for the report.
const diag = await page.evaluate(() => {
  const out = [];
  for (const host of document.querySelectorAll(".xss-mount")) {
    const b = host.shadowRoot?.querySelector(".xss-badge");
    if (!b) continue;
    const cs = getComputedStyle(b);
    const r = b.getBoundingClientRect();
    out.push({ theme: host.getAttribute("data-xss-theme"), cls: b.className, color: cs.color, bg: cs.backgroundColor, h: Math.round(r.height), w: Math.round(r.width), text: b.textContent });
  }
  return out;
});
console.log(JSON.stringify(diag, null, 1));
console.log("REPORT:", report.length ? report.join("\n") : "no missing elements");
await ctx.close();
