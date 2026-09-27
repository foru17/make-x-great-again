import assert from "node:assert/strict";
import { test } from "node:test";
import { sweepAllRules } from "../app/lib/ruleSweep";

const fingerprint = "a".repeat(64);
function batch(page: number, complete = false) {
  return {
    ok: true,
    matched: 200,
    textMatched: 200,
    skippedProtected: 0,
    skippedChanged: 0,
    complete,
    nextCursor: complete ? null : { partition: 0, after: page * 200, fingerprint },
  };
}
for (const scope of ["queue", "all"] as const)
  test(`${scope}: one invocation automatically completes beyond ten pages`, async () => {
    let requests = 0;
    let processed = 0;
    await sweepAllRules(
      scope,
      undefined,
      async (s, cursor) => {
        assert.equal(s, scope);
        assert.equal(cursor?.after ?? 0, requests * 200);
        requests++;
        return batch(requests, requests === 21);
      },
      (r) => {
        processed += r.matched;
      },
    );
    assert.equal(requests, 21);
    assert.equal(processed, 4200);
  });
test("partition advances can reset row cursor and resume without losing the checkpoint", async () => {
  let requests = 0;
  await sweepAllRules(
    "all",
    { partition: 0, after: 400, fingerprint },
    async (_scope, cursor) => {
      requests++;
      if (requests === 1) {
        assert.equal(cursor?.after, 400);
        return { ...batch(1), nextCursor: { partition: 1, after: 0, fingerprint } };
      }
      assert.equal(cursor?.partition, 1);
      assert.equal(cursor?.after, 0);
      return batch(2, true);
    },
    () => {},
  );
  assert.equal(requests, 2);
});
for (const nextCursor of [
  null,
  { partition: 0, after: 400, fingerprint },
  { partition: 0, after: 200, fingerprint },
  { partition: 0, after: 600, fingerprint: "b".repeat(64) },
])
  test(`invalid/stalled continuation stops immediately: ${JSON.stringify(nextCursor)}`, async () => {
    let calls = 0;
    let updates = 0;
    await assert.rejects(
      sweepAllRules(
        "queue",
        { partition: 0, after: 400, fingerprint },
        async () => {
          calls++;
          return { ...batch(1), nextCursor };
        },
        () => {
          updates++;
        },
      ),
      /未推进/,
    );
    assert.equal(calls, 1);
    assert.equal(updates, 0);
  });
test("network failure preserves the last acknowledged batch and does not claim completion", async () => {
  let calls = 0;
  let checkpoint = 0;
  await assert.rejects(
    sweepAllRules(
      "queue",
      undefined,
      async () => {
        calls++;
        if (calls === 2) throw new Error("HTTP 503");
        return batch(1);
      },
      (r) => {
        checkpoint = r.nextCursor?.after ?? 0;
      },
    ),
    /503/,
  );
  assert.equal(calls, 2);
  assert.equal(checkpoint, 200);
});
test("broken endless pagination has a hard request ceiling", async () => {
  let calls = 0;
  await assert.rejects(
    sweepAllRules(
      "queue",
      undefined,
      async () => batch(++calls),
      () => {},
    ),
    /次数异常/,
  );
  assert.equal(calls, 10000);
});
