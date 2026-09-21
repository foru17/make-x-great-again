import assert from "node:assert/strict";
import { test } from "node:test";
import { buildJevRequest, parseJevAnswers } from "../lib/jev";
import type { Signals } from "../lib/types";

const sig: Signals = {
  isProfile: false,
  handle: "someone",
  displayName: "Someone",
  bio: "hello",
  hasDefaultAvatar: false,
  recentTweets: ["hi"],
};

type P = { porn_bot: number; spam: number; legit: number; uncertain: number };
const resp = (
  p: P,
  n: { bait?: number; escort?: number; commerce?: number; category?: string } = {},
) => ({
  model: "jev-1.13.0",
  answers: {
    verdict: { type: "choice", choice: "x", probabilities: p, confidence: 0.5 },
    category: {
      type: "choice",
      choice: n.category ?? "other",
      probabilities: {},
      confidence: 0.5,
    },
    redirect_bait: { type: "noul", noul: n.bait ?? 0 },
    escort_copy: { type: "noul", noul: n.escort ?? 0 },
    legit_commerce: { type: "noul", noul: n.commerce ?? 0 },
  },
});

test("请求：账号字段截断、缺失值写 null、翻译标记透传、问题齐全", () => {
  const r = buildJevRequest({ ...sig, bio: "x".repeat(5000), tweetsTranslated: true });
  assert.equal(r.model, "jev-latest");
  const account = r.state.account as Record<string, unknown>;
  assert.ok((account.bio as string).length < 600);
  assert.equal(account.accountAgeDays, null);
  assert.equal(account.tweetsAreMachineTranslated, true);
  assert.equal((r.state.context as Record<string, unknown>).threadTopic, null);
  assert.deepEqual(Object.keys(r.questions).sort(), [
    "category",
    "escort_copy",
    "legit_commerce",
    "redirect_bait",
    "verdict",
  ]);
});

test("垃圾类合计过线 → 按较大者出 porn_bot / spam，类别取类别题", () => {
  const v = parseJevAnswers(resp({ porn_bot: 0.6, spam: 0.3, legit: 0.05, uncertain: 0.05 }), sig);
  assert.equal(v.verdict.label, "porn_bot");
  assert.equal(v.category, "porn");
  assert.ok(Math.abs(v.verdict.confidence - 0.9) < 1e-9);
  const s = parseJevAnswers(
    resp({ porn_bot: 0.1, spam: 0.85, legit: 0.05, uncertain: 0 }, { category: "crypto" }),
    sig,
  );
  assert.equal(s.verdict.label, "spam");
  assert.equal(s.category, "crypto");
});

test("老号门槛更高：0.9 只到 likely_spam", () => {
  const old = { ...sig, accountAgeDays: 3000, followersCount: 500 };
  const v = parseJevAnswers(resp({ porn_bot: 0.9, spam: 0, legit: 0.05, uncertain: 0.05 }), old);
  assert.equal(v.verdict.label, "likely_spam");
  assert.ok(v.verdict.reasons.some((r) => r.includes("higher bar")));
});

test("引流话术 / 色情广告话术成立 → porn_bot，不许落到 uncertain", () => {
  const p: P = { porn_bot: 0.3, spam: 0, legit: 0.1, uncertain: 0.6 };
  const bait = parseJevAnswers(resp(p, { bait: 0.95 }), sig);
  assert.equal(bait.verdict.label, "porn_bot");
  assert.equal(bait.verdict.confidence, 0.95);
  const escort = parseJevAnswers(resp(p, { escort: 0.93, category: "marketing" }), sig);
  assert.equal(escort.verdict.label, "porn_bot");
  assert.equal(escort.category, "porn");
});

test("正常商家推广否决命中；色情证据成立时否决不生效", () => {
  const veto = parseJevAnswers(
    resp({ porn_bot: 0, spam: 0.9, legit: 0.1, uncertain: 0 }, { commerce: 0.85 }),
    sig,
  );
  assert.equal(veto.verdict.label, "likely_spam");
  const disguised = parseJevAnswers(
    resp({ porn_bot: 0.9, spam: 0, legit: 0.1, uncertain: 0 }, { escort: 0.95, commerce: 0.9 }),
    sig,
  );
  assert.equal(disguised.verdict.label, "porn_bot");
});

test("正常 / 中间带 / 不确定", () => {
  const label = (p: P) => parseJevAnswers(resp(p), sig).verdict.label;
  assert.equal(label({ porn_bot: 0, spam: 0, legit: 0.97, uncertain: 0.03 }), "legit");
  assert.equal(label({ porn_bot: 0.3, spam: 0.3, legit: 0.2, uncertain: 0.2 }), "likely_spam");
  assert.equal(label({ porn_bot: 0.1, spam: 0.1, legit: 0.3, uncertain: 0.5 }), "uncertain");
});

test("主判定形状不对就抛，绝不默认；辅助题缺失退回纯主判定", () => {
  assert.throws(() => parseJevAnswers({}, sig));
  assert.throws(() => parseJevAnswers({ answers: { verdict: { type: "noul", noul: 1 } } }, sig));
  assert.throws(() =>
    parseJevAnswers(
      { answers: { verdict: { type: "choice", probabilities: { porn_bot: 1 } } } },
      sig,
    ),
  );
  const bare = parseJevAnswers(
    {
      answers: {
        verdict: {
          type: "choice",
          probabilities: { porn_bot: 0.95, spam: 0, legit: 0.05, uncertain: 0 },
        },
      },
    },
    sig,
  );
  assert.equal(bare.verdict.label, "porn_bot");
  assert.equal(bare.category, "porn");
});
