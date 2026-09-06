import assert from "node:assert/strict";
import test from "node:test";
import { TEMPLATE_MEMORY_KEY, noteTemplate } from "../lib/template-memory";
import type { Signals } from "../lib/types";

function installChrome() {
  const root = globalThis as unknown as { chrome?: unknown };
  const previous = root.chrome;
  const bag: Record<string, unknown> = {};
  root.chrome = {
    storage: {
      local: {
        get: async (k: string) => ({ [k]: bag[k] }),
        set: async (obj: Record<string, unknown>) => Object.assign(bag, obj),
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

const sig = (handle: string, text: string): Signals => ({
  isProfile: false,
  handle,
  displayName: "",
  bio: "",
  hasDefaultAvatar: false,
  recentTweets: [],
  triggeringComment: text,
});

test("counts earlier sightings of the same text by the same author; stores only hashes", async () => {
  const env = installChrome();
  try {
    const t0 = 1_800_000_000_000;
    assert.equal(await noteTemplate(sig("bot9911", "看主页 @dispatcher01"), t0), 0);
    assert.equal(await noteTemplate(sig("BOT9911", "看主页  @dispatcher01 "), t0 + 1), 1, "case/space-insensitive");
    assert.equal(await noteTemplate(sig("bot9911", "看主页 @dispatcher01"), t0 + 2), 2);
    assert.equal(await noteTemplate(sig("bot9911", "完全不同的一句话"), t0 + 3), 0, "different text");
    assert.equal(await noteTemplate(sig("someoneelse", "看主页 @dispatcher01"), t0 + 4), 0, "different author");
    const stored = JSON.stringify(env.bag[TEMPLATE_MEMORY_KEY]);
    assert.ok(!stored.includes("看主页"), "no text is persisted, only hashes");
    assert.ok(!stored.includes("dispatcher"), "no mention is persisted");
  } finally {
    env.restore();
  }
});

test("sightings expire and very short texts are ignored", async () => {
  const env = installChrome();
  try {
    const t0 = 1_800_000_000_000;
    await noteTemplate(sig("bot1", "看主页 @dispatcher01"), t0);
    assert.equal(await noteTemplate(sig("bot1", "看主页 @dispatcher01"), t0 + 15 * 86_400_000), 0, "expired");
    assert.equal(await noteTemplate(sig("bot1", "约"), t0), 0);
    assert.equal(await noteTemplate(sig("bot1", "约"), t0), 0, "never tracked");
  } finally {
    env.restore();
  }
});
