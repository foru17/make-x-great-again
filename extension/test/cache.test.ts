import assert from "node:assert/strict";
import test from "node:test";
import { signalsHash } from "../lib/cache";
import type { Signals } from "../lib/types";

test("all classifier-visible profile and context changes invalidate the local cache", () => {
  const base: Signals = { isProfile: false, handle: "fixture", displayName: "Fixture", bio: "", recentTweets: [], hasDefaultAvatar: false };
  const changes: Partial<Signals> = {
    followersCount: 1000, followingCount: 50, threadTopic: "science", tweetsTranslated: true,
    isVerified: true, statusesCount: 900, mediaCount: 90, favouritesCount: 10, location: "Tokyo",
    avatarSource: "profile", surface: "thread", isReply: true, replyToHandle: "someone",
    rootAuthorHandle: "root_author", templateRepeats: 3,
  };
  for (const [key, value] of Object.entries(changes)) {
    assert.notEqual(signalsHash({ ...base, [key]: value }), signalsHash(base), key);
  }
  assert.equal(signalsHash({ ...base, avatarUrl: "https://pbs.twimg.com/changed.png" }), signalsHash(base), "cosmetic image changes are not model input");
});
