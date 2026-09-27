import assert from "node:assert/strict";
import test from "node:test";
import { artifactVersion, isArtifactIdentityValid } from "../src/artifact-identity";

test("accepts identities representable in the lite artifact", () => {
  assert.equal(isArtifactIdentityValid("2077936309436637687", "tualatrix"), true);
  assert.equal(isArtifactIdentityValid(null, "handle_only"), true);
  assert.equal(isArtifactIdentityValid("", "legacy_empty_id"), true);
  assert.equal(isArtifactIdentityValid("123", "fifteen_chars_1"), true);
});

test("rejects malformed handles before artifact publication", () => {
  assert.equal(isArtifactIdentityValid(null, "christo59389780  @christo59389780"), false);
  assert.equal(isArtifactIdentityValid(null, "test_xss_migration_dummy"), false);
  assert.equal(isArtifactIdentityValid("123", "@leading_at"), false);
  assert.equal(isArtifactIdentityValid("123", "bad-hyphen"), false);
  assert.equal(isArtifactIdentityValid("123", ""), false);
});

test("rejects malformed numeric user ids", () => {
  assert.equal(isArtifactIdentityValid("not-numeric", "valid_handle"), false);
  assert.equal(isArtifactIdentityValid("1".repeat(33), "valid_handle"), false);
});

const acct = (id: string, handle: string, label = "spam") => ({
  x_user_id: id,
  handle,
  verdict_label: label,
  category: null,
  published_tier: "human",
});

test("artifact version is order-independent and URL-safe", async () => {
  const a = [acct("1", "a"), acct("2", "b")];
  const v1 = await artifactVersion(a, []);
  const v2 = await artifactVersion([...a].reverse(), []);
  assert.equal(v1, v2);
  assert.match(v1, /^v[0-9a-f]{16}-2$/);
});

test("artifact version changes with content even at the same count", async () => {
  const before = await artifactVersion([acct("1", "a"), acct("2", "b")], []);
  assert.notEqual(before, await artifactVersion([acct("1", "a"), acct("3", "c")], []));
  assert.notEqual(before, await artifactVersion([acct("1", "a"), acct("2", "b", "porn_bot")], []));
  assert.notEqual(before, await artifactVersion([acct("1", "a"), acct("2", "b")], [["x", "t", "so"]]));
});
