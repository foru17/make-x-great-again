// Payload semantics of extractFromArticle (2026-09-06).
//
// The article path used to copy the tweet text into BOTH triggeringComment
// and recentTweets[0]; the classifier then read "two identical texts" as
// "posts the same thing repeatedly" (2026-09-04 audit, root cause #2 —
// upheld appeal #371 cited exactly this). recentTweets is now reserved for
// genuinely separate posts, and the cache hash covers triggeringComment on
// its own so a new comment is still new evidence.
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseHTML } from "linkedom";
import { signalsHash } from "../lib/cache";

function fixture(text = "刚刚开始") {
  return parseHTML(`<!doctype html><html><body>
    <article data-testid="tweet">
      <div data-testid="User-Name">
        <a href="/romanrichshing"><span>Roman</span></a>
        <span>@romanrichshing</span>
      </div>
      <div data-testid="tweetText">${text}</div>
    </article>
  </body></html>`);
}

const base = fixture();
Object.assign(globalThis, {
  HTMLElement: base.window.HTMLElement,
  Element: base.window.Element,
  Node: base.window.Node,
  Window: class WindowStub {},
  document: base.window.document,
  location: { pathname: "/someone/status/1" },
});

const { extractFromArticle, pageSurface } = await import("../lib/detect");

test("the article's own text is the triggering comment only — never mirrored into recentTweets", () => {
  const art = base.window.document.querySelector("article") as unknown as HTMLElement;
  const sig = extractFromArticle(art);
  assert.ok(sig);
  assert.equal(sig?.triggeringComment, "刚刚开始");
  assert.deepEqual(sig?.recentTweets, []);
});

test("surface comes from the page path and X's 'Replying to' line marks a feed reply", () => {
  const { document } = parseHTML(`<!doctype html><html><body>
    <article data-testid="tweet">
      <div data-testid="User-Name">
        <a href="/wallen97754394"><span>wallen</span></a>
        <span>@wallen97754394</span>
      </div>
      <div dir="ltr"><span>Replying to </span><a href="/justinsuntron">@justinsuntron</a></div>
      <div data-testid="tweetText">@justinsuntron</div>
    </article>
  </body></html>`);
  const art = document.querySelector("article") as unknown as HTMLElement;
  Object.assign(globalThis, { location: { pathname: "/home" } });
  let sig = extractFromArticle(art);
  assert.equal(sig?.surface, "home");
  assert.equal(sig?.isReply, true);
  assert.equal(sig?.replyToHandle, "justinsuntron");

  Object.assign(globalThis, { location: { pathname: "/someone/status/1" } });
  sig = extractFromArticle(base.window.document.querySelector("article") as unknown as HTMLElement);
  assert.equal(sig?.surface, "thread");
  assert.equal(sig?.isReply, undefined, "no Replying-to line → the scan loop decides via the focal id");

  for (const [path, surface] of [
    ["/romanrichshing", "profile"],
    ["/romanrichshing/with_replies", "profile"],
    ["/search?q=x", "search"],
    ["/notifications", "notifications"],
    ["/i/bookmarks", "other"],
  ] as const) {
    Object.assign(globalThis, { location: { pathname: path.split("?")[0] } });
    assert.equal(pageSurface(), surface, path);
  }
  Object.assign(globalThis, { location: { pathname: "/someone/status/1" } });
});

test("a new triggering comment changes the cache hash even with empty recentTweets", () => {
  const common = {
    handle: "romanrichshing",
    displayName: "Roman",
    bio: "",
    recentTweets: [] as string[],
    hasDefaultAvatar: false,
  };
  const a = signalsHash({ ...common, triggeringComment: "刚刚开始" });
  const b = signalsHash({ ...common, triggeringComment: "看主页 @dispatcher01" });
  assert.notEqual(a, b);
  assert.equal(a, signalsHash({ ...common, triggeringComment: "刚刚开始" }), "deterministic");
});
