import assert from "node:assert/strict";
import test from "node:test";
import { summarizeAgentReview } from "../app/lib/agentReview.ts";

test("agent review replaces policy codes and hard-evidence jargon with plain Chinese", () => {
  const summary = summarizeAgentReview({
    agent_label: "spam",
    agent_signals: JSON.stringify(["P1", "hard_evidence", "bio_link_pattern"]),
    agent_reasons: JSON.stringify([
      "P1 hard evidence: bio and recent replies contain repeated off-site contact prompts",
      "high confidence coordinated reply spam",
    ]),
    agent_evidence: JSON.stringify({
      account_age_days: 7,
      follower_count: 3,
      posting_rate_per_day: 96,
      reply_offtopic_ratio: 0.92,
    }),
  });

  assert.equal(summary.conclusion, "高度疑似垃圾营销账号");
  assert.deepEqual(summary.signals, [
    "内容含色情或约炮推广",
    "存在直接垃圾推广证据",
    "简介带有重复引流链接",
  ]);
  assert.deepEqual(summary.reasons, [
    "简介和近期回复反复引导到站外联系",
    "多条回复高度重复，并带有明显引流意图",
  ]);
  assert.deepEqual(summary.evidence, ["账号注册 7 天", "粉丝 3", "每天约 96 条发言", "回复跑题 92%"]);
  assert.doesNotMatch(JSON.stringify(summary), /\bP1\b|hard[_ ]evidence/i);
});

test("unknown internal signal codes stay out of the maintainer view", () => {
  const summary = summarizeAgentReview({
    agent_label: "uncertain",
    agent_signals: JSON.stringify(["EXPERIMENT_42", "A2"]),
  });

  assert.equal(summary.conclusion, "现有证据不足，建议人工复核");
  assert.deepEqual(summary.signals, ["可用内容太少，无法可靠判断"]);
});
