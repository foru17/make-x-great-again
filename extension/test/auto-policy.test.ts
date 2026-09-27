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

test("rule hits are capped at the local hide in EVERY mode; 'badge' gates them out", () => {
  // Rule hits target first-seen accounts with zero human review: a substring
  // match must never fire the irreversible X mute/block with the user's own
  // session, whatever autoTierMode says (2026-09-06; autoTierMode=full is a
  // statement about published list entries, not local matches).
  for (const autoTierMode of ["hide", "full"] as const) {
    for (const action of ["mute", "block", "hide"] as const) {
      assert.equal(
        capAutoTierAction(action, { source: "rule", tier: "auto", autoTierMode }),
        "hide",
      );
    }
    assert.equal(
      capAutoTierAction("badge", { source: "rule", tier: "auto", autoTierMode }),
      "badge",
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
