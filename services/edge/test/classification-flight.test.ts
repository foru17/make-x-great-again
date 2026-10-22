import assert from "node:assert/strict";
import test from "node:test";
import { ClassificationFlight, classificationKey, type FlightStore } from "../src/classification-flight";

function store(): FlightStore {
  const rows = new Map<string, { state: string; result: string | null; expires: number }>();
  return {
    get: key => rows.get(key),
    insert: (key, expires) => { assert.ok(!rows.has(key)); rows.set(key, { state: "running", result: null, expires }); },
    finish: (key, result, expires) => { rows.set(key, { state: "done", result, expires }); },
    prune: now => { for (const [key, value] of rows) if (value.expires <= now) rows.delete(key); },
    count: () => rows.size,
  };
}

test("100 concurrent viewers share one provider operation and short result bridge", async () => {
  let calls = 0, now = 1;
  const gate = Promise.withResolvers<void>();
  const flight = new ClassificationFlight<number>(store(), () => now);
  const run = () => flight.run("account-evidence", async () => { calls++; await gate.promise; return { value: 42 }; });
  const pending = Array.from({ length: 100 }, run);
  await Promise.resolve();
  assert.equal(calls, 1);
  gate.resolve();
  assert.deepEqual(await Promise.all(pending), Array.from({ length: 100 }, () => ({ value: 42 })));
  assert.deepEqual(await run(), { value: 42 });
  assert.equal(calls, 1);
  now += 60_001;
  await run();
  assert.equal(calls, 2);
});

test("restart or ambiguous submission never silently retries; changed evidence is isolated", async () => {
  const db = store();
  db.insert("interrupted", 86_400_001);
  const flight = new ClassificationFlight<number>(db, () => 1);
  let calls = 0;
  const execute = async () => { calls++; throw new Error("timeout after submission"); };
  assert.deepEqual(await flight.run("interrupted", execute), { error: "model_outcome_unknown" });
  assert.deepEqual(await flight.run("new-evidence", execute), { error: "model_outcome_unknown" });
  assert.deepEqual(await new ClassificationFlight<number>(db, () => 1).run("new-evidence", execute), { error: "model_outcome_unknown" });
  assert.equal(calls, 1);
  assert.notEqual(await classificationKey(["account", "evidence-a", "model"]), await classificationKey(["account", "evidence-b", "model"]));
  assert.deepEqual(await new ClassificationFlight<number>(db, () => 3 * 86_400_000).run("new-evidence", execute), { error: "model_outcome_unknown" });
  assert.equal(calls, 1, "unknown outcomes must not expire into an automatic re-submission");
});
