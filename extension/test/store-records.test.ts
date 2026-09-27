import assert from "node:assert/strict";
import test from "node:test";
import { addBlockRecord, getBlocklist, isBareRecord } from "../lib/store";

function installChrome(seed: Record<string, unknown> = {}) {
  const root = globalThis as unknown as { chrome?: unknown };
  const previous = root.chrome;
  const bag: Record<string, unknown> = { ...seed };
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

test("a bare id row minted by the legacy migration is upgraded by the real record", async () => {
  // First hide on a fresh profile: xss:blocked is written before the record
  // store exists, so getBlocklist() migrates the bare id into a placeholder
  // row — which used to block the real record for good (@2087796166788534272).
  const env = installChrome({ "xss:blocked": ["2087796166788534272"] });
  try {
    const before = await getBlocklist();
    assert.equal(before.length, 1);
    assert.equal(isBareRecord(before[0]!), true);
    await addBlockRecord({
      id: "2087796166788534272",
      handle: "realname",
      displayName: "Real Name",
      avatarUrl: "https://pbs.twimg.com/profile_images/1/a.jpg",
      source: "manual",
      ts: 5,
    });
    const after = await getBlocklist();
    assert.equal(after.length, 1);
    assert.equal(after[0]?.handle, "realname");
    assert.equal(after[0]?.displayName, "Real Name");
    assert.equal(isBareRecord(after[0]!), false);
    // A genuine existing record is never overwritten.
    await addBlockRecord({ id: "2087796166788534272", handle: "other", source: "auto", ts: 9 });
    assert.equal((await getBlocklist())[0]?.handle, "realname");
  } finally {
    env.restore();
  }
});
