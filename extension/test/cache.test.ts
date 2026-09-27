import assert from "node:assert/strict";
import test from "node:test";
import { signalsHash } from "../lib/cache";
import type { Signals } from "../lib/types";

const base: Signals = {
  isProfile: false,
  handle: "fixture",
  displayName: "Fixture",
  bio: "",
  recentTweets: [],
  hasDefaultAvatar: false,
  followersCount: 1000,
  followingCount: 50,
  statusesCount: 900,
  accountAgeDays: 400,
};

test("account evidence changes invalidate the local cache", () => {
  const changes: Partial<Signals> = {
    displayName: "Renamed",
    bio: "new bio",
    triggeringComment: "a new comment",
    recentTweets: ["a post"],
    hasDefaultAvatar: true,
    avatarSource: "profile",
    isVerified: true,
    location: "Tokyo",
    followersCount: 4000, // ×4 — a different account in the model's eyes
    followingCount: 5,
    statusesCount: 90,
    accountAgeDays: 40,
  };
  for (const [key, value] of Object.entries(changes)) {
    assert.notEqual(signalsHash({ ...base, [key]: value }), signalsHash(base), key);
  }
});

test("per-view context and counter drift do NOT invalidate an account-level cache", () => {
  // These change with every thread the same account shows up in; keying the
  // cache on them would send every known-legit account back online per
  // thread and burn the page's fresh-detection budget on accounts already
  // judged (the edge keys the full model input itself, TTL-gated).
  const perView: Partial<Signals> = {
    threadTopic: "science",
    surface: "thread",
    isReply: true,
    replyToHandle: "someone",
    rootAuthorHandle: "root_author",
    templateRepeats: 3,
    tweetsTranslated: true,
    avatarUrl: "https://pbs.twimg.com/changed.png",
  };
  for (const [key, value] of Object.entries(perView)) {
    assert.equal(signalsHash({ ...base, [key]: value }), signalsHash(base), key);
  }
  // Small drift stays in the same bucket…
  assert.equal(signalsHash({ ...base, followersCount: 1100, statusesCount: 930, accountAgeDays: 415 }), signalsHash(base));
  // …but a real change does not.
  assert.notEqual(signalsHash({ ...base, followersCount: 1600 }), signalsHash(base));
});
