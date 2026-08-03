import assert from "node:assert/strict";
import test from "node:test";
import { omitResolvedRequests } from "../app/lib/whitelistRequests.ts";

test("resolved whitelist requests are removed locally without rebuilding remaining rows", () => {
  const first = { id: 31, handle: "first" };
  const second = { id: 30, handle: "second" };
  const third = { id: 29, handle: "third" };

  const result = omitResolvedRequests([first, second, third], [30]);

  assert.deepEqual(result, [first, third]);
  assert.equal(result[0], first);
  assert.equal(result[1], third);
});

test("a partial batch removes only requests that the API confirmed", () => {
  const rows = [
    { id: 31, handle: "first" },
    { id: 30, handle: "second" },
    { id: 29, handle: "third" },
  ];

  assert.deepEqual(
    omitResolvedRequests(rows, [31, 30]).map((row) => row.id),
    [29],
  );
});
