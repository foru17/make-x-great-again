// Passive DOM extraction. Reads only what X already rendered — no scraping,
// no navigation, no extra requests to X.
import type { Signals, Surface } from "./types";
import { type BridgeUser, readBridgeUser } from "./x-user-bridge";

/** Everything the passive extractors could learn about an author, merged
 *  from React fiber, action-button metadata and page JSON-LD. */
export interface KnownUser {
  bio?: string;
  userId?: string;
  followersCount?: number;
  followingCount?: number;
  accountCreatedAt?: string;
  accountAgeDays?: number;
  displayName?: string;
  avatarUrl?: string;
  isVerified?: boolean;
  statusesCount?: number;
  mediaCount?: number;
  favouritesCount?: number;
  location?: string;
  profileDefaultImage?: boolean;
  viewerFollowing?: true;
  viewerBlocking?: true;
  viewerMuting?: true;
  viewerFollowRequestSent?: true;
  viewerIsSelf?: true;
}

const NON_PROFILE = new Set([
  "home", "explore", "notifications", "messages", "i", "search", "settings",
  "compose", "hashtag", "bookmarks", "lists", "communities", "jobs", "tos",
  "privacy", "login", "signup",
]);
const TWITTER_SNOWFLAKE_EPOCH_MS = 1_288_834_974_657n;
const UID_CREATED_AT_TOLERANCE_MS = 2 * 86_400_000;

export function parseJoinDate(text: string | null | undefined): number | undefined {
  if (!text) return undefined;
  const now = Date.now();
  let d: Date | undefined;
  const zh = text.match(/(\d{4})年(\d{1,2})月/);
  if (zh) d = new Date(Number(zh[1]), Number(zh[2]) - 1, 1);
  if (!d) {
    const en = text.match(/Joined\s+([A-Za-z]+)\s+(\d{4})/i);
    if (en) d = new Date(`${en[1]} 1, ${en[2]}`);
  }
  if (!d || Number.isNaN(d.getTime())) return undefined;
  return Math.max(0, Math.round((now - d.getTime()) / 86_400_000));
}

export function parseCount(text: string | null | undefined): number | undefined {
  if (!text) return undefined;
  const m = text.replace(/[, ]/g, "").match(/([\d.]+)\s*([万KkMm千]?)/);
  if (!m || m[1] === undefined) return undefined;
  const mult: Record<string, number> =
    { 万: 1e4, 千: 1e3, K: 1e3, k: 1e3, M: 1e6, m: 1e6 };
  return Math.round(Number.parseFloat(m[1]) * (mult[m[2] ?? ""] ?? 1));
}

function avatarInfo(scope: Element | Document) {
  const img = scope.querySelector<HTMLImageElement>('img[src*="profile_images/"]');
  return { hasDefaultAvatar: !img, avatarUrl: img?.src };
}

function normalizeHandle(handle: string | undefined): string | undefined {
  return handle?.trim().replace(/^@+/, "").toLowerCase() || undefined;
}

function numericId(v: unknown): string | undefined {
  return typeof v === "string" && /^\d+$/.test(v) ? v : undefined;
}

function numericString(v: unknown): string | undefined {
  if (typeof v === "number" && Number.isSafeInteger(v)) return String(v);
  return numericId(v);
}

function trueFlag(v: unknown): true | undefined {
  return v === true ? true : undefined;
}

