// Passive DOM extraction + cheap local heuristic. Ported to TS from the MVP
// content script. Reads only what X already rendered — no scraping, no
// navigation, no extra requests to X.
import type { Signals } from "./types";
import { type KnownUser, ingestGraphqlUsers, readGraphqlUser } from "./graphql-users";

export { ingestGraphqlUsers } from "./graphql-users";

// Conservative Chinese porn-bot vocabulary. Kept SMALL on purpose — we
// don't want to play whack-a-mole with bot copy variants. The LLM is what
// classifies; this regex only decides "is it worth a token". Spam template
// SHAPE (short CJK reply + @mention + emoji|innuendo) is captured by a
// separate structural rule below, which catches new template variants
// without needing dictionary growth.
const PROMO_RE =
  /(约见|约炮|附近|同城|牵线|线下|对接|资源|上车|看我主页|入驻|女主播|安全可靠|大号|解锁|福利|楼凤|一夜|加微|私聊|私信|包养|外围|18\+|🔞|🍑|💋|💦|👇|👉)/;
const LINK_RE =
  /(https?:\/\/|\b[\w-]+\.(top|xyz|vip|club|icu|cn|cc|live|link|shop)\b|t\.co\/)/i;
const RANDOM_HANDLE_RE = /^[a-z]{2,}\d{4,}$|^[A-Za-z]+[A-Z][a-z]+\d{4,}$|^[a-z]{1,3}\d{4,}$/;

// "Redirect bait" structural template. Pattern: a short Chinese reply that
// mostly exists to @-mention a dispatcher account plus emoji garnish. We
// don't need linguistics to spot it — the SHAPE is the giveaway:
//   < 80 chars, contains @\w+ mention, contains emoji, contains CJK.
// Strong signal that this is a porn/spam amplifier even when the words
// don't match PROMO_RE. False positives are fine: just means an extra LLM
// call to ratify, never a wrong verdict.
const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F1E6}-\u{1F1FF}]/u;
const HAS_CJK_RE = /[一-鿿]/;
const HAS_MENTION_RE = /@[A-Za-z0-9_]{2,15}/;

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
  accountAgeDays?: number;
  viewerFollowing?: true;
  viewerBlocking?: true;
  viewerMuting?: true;
  viewerFollowRequestSent?: true;
  viewerIsSelf?: true;
}

