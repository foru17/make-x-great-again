// Regression coverage for the uid-detection helpers shipped on fix/uid-real-rest-id.
// These ride a Chrome Web Store release, so the contract — what changes the
// cache, what is silently dropped — must stay stable. Only the public surface
// (`ingestGraphqlUsers`) is tested; the DOM-bound helpers (`extractProfile`,
// `extractFromArticle`, `readFiberUser`) need a browser fixture and live in
// the manual smoke checklist.
import assert from "node:assert/strict";
import { test } from "node:test";

const { ingestGraphqlUsers } = await import("../extension/lib/graphql-users.ts");

// All tests below use unique handles per assertion so the module-level
// graphqlUserCache (Map) does not leak state between tests.
function uniqueHandle(tag: string): string {
  return `mxgaTest_${tag}_${Math.random().toString(36).slice(2, 10)}`;
}

test("ingestGraphqlUsers: returns true when a fresh user lands in the cache", () => {
  const handle = uniqueHandle("fresh");
  const changed = ingestGraphqlUsers([
    {
      handle,
      userId: "44196397",
      bio: "hi",
      followersCount: 200_000_000,
      followingCount: 100,
      createdAt: "Tue Jun 02 20:12:29 +0000 2009",
    },
  ]);
  assert.equal(changed, true);
});

test("ingestGraphqlUsers: returns false when re-ingesting the same payload", () => {
  const handle = uniqueHandle("dup");
  const payload = [{ handle, userId: "123456789", bio: "" }];
  assert.equal(ingestGraphqlUsers(payload), true);
  assert.equal(ingestGraphqlUsers(payload), false);
});

test("ingestGraphqlUsers: returns true when ANY user in the batch changed", () => {
  const stable = uniqueHandle("stable");
  const fresh = uniqueHandle("fresh");
  ingestGraphqlUsers([{ handle: stable, userId: "111" }]);
  // Re-send the stable one + a brand new one in the same call.
  const changed = ingestGraphqlUsers([
    { handle: stable, userId: "111" },
    { handle: fresh, userId: "222" },
  ]);
  assert.equal(changed, true);
});

test("ingestGraphqlUsers: silently skips entries with missing or non-numeric userId", () => {
  const handleA = uniqueHandle("nouid");
  const handleB = uniqueHandle("bad");
  const handleC = uniqueHandle("nohandle");
  const changed = ingestGraphqlUsers([
    // Empty userId — must skip.
    { handle: handleA, userId: "" },
    // Non-numeric userId (e.g. someone mistakenly passed the handle) — must skip.
    { handle: handleB, userId: "elonmusk" },
    // Missing handle — must skip.
    { handle: "", userId: "12345" },
    // Missing handle (only @ characters) — must skip.
    { handle: "@@", userId: "67890" },
    // Empty everything — must skip.
    { handle: "", userId: "" },
    // ...and an out-of-range "userId" wrapped as handle — must skip.
    { handle: handleC, userId: "abc123" },
  ]);
  assert.equal(changed, false);
});

test("ingestGraphqlUsers: dedupes by lowercased handle", () => {
  const handle = uniqueHandle("Mixed");
  // First ingest with mixed case.
  assert.equal(ingestGraphqlUsers([{ handle, userId: "555" }]), true);
  // Same handle in different case + same uid → no change (handle is normalized).
  assert.equal(ingestGraphqlUsers([{ handle: handle.toUpperCase(), userId: "555" }]), false);
});

test("ingestGraphqlUsers: a changed bio is treated as a cache update", () => {
  const handle = uniqueHandle("bio");
  assert.equal(ingestGraphqlUsers([{ handle, userId: "777", bio: "first" }]), true);
  assert.equal(ingestGraphqlUsers([{ handle, userId: "777", bio: "second" }]), true);
});

test("ingestGraphqlUsers: viewer-relationship flags propagate", () => {
  const handle = uniqueHandle("viewer");
  // Initial ingest without viewer flag.
  assert.equal(ingestGraphqlUsers([{ handle, userId: "999" }]), true);
  // Flipping viewerFollowing -> true must be detected as a change.
  assert.equal(ingestGraphqlUsers([{ handle, userId: "999", viewerFollowing: true }]), true);
  // Same payload again → no change.
  assert.equal(ingestGraphqlUsers([{ handle, userId: "999", viewerFollowing: true }]), false);
});

test("ingestGraphqlUsers: empty batch is a no-op", () => {
  assert.equal(ingestGraphqlUsers([]), false);
});

test("ingestGraphqlUsers: createdAt is parsed into accountAgeDays internally without throwing", () => {
  const handle = uniqueHandle("created");
  // Valid X-style createdAt.
  assert.equal(
    ingestGraphqlUsers([{ handle, userId: "1010", createdAt: "Tue Jun 02 20:12:29 +0000 2009" }]),
    true,
  );
  // Garbage createdAt must not throw — it is just dropped.
  const handle2 = uniqueHandle("createdbad");
  assert.doesNotThrow(() =>
    ingestGraphqlUsers([{ handle: handle2, userId: "2020", createdAt: "not a date" }]),
  );
});
