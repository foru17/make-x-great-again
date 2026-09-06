import assert from "node:assert/strict";
import test from "node:test";
import {
  LOCAL_WL_KEY,
  addLocalWhitelist,
  isLocallyWhitelisted,
  listLocalWhitelist,
  localWhitelistSize,
  noteFollowing,
  removeLocalWhitelist,
  warmLocalWhitelist,
} from "../lib/local-whitelist";
import type { Signals } from "../lib/types";

/** Minimal chrome.storage.local double: one in-memory bag, onChanged fan-out. */
function installChrome(seed: Record<string, unknown> = {}) {
  const root = globalThis as unknown as { chrome?: unknown };
  const previous = root.chrome;
  const bag: Record<string, unknown> = { ...seed };
  const listeners: Array<(c: Record<string, { newValue?: unknown }>, area: string) => void> = [];
  root.chrome = {
    storage: {
      local: {
        get: async (k: string) => ({ [k]: bag[k] }),
        set: async (obj: Record<string, unknown>) => {
          const changes: Record<string, { newValue?: unknown }> = {};
          for (const [k, v] of Object.entries(obj)) {
            bag[k] = v;
            changes[k] = { newValue: v };
          }
          for (const l of listeners) l(changes, "local");
        },
      },
      onChanged: {
        addListener: (l: (typeof listeners)[number]) => listeners.push(l),
        removeListener: () => {},
      },
    },
  };
  return {
    bag,
    restore() {
      if (previous === undefined) delete root.chrome;
      else root.chrome = previous;
    },
  };
}

const sig = (over: Partial<Signals>): Signals => ({
  isProfile: false,
  handle: "Someone",
  displayName: "Some One",
  bio: "",
  hasDefaultAvatar: false,
  recentTweets: [],
  ...over,
});

test("manual add protects both identity forms, remove clears it", async () => {
  const env = installChrome();
  try {
    await warmLocalWhitelist();
    assert.equal(isLocallyWhitelisted("1", "Someone"), false);
    assert.equal(await addLocalWhitelist({ handle: "@Someone", userId: "1", source: "manual" }), true);
    assert.equal(isLocallyWhitelisted("1"), true, "uid match");
    assert.equal(isLocallyWhitelisted(undefined, "someone"), true, "handle match, case-insensitive");
    assert.equal(await addLocalWhitelist({ handle: "someone", source: "manual" }), false, "dedupe");
    assert.equal(localWhitelistSize(), 1);
    const stored = env.bag[LOCAL_WL_KEY] as { entries: unknown[] };
    assert.equal(stored.entries.length, 1);
    assert.equal(await removeLocalWhitelist("SOMEONE"), true);
    assert.equal(isLocallyWhitelisted("1", "Someone"), false);
    assert.deepEqual(await listLocalWhitelist(), []);
  } finally {
    env.restore();
  }
});

test("rejects malformed handles and drops garbage rows on read", async () => {
  const env = installChrome({
    [LOCAL_WL_KEY]: {
      entries: [
        { handle: "ok_one", source: "following", addedAt: 5 },
        { handle: "bad handle!", source: "manual", addedAt: 5 },
        { handle: "ok_one", source: "manual", addedAt: 9 }, // dup → first wins
        { handle: "", source: "manual" },
      ],
    },
  });
  try {
    await warmLocalWhitelist();
    assert.equal(await addLocalWhitelist({ handle: "not valid", source: "manual" }), false);
    assert.equal(await addLocalWhitelist({ handle: "x".repeat(16), source: "manual" }), false);
    const rows = await listLocalWhitelist();
    assert.deepEqual(
      rows.map((r) => [r.handle, r.source]),
      [["ok_one", "following"]],
    );
  } finally {
    env.restore();
  }
});

test("a manual add upgrades a following-sourced row and fills in the uid", async () => {
  const env = installChrome();
  try {
    await warmLocalWhitelist();
    await addLocalWhitelist({ handle: "creator", source: "following" });
    assert.equal(await addLocalWhitelist({ handle: "creator", userId: "42", source: "manual" }), true);
    const [row] = await listLocalWhitelist();
    assert.equal(row?.source, "manual");
    assert.equal(row?.userId, "42");
    assert.equal(isLocallyWhitelisted("42"), true);
  } finally {
    env.restore();
  }
});

test("noteFollowing adds followed authors only when enabled, never the viewer", async () => {
  const env = installChrome();
  try {
    await warmLocalWhitelist();
    noteFollowing(sig({ handle: "friend", userId: "7", viewerFollowing: true }), false);
    noteFollowing(sig({ handle: "stranger", userId: "8" }), true);
    noteFollowing(sig({ handle: "me", userId: "9", viewerFollowing: true, viewerIsSelf: true }), true);
    noteFollowing(sig({ handle: "friend", userId: "7", viewerFollowing: true }), true);
    // adds are serialized async writes — let them settle
    await new Promise((r) => setTimeout(r, 0));
    await listLocalWhitelist();
    assert.equal(isLocallyWhitelisted("7", "friend"), true);
    assert.equal(isLocallyWhitelisted("8", "stranger"), false);
    assert.equal(isLocallyWhitelisted("9", "me"), false);
    const [row] = await listLocalWhitelist();
    assert.equal(row?.source, "following");
    assert.equal(row?.displayName, "Some One");
  } finally {
    env.restore();
  }
});

test("storage changes from another page refresh the in-memory guard", async () => {
  const env = installChrome();
  try {
    await warmLocalWhitelist();
    // Simulate the options page writing directly.
    await (globalThis as unknown as { chrome: { storage: { local: { set: (o: object) => Promise<void> } } } })
      .chrome.storage.local.set({
        [LOCAL_WL_KEY]: { entries: [{ handle: "fromOptions", userId: "77", source: "manual", addedAt: 1 }] },
      });
    assert.equal(isLocallyWhitelisted("77"), true);
    assert.equal(isLocallyWhitelisted(undefined, "fromoptions"), true);
  } finally {
    env.restore();
  }
});
