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

const { extractFromArticle } = await import("../lib/detect");

test("the article's own text is the triggering comment only — never mirrored into recentTweets", () => {
  const art = base.window.document.querySelector("article") as unknown as HTMLElement;
  const sig = extractFromArticle(art);
  assert.ok(sig);
  assert.equal(sig?.triggeringComment, "刚刚开始");
  assert.deepEqual(sig?.recentTweets, []);
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
