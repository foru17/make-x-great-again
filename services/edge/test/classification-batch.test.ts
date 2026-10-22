import assert from "node:assert/strict";
import test from "node:test";
import { ClassificationBatch } from "../src/classification-batch";
import { classifyBatch } from "../src/index";

test("10th unique item flushes immediately; tail deadline is 2s from first item", async () => {
  let now = 0;
  const timers = new Map<number, { due: number; callback: () => void }>();
  let next = 0;
  const scheduler = { set(callback: () => void, ms: number) { timers.set(++next, { due: now + ms, callback }); return next; }, clear(id: unknown) { timers.delete(id as number); } };
  const batches: number[][] = [];
  const batch = new ClassificationBatch<number, number>(async items => { batches.push(items); return items.map(value => ({ value })); }, scheduler);
  const first = Array.from({ length: 9 }, (_, i) => batch.add(i));
  assert.equal(batches.length, 0);
  first.push(batch.add(9));
  assert.deepEqual(batches, [Array.from({ length: 10 }, (_, i) => i)]);
  assert.equal(timers.size, 0);
  await Promise.all(first);
  const tail = [batch.add(10)];
  now = 1999;
  tail.push(batch.add(11));
  assert.equal([...timers.values()][0].due, 2000, "later arrivals cannot slide the deadline");
  now = 2000;
  [...timers.values()][0].callback();
  assert.deepEqual(await Promise.all(tail), [{ value: 10 }, { value: 11 }]);
  assert.deepEqual(batches.map(x => x.length), [10, 2]);
});

test("partial invalid/duplicate IDs retry only unresolved accounts, preserving exact association", async () => {
  const original = globalThis.fetch;
  const requests: string[][] = [];
  globalThis.fetch = async (_input, init) => {
    assert.ok(requests.length < 2, "hard provider-call cap");
    const request = JSON.parse(String(init?.body));
    const { items } = JSON.parse(request.messages[1].content) as { items: Array<{ id: string }> };
    requests.push(items.map(x => x.id));
    const verdict = (label = "legit") => ({ label, confidence: 1, reasons: ["fixture"] });
    const results = requests.length === 1 ? [
      { id: "a", verdict: verdict() }, { id: "b", verdict: verdict() }, { id: "b", verdict: verdict("spam") },
      { id: "not-an-input", verdict: verdict() },
      { verdict: verdict() }, // malformed neighbor must not discard valid a
    ] : [{ id: "c", verdict: verdict("spam") }, { id: "b", verdict: verdict() }];
    return Response.json({ choices: [{ message: { content: JSON.stringify({ results }) } }] });
  };
  try {
    const result = await classifyBatch({ LLM_API_BASE: "https://fixture.invalid", LLM_API_KEY: "fixture", LLM_API_MODEL: "fixture" } as never,
      ["a", "b", "c"].map(id => ({ id, signals: { handle: id, recentTweets: [] } })));
    assert.deepEqual(requests, [["a", "b", "c"], ["b", "c"]]);
    assert.deepEqual(result.map(x => "value" in x && x.value.label), ["legit", "legit", "spam"]);
  } finally { globalThis.fetch = original; }
});

test("timeout does not retry a submitted batch; invalid responses stop after two attempts", async () => {
  const original = globalThis.fetch;
  const env = { LLM_API_BASE: "https://fixture.invalid", LLM_API_KEY: "fixture", LLM_API_MODEL: "fixture" };
  const items = [{ id: "a", signals: { handle: "a", recentTweets: [] } }];
  let calls = 0;
  try {
    globalThis.fetch = async () => { assert.ok(++calls <= 1); throw new Error("ambiguous timeout"); };
    assert.deepEqual(await classifyBatch(env as never, items), [{ error: "model_outcome_unknown" }]);
    assert.equal(calls, 1);
    calls = 0;
    globalThis.fetch = async () => { assert.ok(++calls <= 2); return Response.json({ choices: [{ message: { content: "invalid" } }] }); };
    assert.deepEqual(await classifyBatch(env as never, items), [{ error: "model_response_invalid" }]);
    assert.equal(calls, 2);
  } finally { globalThis.fetch = original; }
});

test("bounded batch concurrency rejects overflow instead of extending queue deadlines", async () => {
  const gate = Promise.withResolvers<void>();
  let calls = 0;
  const batch = new ClassificationBatch<number, number>(async items => {
    calls++;
    await gate.promise;
    return items.map(value => ({ value }));
  });
  const pending = Array.from({ length: 40 }, (_, i) => batch.add(i));
  assert.equal(calls, 4);
  assert.deepEqual(await batch.add(41), { error: "classifier_busy" });
  gate.resolve();
  assert.equal((await Promise.all(pending)).filter(r => "value" in r).length, 40);
});
