import assert from "node:assert/strict";
import test from "node:test";
import { ensureXPermission } from "../lib/x-permission";

const X_ORIGINS = ["*://x.com/*", "*://twitter.com/*"];

test("Firefox Android checks existing X site access without requesting it", async () => {
  let requestCalls = 0;
  const granted = await ensureXPermission({
    browser: "firefox",
    userAgent: "Mozilla/5.0 (Android 15; Mobile; rv:142.0) Gecko/142.0 Firefox/142.0",
    isSafari: false,
    origins: X_ORIGINS,
    permissions: {
      contains: async () => false,
      request: async () => {
        requestCalls += 1;
        return true;
      },
    },
  });

  assert.equal(granted, false);
  assert.equal(requestCalls, 0);
});

test("Firefox desktop requests X site access when not already granted", async () => {
  let requestCalls = 0;
  const granted = await ensureXPermission({
    browser: "firefox",
    userAgent: "Mozilla/5.0 (X11; Linux x86_64; rv:142.0) Gecko/20100101 Firefox/142.0",
    isSafari: false,
    origins: X_ORIGINS,
    permissions: {
      contains: async () => false,
      request: async () => {
        requestCalls += 1;
        return true;
      },
    },
  });

  assert.equal(granted, true);
  assert.equal(requestCalls, 1);
});