function bannerUserId(scope: Element | Document): string | undefined {
  const el = scope.querySelector<HTMLElement>('[src*="profile_banners/"], [style*="profile_banners/"]');
  const raw =
    el instanceof HTMLImageElement ? el.src : (el?.getAttribute("style") ?? "");
  return numericId(raw.match(/profile_banners\/(\d+)\//)?.[1]);
}

function snowflakeTimeMs(id: string): number | undefined {
  if (id.length < 16) return undefined;
  try {
    return Number((BigInt(id) >> 22n) + TWITTER_SNOWFLAKE_EPOCH_MS);
  } catch {
    return undefined;
  }
}

// X exposes the canonical profile user id as JSON-LD on profile pages. Prefer
// it there: unlike profile_images/<n>, mainEntity.identifier is the account id.
function profileJsonLdUserId(expectedHandle?: string): string | undefined {
  for (const script of document.querySelectorAll<HTMLScriptElement>(
    'script[type="application/ld+json"]',
  )) {
    try {
      const data = JSON.parse(script.textContent ?? "") as unknown;
      const pages = Array.isArray(data) ? data : [data];
      for (const page of pages) {
        if (!page || typeof page !== "object") continue;
        const p = page as Record<string, unknown>;
        if (p["@type"] !== "ProfilePage") continue;
        const entity = p.mainEntity;
        if (!entity || typeof entity !== "object") continue;
        const e = entity as Record<string, unknown>;
        if (e["@type"] !== "Person") continue;

        const handle =
          normalizeHandle(typeof e.additionalName === "string" ? e.additionalName : undefined) ??
          normalizeHandle(
            typeof e.url === "string"
              ? e.url.match(/\/([^/?#]+)(?:[?#].*)?$/)?.[1]
              : undefined,
          );
        if (expectedHandle && handle !== expectedHandle) continue;

        const id = numericString(e.identifier);
        if (id) return id;
      }
    } catch {
      /* malformed / unrelated JSON-LD — skip */
    }
  }
  return undefined;
}

export interface FiberUser {
  bio?: string;
  userId?: string;
  followersCount?: number;
  followingCount?: number;
  accountCreatedAt?: string;
  accountAgeDays?: number;
  isVerified?: boolean;
  statusesCount?: number;
  mediaCount?: number;
  favouritesCount?: number;
  location?: string;
  /** X's own default_profile_image flag — the reliable avatar signal. */
  profileDefaultImage?: boolean;
  viewerFollowing?: true;
  viewerBlocking?: true;
  viewerMuting?: true;
  viewerFollowRequestSent?: true;
  viewerIsSelf?: true;
}

/** The logged-in viewer's own handle, read from X's nav DOM. Exported so the
 *  whitelist self-service flow can lock applications to the user's OWN
 *  account (no free-text handle = no applying for someone else). */
export function viewerHandle(): string | undefined {
  const profileHref = document
    .querySelector<HTMLAnchorElement>('[data-testid="AppTabBar_Profile_Link"]')
    ?.getAttribute("href");
  const fromHref = normalizeHandle(profileHref?.match(/^\/([^/?#]+)/)?.[1]);
  if (fromHref && !NON_PROFILE.has(fromHref)) return fromHref;

  const switcherText =
    document.querySelector<HTMLElement>('[data-testid="SideNav_AccountSwitcher_Button"]')
      ?.innerText ?? "";
  return normalizeHandle(switcherText.match(/@([A-Za-z0-9_]{1,15})/)?.[1]);
}

function isViewerHandle(handle: string | undefined): true | undefined {
  const viewer = viewerHandle();
  const target = normalizeHandle(handle);
  return viewer && target && viewer === target ? true : undefined;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function actionUserInfo(scope: Element | Document, handle?: string): Pick<
  FiberUser,
  "userId" | "viewerFollowing"
> {
  const expected = normalizeHandle(handle);
  const mention = expected ? new RegExp(`@${escapeRegExp(expected)}\\b`, "i") : undefined;
  for (const el of scope.querySelectorAll<HTMLElement>(
    '[data-testid$="-follow"], [data-testid$="-unfollow"], [data-testid$="-subscribe"]',
  )) {
    const testid = el.getAttribute("data-testid") ?? "";
    const match = testid.match(/^(\d+)-(follow|unfollow|subscribe)$/);
    if (!match) continue;
    const label = `${el.getAttribute("aria-label") ?? ""}\n${el.innerText ?? ""}`;
    if (mention && !mention.test(label)) continue;
    return {
      userId: match[1],
      ...(match[2] === "unfollow" ? { viewerFollowing: true as const } : {}),
    };
  }
  if (mention) {
    for (const el of scope.querySelectorAll<HTMLElement>('button, [role="button"]')) {
      const label = `${el.getAttribute("aria-label") ?? ""}\n${el.innerText ?? ""}`;
      if (mention.test(label) && /(取消关注|正在关注|Following|Unfollow)/i.test(label)) {
        return { viewerFollowing: true as const };
      }
    }
  }
  return {};
}

/**
 * X loads each author's FULL profile (description / counts / created_at) into
 * the page's React data even in reply lists — it just doesn't render the bio.
 * We read that already-in-memory object. Zero extra requests, no hover, fully
 * passive. Best-effort: if X's internals change we return {} and fall back to
 * the visible signals (no regression).
 */
const fiberCache = new WeakMap<Element, Map<string, FiberUser>>();

export function readFiberUser(el: Element, handle?: string): FiberUser {
  const cacheKey = normalizeHandle(handle) ?? "";
  const hit = fiberCache.get(el)?.get(cacheKey);
  if (hit) return hit;
  const out = readFiberUserUncached(el, cacheKey || undefined);
  if (Object.keys(out).length) {
    const byHandle = fiberCache.get(el) ?? new Map<string, FiberUser>();
    byHandle.set(cacheKey, out);
    fiberCache.set(el, byHandle);
  }
  return out;
}

function readFiberUserUncached(el: Element, expectedHandle?: string): FiberUser {
  try {
    const fk = Object.keys(el).find((k) => k.startsWith("__reactFiber$"));
    if (!fk) return {};
    // biome-ignore lint/suspicious/noExplicitAny: React internals are untyped
    let node: any = (el as any)[fk];
    const seen = new Set<unknown>();
    const budget = { n: 4000 }; // hard cap: never let the walk hang the page
    for (let i = 0; node && i < 24; i++) {
      for (const bag of [node.memoizedProps, node.memoizedState]) {
        const u = findUser(bag, seen, 0, budget, expectedHandle);
        if (u) {
          const legacy = u.legacy ?? u;
          // 2025 GraphQL shape: identity in `core`, viewer relationship in
          // `relationship_perspectives`, verification/location/avatar in
          // their own sub-objects. Read both old and new locations.
          const core = u.core ?? {};
          const rel = u.relationship_perspectives ?? {};
          const createdRaw = legacy.created_at ?? core.created_at;
          const created = createdRaw ? Date.parse(createdRaw) : NaN;
          const userId = fiberUserId(u, legacy);
          const accountAgeDays = Number.isNaN(created)
            ? undefined
            : Math.max(0, Math.round((Date.now() - created) / 86_400_000));
          const accountCreatedAt = Number.isNaN(created)
            ? undefined
            : new Date(created).toISOString();
          const count = (v: unknown) =>
            typeof v === "number" && Number.isFinite(v) ? v : undefined;
          const statusesCount = count(legacy.statuses_count);
          const mediaCount = count(legacy.media_count);
          const favouritesCount = count(legacy.favourites_count);
          const isVerified =
            trueFlag(u.is_blue_verified) ||
            trueFlag(legacy.verified) ||
            trueFlag(legacy.is_blue_verified) ||
            trueFlag(u.verification?.verified)
              ? true
              : undefined;
          const locationRaw =
            typeof legacy.location === "string" ? legacy.location : u.location?.location;
          const location =
            typeof locationRaw === "string" && locationRaw.trim()
              ? locationRaw.trim().slice(0, 100)
              : undefined;
          const avatarUrl: string | undefined =
            typeof legacy.profile_image_url_https === "string"
              ? legacy.profile_image_url_https
              : typeof u.avatar?.image_url === "string"
                ? u.avatar.image_url
                : undefined;
          const profileDefaultImage =
            typeof legacy.default_profile_image === "boolean"
              ? legacy.default_profile_image
              : avatarUrl
                ? /default_profile/.test(avatarUrl)
                : undefined;
          const following = trueFlag(legacy.following) || trueFlag(rel.following);
          const blocking = trueFlag(legacy.blocking) || trueFlag(rel.blocking);
          const muting = trueFlag(legacy.muting) || trueFlag(rel.muting);
          const followRequestSent =
            trueFlag(legacy.follow_request_sent) || trueFlag(rel.follow_request_sent);
          return {
            bio: typeof legacy.description === "string" ? legacy.description : "",
            ...(userId ? { userId } : {}),
            followersCount: legacy.followers_count,
            followingCount: legacy.friends_count,
            ...(accountCreatedAt ? { accountCreatedAt } : {}),
            ...(accountAgeDays !== undefined ? { accountAgeDays } : {}),
            ...(isVerified ? { isVerified } : {}),
            ...(statusesCount !== undefined ? { statusesCount } : {}),
            ...(mediaCount !== undefined ? { mediaCount } : {}),
            ...(favouritesCount !== undefined ? { favouritesCount } : {}),
            ...(location ? { location } : {}),
            ...(profileDefaultImage !== undefined ? { profileDefaultImage } : {}),
            ...(following ? { viewerFollowing: true as const } : {}),
            ...(blocking ? { viewerBlocking: true as const } : {}),
            ...(muting ? { viewerMuting: true as const } : {}),
            ...(followRequestSent ? { viewerFollowRequestSent: true as const } : {}),
          };
        }
      }
      node = node.return;
    }
  } catch {
    /* X internals changed → graceful empty */
  }
  return {};
}

// biome-ignore lint/suspicious/noExplicitAny: React internals are untyped
function fiberUserId(u: any, legacy: any): string | undefined {
  const fromLegacy = numericId(legacy?.id_str);
  const fromRest = numericId(u?.rest_id);
  if (fromLegacy && fromRest && fromLegacy !== fromRest) {
    console.warn("[MXGA] conflicting X user ids in fiber; dropping uid", {
      legacyId: fromLegacy,
      restId: fromRest,
      screenName: legacy?.screen_name ?? u?.core?.screen_name,
    });
    return undefined;
  }
  const candidate = fromLegacy ?? fromRest;
  const avatarId = numericId(
    String(legacy?.profile_image_url_https ?? "").match(/profile_images\/(\d+)\//)?.[1],
  );
  const candidateTime = candidate ? snowflakeTimeMs(candidate) : undefined;
  const created = typeof legacy?.created_at === "string" ? Date.parse(legacy.created_at) : NaN;
  if (
    candidate &&
    avatarId === candidate &&
    candidateTime !== undefined &&
    !Number.isNaN(created) &&
    Math.abs(candidateTime - created) > UID_CREATED_AT_TOLERANCE_MS
  ) {
    console.warn("[MXGA] fiber uid looks like avatar media id; dropping uid", {
      candidate,
      screenName: legacy?.screen_name,
      createdAt: legacy.created_at,
      avatarUrl: legacy.profile_image_url_https,
    });
    return undefined;
  }
  return candidate;
}

// biome-ignore lint/suspicious/noExplicitAny: deep search over React internals
function findUser(
  o: any,
  seen: Set<unknown>,
  depth: number,
  b: { n: number },
  expectedHandle?: string,
): any {
  if (!o || typeof o !== "object" || depth > 5 || seen.has(o)) return null;
  if (--b.n <= 0) return null; // global work budget — cannot hang the page
  if (o instanceof Node || o instanceof Window) return null; // skip DOM/window
  seen.add(o);
  try {
    const legacy = o.legacy ?? o;
    // X moved screen_name / name / created_at out of `legacy` into `core`
    // (and the viewer relationship into `relationship_perspectives`) in
    // 2025; accept both shapes, or the walk never finds a user at all.
    if (
      o.__typename === "User" &&
      legacy &&
      typeof legacy === "object" &&
      typeof legacy.description === "string" &&
      ("followers_count" in legacy || "screen_name" in legacy || "screen_name" in (o.core ?? {}))
    ) {
      const screenName = normalizeHandle(legacy.screen_name ?? o.core?.screen_name);
      if (!expectedHandle || screenName === expectedHandle) return o;
    }
    for (const k of Object.keys(o)) {
      const r = findUser(o[k], seen, depth + 1, b, expectedHandle);
      if (r) return r;
    }
  } catch {
    /* getter threw — skip this branch */
  }
  return null;
}

/** The handle whose profile page we are on, or undefined anywhere else.
 *  Exported so the MAIN-world bridge scopes its profile stamp to the same
 *  account extractProfile() will ask about. */
export function profileHandle(): string | undefined {
  const seg = location.pathname.split("/").filter(Boolean);
  if (seg.length !== 1) return undefined;
  const h = seg[0] ?? "";
  return NON_PROFILE.has(h) || !/^[A-Za-z0-9_]{1,15}$/.test(h) ? undefined : h;
}

/** Author handle of a timeline article, read from the byline permalink.
 *  Shared by the scan loop and the MAIN-world bridge so both agree on which
 *  account an <article> currently belongs to (X recycles these nodes). */
export function handleFromArticle(art: HTMLElement): string | undefined {
  const nameBlock = art.querySelector<HTMLElement>('[data-testid="User-Name"]');
  if (!nameBlock) return undefined;
  for (const a of nameBlock.querySelectorAll<HTMLAnchorElement>('a[href^="/"]')) {
    const s = (a.getAttribute("href") ?? "").split("/").filter(Boolean);
    if (s.length === 1 && /^[A-Za-z0-9_]{1,15}$/.test(s[0] ?? "")) return s[0];
  }
  return undefined;
}

export function extractProfile(): Signals | null {
  const seg = location.pathname.split("/").filter(Boolean);
  if (seg.length !== 1 || NON_PROFILE.has(seg[0] ?? "")) return null;
  const nameEl = document.querySelector<HTMLElement>('[data-testid="UserName"]');
  if (!nameEl) return null;

  const lines = nameEl.innerText.split("\n").map((s) => s.trim()).filter(Boolean);
  const handle = (lines.find((s) => s.startsWith("@")) ?? `@${seg[0]}`).slice(1);
  const displayName = lines[0] && !lines[0].startsWith("@") ? lines[0] : "";
  const bioEl = document.querySelector<HTMLElement>('[data-testid="UserDescription"]');
  const joinEl = document.querySelector<HTMLElement>('[data-testid="UserJoinDate"]');

  let followers: number | undefined;
  let following: number | undefined;
  for (const a of document.querySelectorAll<HTMLAnchorElement>(
    'a[href*="/follow"], a[href$="/verified_followers"]',
  )) {
    const href = a.getAttribute("href") ?? "";
    const val = parseCount(a.innerText);
    if (/\/following$/.test(href)) following = val;
    else if (/(verified_)?followers$/.test(href)) followers = val;
  }
  const scope =
    document.querySelector('[data-testid="primaryColumn"]') ?? document;
  const { hasDefaultAvatar, avatarUrl } = avatarInfo(scope);
  const profileScope = scope instanceof Element ? scope : nameEl;
  const actionUser = actionUserInfo(profileScope, handle);
  const fu: KnownUser = {
    ...readFiberUser(profileScope, handle),
    ...readBridgeUser(profileScope, handle),
    ...(actionUser.userId ? { userId: actionUser.userId } : {}),
    ...(actionUser.viewerFollowing ? { viewerFollowing: true as const } : {}),
    ...(isViewerHandle(handle) || profileScope.querySelector('[data-testid="editProfileButton"]')
      ? { viewerIsSelf: true as const }
      : {}),
  };
  const jsonLdUserId = profileJsonLdUserId(handle);
  if (jsonLdUserId && fu.userId && jsonLdUserId !== fu.userId) {
    console.warn("[MXGA] profile JSON-LD user id differs from observed user id; using JSON-LD", {
      handle,
      jsonLdUserId,
      observedUserId: fu.userId,
    });
  }
  const userId = jsonLdUserId ?? fu.userId ?? bannerUserId(scope);

  return {
    isProfile: true,
    surface: "profile",
    handle,
    displayName,
    bio: bioEl ? bioEl.innerText.trim() : "",
    ...avatarSignal(hasDefaultAvatar, fu),
    // The profile page renders the account's own recent posts — until now the
    // profile path sent NO text at all (upheld appeal #367: "no posts, no
    // bio, no comment"). Own posts only (reposts carry the original author's
    // handle), deduped, bounded.
    recentTweets: profileTweets(profileScope, handle),
    ...(avatarUrl ? { avatarUrl } : {}),
    ...(userId ? { userId } : {}),
    ...profileFacts(fu),
    ...(fu.viewerFollowing ? { viewerFollowing: true as const } : {}),
    ...(fu.viewerBlocking ? { viewerBlocking: true as const } : {}),
    ...(fu.viewerMuting ? { viewerMuting: true as const } : {}),
    ...(fu.viewerFollowRequestSent ? { viewerFollowRequestSent: true as const } : {}),
    ...(fu.viewerIsSelf ? { viewerIsSelf: true as const } : {}),
    ...(fu.accountCreatedAt ? { accountCreatedAt: fu.accountCreatedAt } : {}),
    ...(parseJoinDate(joinEl?.innerText) !== undefined
      ? { accountAgeDays: parseJoinDate(joinEl?.innerText) }
      : {}),
    ...(followers !== undefined ? { followersCount: followers } : {}),
    ...(following !== undefined ? { followingCount: following } : {}),
  };
}

/** Up to this many of the account's own visible posts ride along from a
 *  profile page. The edge schema accepts 20; ten is plenty of history. */
const PROFILE_TWEETS_MAX = 10;

export function profileTweets(scope: Element | Document, handle: string): string[] {
  const want = handle.toLowerCase();
  const out: string[] = [];
  const seen = new Set<string>();
  for (const art of scope.querySelectorAll<HTMLElement>('article[data-testid="tweet"]')) {
    if (out.length >= PROFILE_TWEETS_MAX) break;
    if (handleFromArticle(art)?.toLowerCase() !== want) continue; // repost of someone else
    if (isPromoted(art)) continue;
    const text = art.querySelector<HTMLElement>('[data-testid="tweetText"]')?.innerText.trim();
    if (!text) continue;
    const t = text.slice(0, 500);
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/** hasDefaultAvatar with provenance: X's own default_profile_image flag when
 *  the fiber/bridge delivered it (reliable), else the DOM heuristic (an
 *  <img> that failed to lazy-load reads as "default" — unreliable, and the
 *  classifier is told so). */
function avatarSignal(
  domDefault: boolean,
  fu: { profileDefaultImage?: boolean },
): Pick<Signals, "hasDefaultAvatar" | "avatarSource"> {
  return fu.profileDefaultImage !== undefined
    ? { hasDefaultAvatar: fu.profileDefaultImage, avatarSource: "profile" }
    : { hasDefaultAvatar: domDefault, avatarSource: "dom" };
}

/** The extra profile facts X already holds in the page. */
function profileFacts(
  fu: Pick<FiberUser, "isVerified" | "statusesCount" | "mediaCount" | "favouritesCount" | "location">,
): Pick<Signals, "isVerified" | "statusesCount" | "mediaCount" | "favouritesCount" | "location"> {
  return {
    ...(fu.isVerified ? { isVerified: true } : {}),
    ...(fu.statusesCount !== undefined ? { statusesCount: fu.statusesCount } : {}),
    ...(fu.mediaCount !== undefined ? { mediaCount: fu.mediaCount } : {}),
    ...(fu.favouritesCount !== undefined ? { favouritesCount: fu.favouritesCount } : {}),
    ...(fu.location ? { location: fu.location } : {}),
  };
}

const AD_LABEL = /^(广告|推广|Promoted|Ad|プロモーション|광고)$/;

/** X's own paid promoted post — NOT spam, must be skipped entirely. */
function isPromoted(article: HTMLElement): boolean {
  if (article.querySelector('[data-testid="placementTracking"]')) return true;
  const tweetText = article.querySelector('[data-testid="tweetText"]');
  for (const el of article.querySelectorAll<HTMLElement>("span,div")) {
    if (tweetText?.contains(el)) continue; // ignore the post body itself
    if (AD_LABEL.test(el.textContent?.trim() ?? "")) return true;
  }
  return false;
}

// X auto-translate detection. When X renders a machine translation it swaps
// the tweet body for the translated text and adds an attribution line
// ("Translated from <lang> by <provider>" / "翻译自…" with a Show-original
// toggle) — the original text is NOT in the DOM. We can only flag it:
// downstream consumers (server keyword rules / LLM) treat flagged text as a
// translation instead of the author's own words. The regex matches the
// attribution wording, not the "Translate post" button (which means the text
// IS original). textContent (no layout) keeps this cheap per scan tick.
const TRANSLATION_MARKER_RE =
  /translated from|show original|翻译自|显示原文|翻譯自|顯示原文|由\s*\S{1,12}\s*(?:翻译|翻譯)|原文を表示|から翻訳|번역함|원본 보기/i;

function articleShowsTranslation(article: HTMLElement, tweetEl: HTMLElement | null): boolean {
  if (!tweetEl) return false;
  return TRANSLATION_MARKER_RE.test(article.textContent ?? "");
}

/** Which X surface the current page is. Cheap (pathname only). */
export function pageSurface(): Surface {
  const p = location.pathname;
  if (p === "/home" || p === "/" || p.startsWith("/i/lists/") || p === "/explore") return "home";
  if (/^\/[^/]+\/status\/\d+/.test(p)) return "thread";
  if (p.startsWith("/search")) return "search";
  if (p.startsWith("/notifications")) return "notifications";
  if (/^\/[A-Za-z0-9_]{1,15}(\/(with_replies|media|likes|highlights|articles))?\/?$/.test(p)) {
    return "profile";
  }
  return "other";
}

// X's "Replying to @a @b" line above the body (home / search / profile
// feeds; not shown for replies inside the conversation view — those are
// recognised by the caller via the focal status id). Wording per X locale.
const REPLYING_TO_RE =
  /^(replying to|回复|回覆|返信先|답글|antwort an|en réponse à|respondiendo a|em resposta a|in risposta a|antwoord aan)\b/i;

/** Handle a feed article replies to, from X's own "Replying to" line. */
export function replyTarget(article: HTMLElement, tweetEl: HTMLElement | null): string | undefined {
  for (const el of article.querySelectorAll<HTMLElement>("div, span")) {
    if (tweetEl?.contains(el)) continue;
    const t = (el.textContent ?? "").trim();
    if (!t || t.length > 200 || !REPLYING_TO_RE.test(t)) continue;
    for (const a of el.querySelectorAll<HTMLAnchorElement>('a[href^="/"]')) {
      const s = (a.getAttribute("href") ?? "").split("/").filter(Boolean);
      if (s.length === 1 && /^[A-Za-z0-9_]{1,15}$/.test(s[0] ?? "")) return s[0];
    }
  }
  return undefined;
}

export function extractFromArticle(article: HTMLElement): Signals | null {
  if (isPromoted(article)) return null; // official X ad → not spam
  const { hasDefaultAvatar, avatarUrl } = avatarInfo(article);
  const nameBlock = article.querySelector<HTMLElement>('[data-testid="User-Name"]');
  if (!nameBlock) return null;
  let handle: string | undefined;
  let displayName = "";
  for (const a of nameBlock.querySelectorAll<HTMLAnchorElement>('a[href^="/"]')) {
    const s = (a.getAttribute("href") ?? "").split("/").filter(Boolean);
    if (s.length === 1 && /^[A-Za-z0-9_]{1,15}$/.test(s[0] ?? "")) handle = s[0];
  }
  const txt = nameBlock.innerText.split("\n").map((s) => s.trim()).filter(Boolean);
  if (txt.length) displayName = txt[0] ?? "";
  if (!handle) {
    const at = txt.find((s) => s.startsWith("@"));
    if (at) handle = at.slice(1);
  }
  if (!handle) return null;
  const tweetEl = article.querySelector<HTMLElement>('[data-testid="tweetText"]');
  const tweetText = tweetEl ? tweetEl.innerText.trim() : "";
  const tweetsTranslated = articleShowsTranslation(article, tweetEl);
  const replyTo = replyTarget(article, tweetEl);
  // Profile signals, best source first:
  //  1. the MAIN-world bridge, which CAN read X's React fiber (see
  //     lib/x-user-bridge.ts — the isolated world cannot, so without this the
  //     next line yields nothing and the payload goes out handle-only),
  //  2. the direct fiber read, which still works in tests and in any context
  //     where this module runs in the page world,
  //  3. the follow-button's data-testid, which carries a bare uid.
  const bridgeUser = readBridgeUser(article, handle);
  const fiberUser = readFiberUser(article, handle);
  const actionUser = actionUserInfo(article, handle);
  const known: BridgeUser = { ...fiberUser, ...bridgeUser };
  const fu: KnownUser = {
    ...fiberUser,
    ...bridgeUser,
    ...(!known.userId && actionUser.userId
      ? { userId: actionUser.userId }
      : {}),
    ...(actionUser.viewerFollowing ? { viewerFollowing: true as const } : {}),
    ...(isViewerHandle(handle) ? { viewerIsSelf: true as const } : {}),
  };
  return {
    isProfile: false,
    handle,
    displayName,
    bio: fu.bio ?? "",
    ...avatarSignal(hasDefaultAvatar, fu),
    ...profileFacts(fu),
    // The article's own text is the TRIGGERING comment and nothing else.
    // Copying it into recentTweets[0] as well made the classifier read
    // "two identical texts" as "posts the same thing repeatedly" — a fake
    // repetition signal behind several upheld appeals (2026-09-04 audit,
    // root cause #2). recentTweets is reserved for genuinely separate posts
    // (the profile path collects them).
    recentTweets: [],
    ...(avatarUrl ? { avatarUrl } : {}),
    ...(fu.userId ? { userId: fu.userId } : {}),
    ...(tweetText ? { triggeringComment: tweetText } : {}),
    ...(tweetsTranslated ? { tweetsTranslated: true as const } : {}),
    // Context the classifier's reply-section-vs-own-timeline boundary needs.
    // The scan loop refines isReply / rootAuthorHandle on /status/ pages,
    // where in-conversation replies carry no "Replying to" line.
    surface: pageSurface(),
    ...(replyTo ? { isReply: true, replyToHandle: replyTo } : {}),
    ...(fu.accountCreatedAt ? { accountCreatedAt: fu.accountCreatedAt } : {}),
    ...(fu.accountAgeDays !== undefined ? { accountAgeDays: fu.accountAgeDays } : {}),
    ...(fu.followersCount !== undefined ? { followersCount: fu.followersCount } : {}),
    ...(fu.followingCount !== undefined ? { followingCount: fu.followingCount } : {}),
    ...(fu.viewerFollowing ? { viewerFollowing: true as const } : {}),
    ...(fu.viewerBlocking ? { viewerBlocking: true as const } : {}),
    ...(fu.viewerMuting ? { viewerMuting: true as const } : {}),
    ...(fu.viewerFollowRequestSent ? { viewerFollowRequestSent: true as const } : {}),
    ...(fu.viewerIsSelf ? { viewerIsSelf: true as const } : {}),
  };
}

/** Root tweet text of the current thread (for off-topic relevance). */
export function extractThreadTopic(): string | undefined {
  if (!/^\/[^/]+\/status\/\d+/.test(location.pathname)) return undefined;
  const first = document.querySelector<HTMLElement>(
    'article[data-testid="tweet"] [data-testid="tweetText"]',
  );
  const t = first?.innerText.trim();
  return t ? t.slice(0, 400) : undefined;
}
