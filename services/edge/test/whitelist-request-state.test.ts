import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { omitResolvedRequests } from "../app/lib/whitelistRequests.ts";

const componentSource = readFileSync(
  new URL("../app/components/admin/WhitelistRequestsTab.tsx", import.meta.url),
  "utf8",
);

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

test("whitelist request decisions update the current list without refetching it", () => {
  const start = componentSource.indexOf("const decideMany");
  const end = componentSource.indexOf("/** Approving a listed account", start);
  assert.ok(start >= 0 && end > start);
  const decisionFlow = componentSource.slice(start, end);

  assert.match(decisionFlow, /omitResolvedRequests\(current, completedIds\)/);
  assert.doesNotMatch(decisionFlow, /\bload\s*\(/);
});
