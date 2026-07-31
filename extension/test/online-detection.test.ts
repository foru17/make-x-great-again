import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAX_AUTO_CLASSIFICATIONS_PER_PAGE,
  OnlineClassificationLimiter,
  classifyAndCache,
  onlineVerdictVisibility,
  postOnlineClassification,
  shouldAutoClassify,
} from "../lib/online-detection";
import type { BgRequest, BgResponse, Signals, Verdict } from "../lib/types";

const signals: Signals = {
  isProfile: false,
  userId: "123",
  handle: "new_account",
  displayName: "New account",
  bio: "",
  hasDefaultAvatar: false,
  recentTweets: ["hello"],
};

const verdict: Verdict = {
  label: "legit",
  confidence: 0.91,
  reasons: ["normal account history"],
};

test("legit online verdicts stay silent while reviewable verdicts remain visible", () => {
  assert.equal(onlineVerdictVisibility(verdict), "silent");
  for (const label of ["spam", "porn_bot", "likely_spam", "uncertain"] as const) {
    assert.equal(
      onlineVerdictVisibility({ label, confidence: 0.8, reasons: ["test"] }),
      "badge",
    );
  }
});

test("authenticated local misses auto-classify, with a hard per-page cap", () => {
  assert.equal(
    shouldAutoClassify({ authenticated: true, localResult: "unknown", requestsStarted: 0 }),
    true,
  );
  assert.equal(
    shouldAutoClassify({
      authenticated: true,
      localResult: "unknown",
      requestsStarted: MAX_AUTO_CLASSIFICATIONS_PER_PAGE,
    }),
    false,
  );
});

test("logged-out or locally known accounts never auto-classify", () => {
  assert.equal(
    shouldAutoClassify({ authenticated: false, localResult: "unknown", requestsStarted: 0 }),
    false,
  );
  assert.equal(
    shouldAutoClassify({ authenticated: true, localResult: "known", requestsStarted: 0 }),
    false,
  );
});

test("online classification concurrency is bounded", async () => {
  const limiter = new OnlineClassificationLimiter(2);
  let active = 0;
  let maximum = 0;
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tasks = Array.from({ length: 5 }, () =>
    limiter.run(async () => {
      active += 1;
      maximum = Math.max(maximum, active);
      await gate;
      active -= 1;
    }),
  );

  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(active, 2);
  release();
  await Promise.all(tasks);
  assert.equal(maximum, 2);
});

test("classification sends once and persists a reusable account verdict", async () => {
  const messages: BgRequest[] = [];
  const writes: Array<{ key: string; verdict: Verdict }> = [];
  const response: BgResponse = {
    ok: true,
    data: {
      status: 200,
      body: { cached: false, record: { verdict, model: "gpt-test" } },
    },
  };

  const result = await classifyAndCache("uid:123", signals, {
    send: async (message) => {
      messages.push(message);
      return response;
    },
    writeCache: async (key, entry) => {
      writes.push({ key, verdict: entry.verdict });
    },
    now: () => 1_700_000_000_000,
  });

  assert.deepEqual(messages, [{ type: "classify", sig: signals }]);
  assert.equal(result.status, "classified");
  assert.deepEqual(result.verdict, verdict);
  assert.deepEqual(writes, [{ key: "uid:123", verdict }]);
});

test("background classification requires GitHub auth and posts to /v1/classify", async () => {
  let calls = 0;
  const unauthenticated = await postOnlineClassification({
    base: "https://edge.example",
    token: null,
    sig: signals,
    fetcher: async () => {
      calls += 1;
      return new Response();
    },
  });
  assert.deepEqual(unauthenticated, { ok: false, error: "no_token" });
  assert.equal(calls, 0);

  const authenticated = await postOnlineClassification({
    base: "https://edge.example/",
    token: "github-token",
    sig: signals,
    fetcher: async (input, init) => {
      calls += 1;
      assert.equal(input, "https://edge.example/v1/classify");
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer github-token");
      assert.equal(init?.method, "POST");
      return Response.json({ cached: false, record: { verdict } });
    },
  });

  assert.equal(calls, 1);
  assert.equal(authenticated.ok, true);
  assert.deepEqual(authenticated.data, {
    status: 200,
    body: { cached: false, record: { verdict } },
  });
});
