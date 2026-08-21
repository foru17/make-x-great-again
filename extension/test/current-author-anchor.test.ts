import assert from "node:assert/strict";
import { test } from "node:test";
import { parseHTML } from "linkedom";
import { findCurrentAuthorAnchor } from "../lib/current-author-anchor";

test("re-resolves a recycled cached anchor by the current author", () => {
  const { document, window } = parseHTML(`
    <main>
      <article id="row-a"><div data-testid="User-Name"><a href="/alice">@alice</a></div></article>
      <article id="row-b"><div data-testid="User-Name"><a href="/bob">@bob</a></div></article>
    </main>
  `);
  Object.assign(globalThis, { HTMLElement: window.HTMLElement });

  const stale = document.querySelector<HTMLElement>("#row-a [data-testid=User-Name]");
  const current = findCurrentAuthorAnchor(document, "bob", stale);

  assert.equal(current?.closest("article")?.id, "row-b");
});

test("does not return a connected node that was recycled for another author", () => {
  const { document, window } = parseHTML(`
    <main><article><div data-testid="User-Name"><a href="/bob">@bob</a></div></article></main>
  `);
  Object.assign(globalThis, { HTMLElement: window.HTMLElement });

  const current = findCurrentAuthorAnchor(document, "alice");
  assert.equal(current, null);
});
