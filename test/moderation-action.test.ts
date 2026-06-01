import assert from "node:assert/strict";
import { test } from "node:test";

const { DEFAULT_MODERATION_ACTION, actionApiPath, actionLabels } = await import(
  "../extension/lib/moderation-action.ts"
);

test("default moderation action is account mute", () => {
  assert.equal(DEFAULT_MODERATION_ACTION, "mute");
});

test("mute uses X account mute endpoint, not sound muting", () => {
  assert.equal(actionApiPath("mute"), "/i/api/1.1/mutes/users/create.json");
  assert.equal(actionLabels("mute").verb, "静音");
  assert.match(actionLabels("mute").description, /隐藏该用户的帖子/);
});

test("block remains available as an explicit higher-risk action", () => {
  assert.equal(actionApiPath("block"), "/i/api/1.1/blocks/create.json");
  assert.equal(actionLabels("block").verb, "拉黑");
});
