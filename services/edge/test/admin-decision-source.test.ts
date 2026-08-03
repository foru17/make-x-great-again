import assert from "node:assert/strict";
import test from "node:test";
import { blacklistDecisionSource } from "../app/lib/format.ts";

test("blacklist decision source explains rule, AI, human and legacy records", () => {
  assert.deepEqual(
    blacklistDecisionSource({
      published_tier: "rule",
      source: "auto_keyword",
      reasons: JSON.stringify(['matched keyword rule "看我主页" on bio']),
    }),
    { label: "关键字规则", detail: "简介命中“看我主页”，由规则自动加入黑名单", tone: "rule" },
  );
  assert.equal(
    blacklistDecisionSource({ published_tier: "ai", verdict_label: "porn_bot", confidence: 0.98 }).detail,
    "AI 判断为色情广告号，把握 98%，自动加入黑名单",
  );
  assert.equal(
    blacklistDecisionSource({ published_tier: "human", agent_id: "review-v2" }).detail,
    "AI 提供初审建议，管理员复核后确认拉黑",
  );
  assert.equal(
    blacklistDecisionSource({}).detail,
    "旧记录没有保存完整的加入方式，可结合判定依据复核",
  );
});

test("blacklist API query selects every field needed by the provenance explanation", async () => {
  const source = await import("node:fs/promises").then((fs) =>
    fs.readFile(new URL("../src/index.ts", import.meta.url), "utf8"),
  );
  const route = source.slice(
    source.indexOf('app.get("/v1/admin/blacklist"'),
    source.indexOf('app.get("/v1/whitelist"'),
  );
  assert.match(route, /a\.source, a\.agent_id, a\.agent_label/);
  assert.match(route, /a\.published_at, a\.published_tier/);
});
