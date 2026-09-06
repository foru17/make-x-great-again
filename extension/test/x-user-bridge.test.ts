// The MAIN-world bridge that restores profile signals on the timeline path.
//
// Background: a content script runs in an isolated world, where DOM-node
// expando properties set by the page (React's `__reactFiber$…`) are invisible.
// readFiberUser() therefore returned {} in every shipped build, so timeline
// payloads carried no userId, bio, follower count or account age — which
// starved the classifier and closed the edge's AI auto-publish lane (it
// requires a numeric uid). The fix stamps the fiber read into a DOM attribute
// from a MAIN-world script, because attributes DO cross the world boundary.
//
// These tests pin the isolated-world half: given a stamped element,
// extractFromArticle must surface those fields on Signals, and must refuse a
// stamp belonging to a different author (X recycles <article> nodes).
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseHTML } from "linkedom";

import { BRIDGE_ATTR, BRIDGE_HANDLE_ATTR, encodeBridgeUser, readBridgeUser } from "../lib/x-user-bridge";

function fixture(handle = "sexbot9911") {
  return parseHTML(`<!doctype html><html><body>
    <article data-testid="tweet">
      <div data-testid="User-Name">
        <a href="/${handle}"><span>小可爱</span></a>
        <span>@${handle}</span>
      </div>
      <div data-testid="tweetText">看主页 @dispatcher01</div>
    </article>
  </body></html>`);
}

const base = fixture();
Object.assign(globalThis, {
  HTMLElement: base.window.HTMLElement,
  Element: base.window.Element,
  Node: base.window.Node,
  // linkedom exposes no Window constructor, and its window.constructor is
  // plain Object — using that would make detect.ts's `o instanceof Window`
  // guard reject every object it walks. A dedicated stub keeps the guard
  // inert instead of universally true.
  Window: class WindowStub {},
  document: base.window.document,
  location: { pathname: "/someone/status/1" },
});

/** Parse a fresh page and make it the ambient document — detect.ts reads
 *  globals (viewerHandle, thread topic) as well as the element it is given. */
function mount(handle?: string) {
  const { document } = fixture(handle);
  Object.assign(globalThis, { document });
  return document.querySelector("article") as unknown as HTMLElement;
}

const { extractFromArticle, handleFromArticle } = await import("../lib/detect");

const FULL = {
  userId: "1450000000000000001",
  bio: "24h 在线 看主页",
  followersCount: 42,
  followingCount: 3100,
  accountCreatedAt: "2026-07-01T00:00:00.000Z",
  accountAgeDays: 53,
};

test("the extra profile facts and X's own avatar flag ride the bridge (2026-09-06)", () => {
  const art = mount();
  art.setAttribute(
    BRIDGE_ATTR,
    encodeBridgeUser({
      ...FULL,
      isVerified: true,
      statusesCount: 12_345,
      mediaCount: 800,
      favouritesCount: 9_000,
      location: "Tokyo",
      profileDefaultImage: false,
    }),
  );
  art.setAttribute(BRIDGE_HANDLE_ATTR, "sexbot9911");
  const sig = extractFromArticle(art);
  assert.equal(sig?.isVerified, true);
  assert.equal(sig?.statusesCount, 12_345);
  assert.equal(sig?.mediaCount, 800);
  assert.equal(sig?.favouritesCount, 9_000);
  assert.equal(sig?.location, "Tokyo");
  // The fixture has no <img>, so the DOM heuristic would say "default";
  // X's own flag wins and is labelled as the reliable source.
  assert.equal(sig?.hasDefaultAvatar, false);
  assert.equal(sig?.avatarSource, "profile");

  const bare = mount();
  const plain = extractFromArticle(bare);
  assert.equal(plain?.hasDefaultAvatar, true, "DOM heuristic without the flag");
  assert.equal(plain?.avatarSource, "dom");
  assert.equal(plain?.isVerified, undefined);
});

