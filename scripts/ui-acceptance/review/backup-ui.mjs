import { chromium, CHROME, OUT } from "./runtime.mjs";
import { resolve } from "node:path";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
const out = OUT;
const chrome = CHROME;
const baseline = process.argv.includes("--baseline");
const ext = resolve(baseline ? `${out}/baseline-extension` : "extension/.output/chrome-mv3");
const ctx = await chromium.launchPersistentContext(mkdtempSync(`${tmpdir()}/mxga-review-`), {
  executablePath: chrome,
  headless: true,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
try {
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent("serviceworker"));
  const id = new URL(sw.url()).host;
  await sw.evaluate(async () => {
    await chrome.storage.local.clear();
    await chrome.storage.local.set({
      "xss:settings": { edgeBase: "https://127.0.0.1:1", autoProcess: false },
      "xss:blocked": ["1001"],
      "xss:blocklist:v2": [{ id: "1001", handle: "fixture_bot", source: "manual", ts: 1 }],
      "xss:whitelist:local": {
        entries: [{ handle: "fixture_friend", source: "manual", addedAt: 1 }],
        excluded: [],
      },
      "xss:v1:1001": {
        verdict: { label: "spam", confidence: 1, reasons: [] },
        ts: 1,
        model: "fixture",
        signalsHash: "x",
      },
    });
  });
  const p = await ctx.newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(String(e)));
  const upload = async (data) =>
    p
      .locator("input[type=file]")
      .setInputFiles({
        name: "fixture.json",
        mimeType: "application/json",
        buffer: Buffer.from(
          JSON.stringify({
            format: "mxga-backup",
            version: 1,
            exportedAt: "2026-09-07T00:00:00Z",
            data,
          }),
        ),
      });
  for (const theme of ["light", "dark"])
    for (const width of [1440, 390]) {
      await p.emulateMedia({ colorScheme: theme });
      await p.setViewportSize({ width, height: 900 });
      await p.goto(`chrome-extension://${id}/options.html?tab=backup`);
      await p.getByText("导出备份文件", { exact: true }).waitFor();
      await upload({
        localWhitelist: [],
        localWhitelistExcluded: ["removed_fixture"],
        hidden: {
          ids: ["2002"],
          records: [{ id: "2002", handle: "new_fixture", source: "manual", ts: 2 }],
        },
        cache: {},
      });
      await p.getByText("备份内容", { exact: true }).waitFor();
      assert.ok(
        await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        "no horizontal overflow",
      );
      const contrast = await p.evaluate(() => {
        const lum = (rgb) => {
          const c = rgb
            .match(/[\d.]+/g)
            .slice(0, 3)
            .map(Number)
            .map((x) => x / 255)
            .map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
          return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
        };
        const a = lum(getComputedStyle(document.querySelector(".text-fg-3")).color),
          b = lum(getComputedStyle(document.body).backgroundColor);
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      });
      console.log(JSON.stringify({ theme, width, secondaryTextContrast: contrast }));
      if (!baseline) assert.ok(contrast >= 4.5, "secondary text contrast must reach 4.5");

      await p.screenshot({
        path: `${out}/backup-${baseline ? "before" : "after"}-${theme}-${width}.png`,
        fullPage: true,
      });
    }
  if (!baseline) {
    await p.setViewportSize({ width: 1440, height: 1000 });
    assert.equal(await p.getByRole("checkbox", { name: /本地白名单/ }).count(), 1);
    assert.equal(await p.getByRole("checkbox", { name: /已隐藏账号与处理记录/ }).count(), 1);
    assert.equal(await p.getByRole("checkbox", { name: /检测缓存/ }).count(), 1);
    await p.getByRole("checkbox", { name: /已隐藏账号与处理记录/ }).uncheck();
    await p.getByRole("button", { name: /^覆盖\s/ }).click();
    await p.getByRole("button", { name: "覆盖导入", exact: true }).click();
    await p.getByRole("button", { name: "确认覆盖", exact: true }).click();
    await p.getByText("已导入：", { exact: false }).waitFor();
    const stored = await sw.evaluate(() => chrome.storage.local.get(null));
    assert.deepEqual(stored["xss:blocked"], ["1001"]);
    assert.equal(stored["xss:blocklist:v2"][0].id, "1001");
    assert.deepEqual(stored["xss:whitelist:local"].entries, []);
    assert.deepEqual(stored["xss:whitelist:local"].excluded, ["removed_fixture"]);
    assert.equal(stored["xss:v1:1001"], undefined);
    await upload({ localWhitelist: [{ handle: 23 }, { handle: "valid_fixture" }] });
    await p.getByText("备份内容", { exact: true }).waitFor();
    await sw.evaluate(() => {
      chrome.storage.local.set = async () => {
        throw new Error("fixture storage denied");
      };
    });
    await p.getByRole("button", { name: "覆盖导入", exact: true }).click();
    await p.getByRole("button", { name: "确认覆盖", exact: true }).click();
    await p.getByRole("alert").filter({ hasText: "fixture storage denied" }).waitFor();
    await p.screenshot({ path: `${out}/backup-import-error.png`, fullPage: true });
    assert.deepEqual(errors, []);
  }
  writeFileSync(
    `${out}/backup-${baseline ? "before" : "after"}-result.json`,
    JSON.stringify({ passed: true, errors }, null, 2),
  );
  console.log(JSON.stringify({ passed: true, baseline, screenshots: 4, errors }));
} finally {
  await ctx.close();
}
