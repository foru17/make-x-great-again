import assert from "node:assert/strict";
import test from "node:test";
import { performXAction } from "../lib/x-action";

// performXAction serializes through a local promise chain (no navigator.locks —
// foreign-compartment promises throw in Firefox content scripts) and POSTs via
// XMLHttpRequest. Protection must be rechecked after both the in-tab queue wait
// and the cross-tab pacing wait.
function installGlobals(overrides: Record<string, unknown>) {
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries(overrides)) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  return () => {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  };
}

function fakeXhr(onSend: (finish: () => void) => void) {
  return class {
    status = 0;
    withCredentials = false;
    timeout = 0;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    ontimeout: (() => void) | null = null;
    onabort: (() => void) | null = null;
    open() {}
    setRequestHeader() {}
    getResponseHeader() {
      return null;
    }
    send() {
      onSend(() => {
        this.status = 200;
        this.onload?.();
      });
    }
  };
}

const baseGlobals = {
  document: { cookie: "ct0=fixture-only" },
  location: { hostname: "x.com" },
};

test("native actions recheck protection after the cross-tab pacing wait", async () => {
  let allowed = true;
  let requests = 0;
  const restore = installGlobals({
    ...baseGlobals,
    localStorage: {
      getItem: () => {
        allowed = false;
        return null;
      },
      setItem: () => {},
    },
    XMLHttpRequest: fakeXhr((finish) => {
      requests += 1;
      finish();
    }),
  });
  try {
    const result = await performXAction("block", "123", "fixture", () => allowed);
    assert.equal(requests, 0);
    assert.deepEqual(result, { ok: false, retryable: false });
  } finally {
    restore();
  }
});

test("native actions recheck protection after waiting behind an in-flight action", async () => {
  let requests = 0;
  let release: () => void = () => {};
  const restore = installGlobals({
    ...baseGlobals,
    localStorage: { getItem: () => null, setItem: () => {} },
    XMLHttpRequest: fakeXhr((finish) => {
      requests += 1;
      release = finish;
    }),
  });
  try {
    let allowed = true;
    const first = performXAction("block", "111", "first", () => true);
    const second = performXAction("block", "222", "second", () => allowed);
    // Let the first action reach its (held) request, then flip protection for
    // the queued one before releasing.
    for (let i = 0; i < 50 && requests === 0; i++) await new Promise((r) => setTimeout(r, 5));
    assert.equal(requests, 1);
    allowed = false;
    release();
    assert.equal((await first).ok, true);
    assert.deepEqual(await second, { ok: false, retryable: false });
    assert.equal(requests, 1);
  } finally {
    restore();
  }
});
