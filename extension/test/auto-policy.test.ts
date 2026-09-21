import assert from "node:assert/strict";
import { test } from "node:test";
import { autoEligible, capAutoTierAction } from "../lib/auto-policy";

test("list hits: human-confirmed entries follow autoScope", () => {
  for (const autoTierMode of ["badge", "hide", "full"] as const) {
    assert.equal(
      autoEligible({ source: "list", tier: "confirmed", inReply: true, autoScope: "replies", autoTierMode }),
      true,
    );
    assert.equal(
      autoEligible({ source: "list", tier: "confirmed", inReply: false, autoScope: "replies", autoTierMode }),
      false,
    );
    assert.equal(
      autoEligible({ source: "list", tier: "confirmed", inReply: false, autoScope: "all", autoTierMode }),
      true,
    );
  }
});

test("auto-tier list entries: 'badge' mode keeps the original mark-only hard line", () => {
  assert.equal(
    autoEligible({ source: "list", tier: "auto", inReply: true, autoScope: "replies", autoTierMode: "badge" }),
    false,
  );
  assert.equal(
    autoEligible({ source: "list", tier: "auto", inReply: false, autoScope: "all", autoTierMode: "badge" }),
    false,
  );
});

test("auto-tier list entries: 'hide'/'full' modes admit them under autoScope", () => {
  for (const autoTierMode of ["hide", "full"] as const) {
    assert.equal(
      autoEligible({ source: "list", tier: "auto", inReply: true, autoScope: "replies", autoTierMode }),
      true,
    );
    assert.equal(
      autoEligible({ source: "list", tier: "auto", inReply: false, autoScope: "replies", autoTierMode }),
      false,
    );
    assert.equal(
      autoEligible({ source: "list", tier: "auto", inReply: false, autoScope: "all", autoTierMode }),
      true,
    );
  }
});

test("HARD LINE v2 — 'hide' mode caps auto-tier list hits at the local hide", () => {
  // A poisoned/false-positive auto-published entry must never fire the
  // irreversible X mute/block with the user's own session under the default.
  for (const action of ["mute", "block", "hide"] as const) {
    assert.equal(
      capAutoTierAction(action, { source: "list", tier: "auto", autoTierMode: "hide" }),
      "hide",
    );
  }
  assert.equal(
    capAutoTierAction("badge", { source: "list", tier: "auto", autoTierMode: "hide" }),
    "badge",
  );
});

test("cap passes through human-confirmed entries and 'full' opt-in unchanged", () => {
  for (const action of ["mute", "block", "hide", "badge"] as const) {
    assert.equal(
      capAutoTierAction(action, { source: "list", tier: "confirmed", autoTierMode: "hide" }),
      action,
    );
    assert.equal(
      capAutoTierAction(action, { source: "list", tier: "auto", autoTierMode: "full" }),
      action,
    );
  }
});

test("rule hits are auto tier: 'hide' caps them at local hide, 'badge' gates them out", () => {
  // The options copy promises "X 静音/拉黑仍只对人工确认条目执行" (hide) and
  // "自动收录条目永不自动处理" (badge). Rule hits target first-seen accounts
  // with zero human review, so both promises must cover them.
  for (const action of ["mute", "block", "hide"] as const) {
    assert.equal(
      capAutoTierAction(action, { source: "rule", tier: "auto", autoTierMode: "hide" }),
      "hide",
    );
    assert.equal(
      capAutoTierAction(action, { source: "rule", tier: "auto", autoTierMode: "full" }),
      action,
    );
  }
  assert.equal(
    autoEligible({ source: "rule", tier: "auto", inReply: true, autoScope: "replies", autoTierMode: "badge" }),
    false,
  );
});

test("rule hits: reply sections only, autoScope cannot widen them", () => {
  assert.equal(
    autoEligible({ source: "rule", tier: "auto", inReply: true, autoScope: "replies", autoTierMode: "hide" }),
    true,
  );
  assert.equal(
    autoEligible({ source: "rule", tier: "auto", inReply: false, autoScope: "all", autoTierMode: "hide" }),
    false,
  );
});

test("cache and fresh verdicts never auto-act", () => {
  for (const source of ["cache", "fresh"] as const) {
    assert.equal(
      autoEligible({ source, tier: "confirmed", inReply: true, autoScope: "all", autoTierMode: "full" }),
      false,
    );
  }
});

test("AI 判定 hits: reply sections only and auto-tier, exactly like rule hits", () => {
  for (const autoScope of ["replies", "all"] as const) {
    assert.equal(
      autoEligible({ source: "ai", tier: "auto", inReply: true, autoScope, autoTierMode: "full" }),
      true,
    );
    assert.equal(
      autoEligible({ source: "ai", tier: "auto", inReply: false, autoScope, autoTierMode: "full" }),
      false,
    );
  }
  assert.equal(
    autoEligible({ source: "ai", tier: "auto", inReply: true, autoScope: "replies", autoTierMode: "badge" }),
    false,
  );
  assert.equal(
    capAutoTierAction("block", { source: "ai", tier: "auto", autoTierMode: "hide" }),
    "hide",
  );
  assert.equal(
    capAutoTierAction("block", { source: "ai", tier: "auto", autoTierMode: "full" }),
    "block",
  );
});
