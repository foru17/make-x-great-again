import assert from "node:assert/strict";
import { test } from "node:test";
import { parseHTML } from "linkedom";

function fixture() {
  return parseHTML(`
    <main data-testid="primaryColumn">
      <section id="profile-surface">
        <a href="/spam/header_photo"></a>
        <div>
          <div data-testid="UserName"><span id="badge-anchor">@spam</span></div>
        </div>
      </section>
    </main>
  `);
}

const { window } = fixture();
Object.assign(globalThis, {
  HTMLElement: window.HTMLElement,
});

const { hideAccountSurface, restoreAccountSurfaces } = await import("../lib/account-surface");

test("manual local hide removes the visible profile header surface", () => {
  const { document } = fixture();
  const anchor = document.querySelector("#badge-anchor");
  const profileSurface = document.querySelector<HTMLElement>("#profile-surface");

  assert.equal(hideAccountSurface(anchor), true);
  assert.equal(profileSurface?.style.display, "none");
});

test("processed-record recovery restores a live hidden profile surface", () => {
  const { document } = fixture();
  const anchor = document.querySelector("#badge-anchor");
  const profileSurface = document.querySelector<HTMLElement>("#profile-surface");

  assert.equal(hideAccountSurface(anchor, "424242"), true);
  assert.equal(profileSurface?.getAttribute("data-xss-hidden-key"), "424242");
  assert.equal(restoreAccountSurfaces(new Set(["424242"]), document), 0);
  assert.equal(profileSurface?.style.display, "none");

  assert.equal(restoreAccountSurfaces(new Set(), document), 1);
  assert.equal(profileSurface?.style.display, "");
  assert.equal(profileSurface?.hasAttribute("data-xss-hidden-key"), false);
});
