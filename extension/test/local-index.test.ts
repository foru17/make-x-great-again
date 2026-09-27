import assert from "node:assert/strict";
import test from "node:test";
import { indexEntryFromRow, requestBackgroundSync } from "../lib/local-index";

test("expands compact list rows only when looked up", () => {
  const updatedAt = "2026-07-17T00:00:00.000Z";
  const entry = indexEntryFromRow(["123", "SpamBot", "pph"], updatedAt);

  assert.deepEqual(entry, {
    userId: "123",
    handle: "SpamBot",
    verdict: {
      label: "porn_bot",
      confidence: 1,
      reasons: ["公共黑名单收录 · 色情招揽 · 人工确认"],
    },
    category: "porn",
    tier: "confirmed",
    source: "curated",
    updatedAt,
  });
});

test("rejects an unknown compact label code", () => {
  assert.equal(indexEntryFromRow(["123", "SpamBot", "xph"], "ignored"), null);
});

test("background sync request consumes Firefox's missing-receiver rejection", async () => {
  const root = globalThis as unknown as { chrome?: unknown };
  const previousChrome = root.chrome;
  root.chrome = {
    runtime: {
      sendMessage: () => Promise.reject(new Error("Receiving end does not exist")),
    },
  };

  try {
    await assert.doesNotReject(requestBackgroundSync());
  } finally {
    if (previousChrome === undefined) delete root.chrome;
    else root.chrome = previousChrome;
  }
});
