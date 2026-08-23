// Cross-world handoff for X's in-page user objects.
//
// WHY THIS EXISTS
// ---------------
// X loads each author's FULL profile (bio, follower counts, created_at, the
// numeric user id) into the page's React state even inside reply lists — it
// just doesn't render most of it. `readFiberUser` in detect.ts reads that
// already-in-memory object off the DOM node's `__reactFiber$…` property.
//
// But a content script runs in an ISOLATED world, and expando properties that
// page scripts put on DOM nodes live on the page world's wrapper objects. From
// the isolated world `Object.keys(articleElement)` is literally `[]`, so the
// fiber walk has always returned `{}` in the shipped extension. Measured on
// production 2026-08-23: `account_created_at` — a field only the fiber can
// supply — was present on ~1% of rows for the entire history of the table,
// while ~98% of live payloads arrived with no userId, no bio, no follower
// count and no account age. That starved the classifier (one tweet's text and
// nothing else) and closed the edge's AI auto-publish lane outright, since it
// requires a numeric uid.
//
// DOM *attributes*, unlike JS expandos, are shared across worlds. So a
// MAIN-world content script does the fiber read and stamps the result onto the
// element as an attribute; the isolated world reads it back synchronously,
// which keeps `extractFromArticle` synchronous and leaves the scan loop alone.
//
// Degrades safely: on a browser that ignores `world: "MAIN"`, nothing is
// stamped, `readBridgeUser` returns `{}`, and behaviour is exactly what it is
// today.

/** Attribute the MAIN-world bridge stamps its JSON payload into. */
export const BRIDGE_ATTR = "data-mxga-u";
/** Attribute holding the handle the payload belongs to, so a recycled
 *  (virtualized) node can never hand its previous author's profile to the
 *  next one. X reuses <article> nodes aggressively. */
export const BRIDGE_HANDLE_ATTR = "data-mxga-uh";

/** The subset of a user object worth carrying across the boundary. Mirrors
 *  the fields Signals actually sends to the classifier. */
export interface BridgeUser {
  bio?: string;
  userId?: string;
  followersCount?: number;
  followingCount?: number;
  accountCreatedAt?: string;
  accountAgeDays?: number;
  viewerFollowing?: true;
  viewerBlocking?: true;
  viewerMuting?: true;
  viewerFollowRequestSent?: true;
}

function normalizeHandle(handle: string | undefined): string {
  return handle?.trim().replace(/^@+/, "").toLowerCase() ?? "";
}

/** Bound the stamped payload so a hostile/odd profile can't bloat the DOM. */
const MAX_BIO = 500;

export function encodeBridgeUser(u: BridgeUser): string {
  const out: BridgeUser = { ...u };
  if (typeof out.bio === "string") out.bio = out.bio.slice(0, MAX_BIO);
  return JSON.stringify(out);
}

/** Read back what the MAIN-world bridge stamped for `handle`.
 *  Returns {} when the bridge never ran, the payload is malformed, or the node
 *  has since been recycled for a different author. */
export function readBridgeUser(el: Element | null, handle: string | undefined): BridgeUser {
  if (!el) return {};
  const want = normalizeHandle(handle);
  if (!want) return {};
  if (normalizeHandle(el.getAttribute(BRIDGE_HANDLE_ATTR) ?? undefined) !== want) return {};
  const raw = el.getAttribute(BRIDGE_ATTR);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as BridgeUser;
  } catch {
    return {};
  }
}

/** True when the element already carries a payload for this exact author, so
 *  the MAIN-world sweep can skip re-walking it. */
export function bridgeStampMatches(el: Element, handle: string | undefined): boolean {
  return (
    !!el.getAttribute(BRIDGE_ATTR) &&
    normalizeHandle(el.getAttribute(BRIDGE_HANDLE_ATTR) ?? undefined) === normalizeHandle(handle)
  );
}