function viewerHandle(): string | undefined {
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
          const created = legacy.created_at
            ? Date.parse(legacy.created_at)
            : NaN;
          const userId = fiberUserId(u, legacy);
          const accountAgeDays = Number.isNaN(created)
            ? undefined
            : Math.max(0, Math.round((Date.now() - created) / 86_400_000));
          return {
            bio: typeof legacy.description === "string" ? legacy.description : "",
            ...(userId ? { userId } : {}),
            followersCount: legacy.followers_count,
            followingCount: legacy.friends_count,
            ...(accountAgeDays !== undefined ? { accountAgeDays } : {}),
            ...(trueFlag(legacy.following) ? { viewerFollowing: true as const } : {}),
            ...(trueFlag(legacy.blocking) ? { viewerBlocking: true as const } : {}),
            ...(trueFlag(legacy.muting) ? { viewerMuting: true as const } : {}),
            ...(trueFlag(legacy.follow_request_sent)
              ? { viewerFollowRequestSent: true as const }
              : {}),
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
      screenName: legacy?.screen_name,
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
    if (
      o.__typename === "User" &&
      legacy &&
      typeof legacy === "object" &&
      typeof legacy.description === "string" &&
      ("followers_count" in legacy || "screen_name" in legacy)
    ) {
      const screenName = normalizeHandle(legacy.screen_name);
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
  const networkUser = readGraphqlUser(handle);
  const actionUser = actionUserInfo(profileScope, handle);
  const fu: KnownUser = {
    ...readFiberUser(profileScope, handle),
    ...networkUser,
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
    handle,
    displayName,
    bio: bioEl ? bioEl.innerText.trim() : "",
    hasDefaultAvatar,
    recentTweets: [],
    ...(avatarUrl ? { avatarUrl } : {}),
    ...(userId ? { userId } : {}),
    ...(fu.viewerFollowing ? { viewerFollowing: true as const } : {}),
    ...(fu.viewerBlocking ? { viewerBlocking: true as const } : {}),
    ...(fu.viewerMuting ? { viewerMuting: true as const } : {}),
    ...(fu.viewerFollowRequestSent ? { viewerFollowRequestSent: true as const } : {}),
    ...(fu.viewerIsSelf ? { viewerIsSelf: true as const } : {}),
    ...(parseJoinDate(joinEl?.innerText) !== undefined
      ? { accountAgeDays: parseJoinDate(joinEl?.innerText) }
      : {}),
    ...(followers !== undefined ? { followersCount: followers } : {}),
    ...(following !== undefined ? { followingCount: following } : {}),
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
  // Prefer identities from X's own GraphQL responses; fall back to React
  // fiber when the network cache has not seen this author yet.
  const networkUser = readGraphqlUser(handle);
  const fiberUser = readFiberUser(article, handle);
  const actionUser = actionUserInfo(article, handle);
  const fu: KnownUser = {
    ...fiberUser,
    ...networkUser,
    ...(!fiberUser.userId && !networkUser.userId && actionUser.userId
      ? { userId: actionUser.userId }
      : {}),
    ...(actionUser.viewerFollowing ? { viewerFollowing: true as const } : {}),
    ...(isViewerHandle(handle) ? { viewerIsSelf: true as const } : {}),
  };
  return {
    isProfile: false,
    handle,
    displayName: networkUser.displayName ?? displayName,
    bio: fu.bio ?? "",
    hasDefaultAvatar,
    recentTweets: tweetText ? [tweetText] : [],
    ...(networkUser.avatarUrl ?? avatarUrl ? { avatarUrl: networkUser.avatarUrl ?? avatarUrl } : {}),
    ...(fu.userId ? { userId: fu.userId } : {}),
    ...(tweetText ? { triggeringComment: tweetText } : {}),
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

export interface Heuristic {
  score: number;
  why: string[];
}

/** Cheap & local. Decides WHETHER to spend an LLM call — never the verdict. */
export function heuristic(s: Signals): Heuristic {
  let score = 0;
  const why: string[] = [];
  const blob = `${s.displayName} ${s.bio} ${s.recentTweets.join(" ")}`;

  // Redirect-bait structural pattern, scored first so its outcome can gate
  // the age-discount below. A short CJK reply whose payload is really just
  // an @-mention to a dispatcher account (e.g. "x2,比她好看的没她骚q比她骚的
  // 没她好看 @Xinxinxiaogou04 🍄🌳" or ")推特 @dadi2412 第一骚+yo"). Either
  // an emoji garnish OR a single-character innuendo (骚/涩/约/sao) qualifies.
  // Scoped to recentTweets (the current reply only) so legit profile bios
  // with @-mentions aren't penalized.
  const t = s.recentTweets[0] ?? "";
  const INNUENDO_RE = /[骚涩约]|sao/i;
  const shapeMatch =
    !!t &&
    t.length < 80 &&
    HAS_CJK_RE.test(t) &&
    HAS_MENTION_RE.test(t) &&
    (EMOJI_RE.test(t) || INNUENDO_RE.test(t));
  if (shapeMatch) {
    score += 0.4;
    why.push("导流模板：短中文回复 + @mention + (emoji|性暗示)");
  }

  if (s.hasDefaultAvatar) {
    score += 0.35;
    why.push("默认头像");
  }
  // Account age is a SOFT prior, not a veto. When the structural redirect-
  // bait shape has already fired (above), the bait IS the spam — registration
  // date is irrelevant; hijacked / aged-up bot accounts are common. So we
  // only apply the old-account discount in the absence of shapeMatch.
  if (typeof s.accountAgeDays === "number") {
    if (s.accountAgeDays < 30) {
      score += 0.4;
      why.push("新注册账号(<30天)");
    } else if (s.accountAgeDays < 90) {
      score += 0.25;
      why.push("较新账号(<90天)");
    } else if (s.accountAgeDays > 730 && !shapeMatch) {
      score -= 0.25;
      why.push("老账号(>2年)");
    }
  }
  if (typeof s.followersCount === "number" && s.followersCount <= 5) {
    score += 0.2;
    why.push("几乎无粉丝");
  }
  if (PROMO_RE.test(blob)) {
    score += 0.35;
    why.push("导流/性广告话术");
  }
  if (LINK_RE.test(blob)) {
    score += 0.2;
    why.push("外链/可疑域名");
  }
  if (RANDOM_HANDLE_RE.test(s.handle)) {
    score += 0.15;
    why.push("机器生成式 handle");
  }
  return { score: Math.max(0, Math.min(1, score)), why };
}

export const AUTO_THRESHOLD = 0.5;
