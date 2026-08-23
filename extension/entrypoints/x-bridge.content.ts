// MAIN-world half of the profile-signal bridge. See lib/x-user-bridge.ts for
// the full rationale.
//
// Short version: X keeps every rendered author's full profile object in the
// page's React state, but a normal (isolated-world) content script cannot see
// the `__reactFiber$…` expando that leads to it. This script runs in the PAGE
// world, where the expando is visible, does the same fiber read the extension
// has always attempted, and stamps the result onto the element as a DOM
// attribute — the one channel both worlds share.
//
// It is strictly read-and-annotate: no network requests, no page globals
// touched, no X behaviour changed. Everything it publishes is data X already
// loaded into the tab.
import {
  BRIDGE_ATTR,
  BRIDGE_HANDLE_ATTR,
  type BridgeUser,
  bridgeStampMatches,
  encodeBridgeUser,
} from "../lib/x-user-bridge";
import { handleFromArticle, profileHandle, readFiberUser } from "../lib/detect";

/** Debounce for the mutation-driven sweep. Deliberately far below the 600ms
 *  the isolated scanner waits before it reads these attributes, so the stamp
 *  is in place by the time it looks. */
const SWEEP_DEBOUNCE_MS = 50;
/** Safety net for mutations we somehow miss (and for the very first paint). */
const SWEEP_INTERVAL_MS = 2000;
/** Upper bound on elements walked per sweep. A timeline that has been scrolled
 *  for a long time can hold hundreds of articles; the fiber walk is cheap but
 *  not free, and this script shares the page's main thread with X itself. */
const MAX_ELEMENTS_PER_SWEEP = 60;

function pick(u: ReturnType<typeof readFiberUser>): BridgeUser | null {
  const out: BridgeUser = {};
  if (u.userId) out.userId = u.userId;
  if (typeof u.bio === "string" && u.bio) out.bio = u.bio;
  if (typeof u.followersCount === "number") out.followersCount = u.followersCount;
  if (typeof u.followingCount === "number") out.followingCount = u.followingCount;
  if (u.accountCreatedAt) out.accountCreatedAt = u.accountCreatedAt;
  if (typeof u.accountAgeDays === "number") out.accountAgeDays = u.accountAgeDays;
  if (u.viewerFollowing) out.viewerFollowing = true;
  if (u.viewerBlocking) out.viewerBlocking = true;
  if (u.viewerMuting) out.viewerMuting = true;
  if (u.viewerFollowRequestSent) out.viewerFollowRequestSent = true;
  // Nothing worth carrying across — leave the element unstamped so a later
  // sweep (once X has hydrated the author) tries again.
  return Object.keys(out).length ? out : null;
}

function stamp(el: Element, handle: string): void {
  if (bridgeStampMatches(el, handle)) return; // already current for this author
  const user = pick(readFiberUser(el, handle));
  if (!user) return;
  el.setAttribute(BRIDGE_ATTR, encodeBridgeUser(user));
  el.setAttribute(BRIDGE_HANDLE_ATTR, handle);
}

function sweep(): void {
  let budget = MAX_ELEMENTS_PER_SWEEP;
  const profile = profileHandle();
  if (profile) {
    const scope = document.querySelector('[data-testid="primaryColumn"]');
    if (scope) {
      stamp(scope, profile);
      budget--;
    }
  }
  for (const art of document.querySelectorAll<HTMLElement>('article[data-testid="tweet"]')) {
    if (budget <= 0) break;
    const handle = handleFromArticle(art);
    if (!handle) continue;
    // Skipping already-stamped nodes is what keeps a long timeline cheap:
    // only freshly inserted (or recycled-to-a-new-author) articles cost a walk.
    if (bridgeStampMatches(art, handle)) continue;
    stamp(art, handle);
    budget--;
  }
}

export default defineContentScript({
  matches: ["https://x.com/*", "https://twitter.com/*"],
  // The page world — the whole point of this script. A browser that does not
  // support this key ignores it and the script runs isolated, where it stamps
  // nothing; the extension then behaves exactly as it did before the bridge.
  world: "MAIN",
  // Ahead of X's own hydration so the observer is watching from the start.
  runAt: "document_start",
  main() {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(sweep, SWEEP_DEBOUNCE_MS);
    };
    const start = () => {
      sweep();
      // childList only — we must NOT observe attributes, or our own stamps
      // would retrigger the sweep forever.
      new MutationObserver(schedule).observe(document.body, {
        childList: true,
        subtree: true,
      });
      // This interval outlives an extension reload (a MAIN-world script has no
      // runtime handle to notice invalidation), so keep it genuinely cheap:
      // skip hidden tabs, and the sweep itself no-ops on already-stamped nodes.
      setInterval(() => {
        if (document.visibilityState === "visible") sweep();
      }, SWEEP_INTERVAL_MS);
    };
    if (document.body) start();
    else document.addEventListener("DOMContentLoaded", start, { once: true });
  },
});
