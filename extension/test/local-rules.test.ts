import assert from "node:assert/strict";
import { test } from "node:test";
import { matchLocalRules, setLocalRules } from "../lib/local-rules";
import type { Signals } from "../lib/types";

// Rule rows lifted verbatim from the deployed lite artifact (v8…-121888).
const PROD_RULES = [
  ["sao货", "t", "pp"],
  ["太涩了", "t", "pp"],
  ["她的主页", "a", "pp"],
  ["同城", "d", "pp"],
  ["约炮", "d", "pp"],
];

const sig = (over: Partial<Signals>): Signals => ({
  isProfile: false,
  handle: "cailey_frantum",
  displayName: "Gigi 🌸",
  bio: "",
  hasDefaultAvatar: false,
  recentTweets: [],
  ...over,
});

// The 2026-07-14 porn-ring wave (x.com/BTCdayu/status/2076964903651553675):
// Latin/kana display names + Chinese spam replies. The old profile-CJK belt
// suppressed every CJK tweet rule for these accounts.
test("CJK tweet rules hit spam from non-CJK-profile authors", () => {
  setLocalRules(PROD_RULES);
  const cases = [
    "sao货bh 没人比她sao❣️ @lyclne 0s",
    "sao货ns没人比她sao❣️ @kikiynk 3v",
    "30+的sao货id没人比她sao ❣️ @mamarwu 2z",
    "她太涩了lc 我真顶不住 @xintpk1 0m",
    "刷了半天的X et就她的主页能打✈️了 @lyclne 1k",
  ];
  for (const text of cases) {
    const hit = matchLocalRules(sig({ triggeringComment: text, recentTweets: [text] }));
    assert.ok(hit, `should hit: ${text}`);
    assert.equal(hit?.label, "porn_bot");
    assert.equal(hit?.field, "tweet", "hit reports where it matched");
    assert.ok(hit?.matchedText.includes(hit.pattern), "excerpt carries the evidence");
  }
});

test("kana-only display name is treated like any non-CJK profile", () => {
  setLocalRules(PROD_RULES);
  const hit = matchLocalRules(
    sig({
      displayName: "くるみ@モンストアカウント",
      handle: "teardool",
      triggeringComment: "sao货kh没人比她sao❣️ @nyvcca 9b",
    }),
  );
  assert.ok(hit);
});

test("translate guard still suppresses CJK rules on translated renderings", () => {
  setLocalRules(PROD_RULES);
  const hit = matchLocalRules(
    sig({
      triggeringComment: "她太涩了，我真顶不住", // X-translated legit tweet
      tweetsTranslated: true,
    }),
  );
  assert.equal(hit, null);
});

test("display-name rules unaffected by the tweet guard", () => {
  setLocalRules(PROD_RULES);
  const hit = matchLocalRules(
    sig({ displayName: "小甜甜同城可约", triggeringComment: "", tweetsTranslated: true }),
  );
  assert.ok(hit);
  assert.equal(hit?.pattern, "同城");
});

test("non-CJK patterns ignore the translate guard entirely", () => {
  setLocalRules([["twimg.kim", "t", "sr"]]);
  const hit = matchLocalRules(
    sig({ triggeringComment: "look https://twimg.kim/abc", tweetsTranslated: true }),
  );
  assert.ok(hit);
});

test("invisible formatting cannot evade rules in either pattern or field", () => {
  const hidden = "\u2060\u200c我福\u2060不\u200d黑\u2060";
  for (const pattern of ["我福不黑", hidden]) {
    setLocalRules([[pattern, "a", "pp"]]);
    for (const over of [{displayName:hidden}, {bio:hidden}, {recentTweets:[hidden]}, {triggeringComment:hidden}]) {
      assert.ok(matchLocalRules(sig(over)), JSON.stringify(over));
    }
  }
});
test("normalized excerpt still points into the original long text", () => {
  setLocalRules([["我福不黑", "b", "pp"]]);
  const text = "\u200b".repeat(300) + "前".repeat(220) + "我\u2060福不黑" + "后".repeat(220);
  assert.ok(matchLocalRules(sig({bio:text}))?.matchedText.includes("我\u2060福不黑"));
});
test("invisible-only rules never match everything", () => {
  setLocalRules([["\u2060\u200b", "a", "pp"]]);
  assert.equal(matchLocalRules(sig({bio:"ordinary"})), null);
});
test("official ASCII rules preserve server word boundaries after normalization", () => {
  setLocalRules([["visa", "d", "so"]]);
  assert.equal(matchLocalRules(sig({displayName:"Vi\u2060sakan"})), null);
  assert.ok(matchLocalRules(sig({displayName:"Get VI\u200bSA now"})));
});
