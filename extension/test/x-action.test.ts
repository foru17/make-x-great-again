import assert from "node:assert/strict";
import test from "node:test";
import { performXAction } from "../lib/x-action";

test("native actions recheck protection after the cross-tab lock and pacing wait", async () => {
  for (const boundary of ["lock", "pacing"] as const) {
    const originals = new Map<string, PropertyDescriptor | undefined>();
    let allowed = true;
    let requests = 0;
    const globals = {
      navigator: { locks: { request: async (_name: string, run: () => unknown) => {
        if (boundary === "lock") allowed = false;
        return run();
      } } },
      localStorage: {
        getItem: () => { if (boundary === "pacing") allowed = false; return null; },
        setItem: () => {},
      },
      document: { cookie: "ct0=fixture-only" },
      location: { hostname: "x.com" },
      fetch: async () => { requests += 1; return new Response("{}", { status: 200 }); },
    };
    try {
      for (const [key, value] of Object.entries(globals)) {
        originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
        Object.defineProperty(globalThis, key, { configurable: true, value });
      }
      const result = await performXAction("block", "123", "fixture", () => allowed);
      assert.equal(requests, 0, `protection changed during ${boundary}`);
      assert.deepEqual(result, { ok: false, retryable: false });
    } finally {
      for (const [key, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    }
  }
});