test("a stamped article surfaces the bridged profile signals on Signals", () => {
  const art = mount();
  art.setAttribute(BRIDGE_ATTR, encodeBridgeUser(FULL));
  art.setAttribute(BRIDGE_HANDLE_ATTR, "sexbot9911");

  const sig = extractFromArticle(art);
  assert.ok(sig, "article extracts");
  assert.equal(sig?.handle, "sexbot9911");
  assert.equal(sig?.userId, FULL.userId);
  assert.equal(sig?.bio, FULL.bio);
  assert.equal(sig?.followersCount, 42);
  assert.equal(sig?.followingCount, 3100);
  assert.equal(sig?.accountAgeDays, 53);
  assert.equal(sig?.accountCreatedAt, FULL.accountCreatedAt);
});

test("without a stamp the payload is handle-only — the pre-fix behaviour", () => {
  const art = mount();
  const sig = extractFromArticle(art);
  assert.ok(sig);
  assert.equal(sig?.userId, undefined);
  assert.equal(sig?.followersCount, undefined);
  assert.equal(sig?.accountAgeDays, undefined);
});

test("a stamp from a recycled node's previous author is ignored", () => {
  // X reuses <article> nodes as the timeline virtualizes. A stale stamp must
  // never hand one account's profile (or worse, its uid) to another.
  const art = mount("realperson");
  art.setAttribute(BRIDGE_ATTR, encodeBridgeUser(FULL));
  art.setAttribute(BRIDGE_HANDLE_ATTR, "sexbot9911");

  assert.equal(handleFromArticle(art), "realperson");
  assert.deepEqual(readBridgeUser(art, "realperson"), {});
  const sig = extractFromArticle(art);
  assert.equal(sig?.handle, "realperson");
  assert.equal(sig?.userId, undefined, "the other account's uid must not leak across");
});

test("a malformed stamp degrades to no signals instead of throwing", () => {
  const art = mount();
  art.setAttribute(BRIDGE_ATTR, "{not json");
  art.setAttribute(BRIDGE_HANDLE_ATTR, "sexbot9911");
  assert.deepEqual(readBridgeUser(art, "sexbot9911"), {});
  assert.equal(extractFromArticle(art)?.userId, undefined);
});

test("the stamp is matched case-insensitively on the handle", () => {
  const art = mount("SexBot9911");
  art.setAttribute(BRIDGE_ATTR, encodeBridgeUser(FULL));
  art.setAttribute(BRIDGE_HANDLE_ATTR, "sexbot9911");
  assert.equal(extractFromArticle(art)?.userId, FULL.userId);
});

test("bio is bounded so a stamp cannot bloat the page DOM", () => {
  const encoded = encodeBridgeUser({ bio: "x".repeat(5000) });
  const back = JSON.parse(encoded) as { bio: string };
  assert.equal(back.bio.length, 500);
});

// --- MAIN-world half -------------------------------------------------------
// Node has no world isolation, so readFiberUser() works here exactly as it
// does in the page world. That lets us pin the stamping contract: given an
// article whose React fiber carries the author, the bridge must publish the
// signals the classifier needs, keyed to that author.
test("the bridge stamps the fiber-borne profile onto the article", async () => {
  const art = mount();
  const legacy = {
    screen_name: "sexbot9911",
    description: "24h 在线 看主页",
    followers_count: 42,
    friends_count: 3100,
    created_at: "Tue Jul 01 00:00:00 +0000 2026",
  };
  // The shape X actually keeps in React state, reachable by walking up.
  const parent = { memoizedProps: { result: { __typename: "User", rest_id: "1450000000000000001", legacy } } };
  (art as unknown as Record<string, unknown>)["__reactFiber$test"] = {
    memoizedProps: {},
    memoizedState: null,
    return: parent,
  };

  const { readFiberUser, handleFromArticle: handleOf } = await import("../lib/detect");
  const handle = handleOf(art) as string;
  const u = readFiberUser(art, handle);
  art.setAttribute(BRIDGE_ATTR, encodeBridgeUser(u));
  art.setAttribute(BRIDGE_HANDLE_ATTR, handle);

  // Round-trip: what the isolated world gets back is what the classifier sends.
  const sig = extractFromArticle(art);
  assert.equal(sig?.userId, "1450000000000000001");
  assert.equal(sig?.bio, "24h 在线 看主页");
  assert.equal(sig?.followersCount, 42);
  assert.equal(sig?.followingCount, 3100);
  assert.equal(typeof sig?.accountAgeDays, "number");
});
