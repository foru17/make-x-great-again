interface GraphqlUserSnapshot {
  handle: string;
  userId: string;
  bio?: string;
  displayName?: string;
  avatarUrl?: string;
  followersCount?: number;
  followingCount?: number;
  createdAt?: string;
  viewerFollowing?: boolean;
  viewerBlocking?: boolean;
  viewerMuting?: boolean;
  viewerFollowRequestSent?: boolean;
}

const GRAPHQL_USER_EVENT = "mxga:x-users";
const GRAPHQL_URL_RE = /\/i\/api\/graphql\/[^/]+\/[^/?#]+/;
const NUMERIC_ID_RE = /^\d+$/;

function numericId(v: unknown): string | undefined {
  return typeof v === "string" && NUMERIC_ID_RE.test(v) ? v : undefined;
}

function text(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function number(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function trueFlag(v: unknown): true | undefined {
  return v === true ? true : undefined;
}

function object(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : undefined;
}

function collectUsers(payload: unknown): GraphqlUserSnapshot[] {
  const out = new Map<string, GraphqlUserSnapshot>();
  const seen = new WeakSet<object>();
  const budget = { n: 12000 };

  function walk(value: unknown, depth: number) {
    const o = object(value);
    if (!o || depth > 28 || budget.n-- <= 0) return;
    if (seen.has(o)) return;
    seen.add(o);

    if (o.__typename === "User") {
      const legacy = object(o.legacy) ?? {};
      const core = object(o.core) ?? {};
      const avatar = object(o.avatar) ?? {};
      const relationship = object(o.relationship_perspectives) ?? {};
      const restId = numericId(o.rest_id);
      const legacyId = numericId(legacy.id_str);
      const userId = legacyId ?? restId;
      const handle = text(legacy.screen_name) ?? text(core.screen_name);
      if (userId && restId && legacyId && restId !== legacyId) return;
      if (userId && handle) {
        out.set(handle.toLowerCase(), {
          handle,
          userId,
          ...(text(legacy.description) !== undefined ? { bio: text(legacy.description) } : {}),
          ...(text(legacy.name) ?? text(core.name) ? { displayName: text(legacy.name) ?? text(core.name) } : {}),
          ...(text(legacy.profile_image_url_https) ?? text(avatar.image_url)
            ? { avatarUrl: text(legacy.profile_image_url_https) ?? text(avatar.image_url) }
            : {}),
          ...(number(legacy.followers_count) !== undefined
            ? { followersCount: number(legacy.followers_count) }
            : {}),
          ...(number(legacy.friends_count) !== undefined
            ? { followingCount: number(legacy.friends_count) }
            : {}),
          ...(text(legacy.created_at) ?? text(core.created_at)
            ? { createdAt: text(legacy.created_at) ?? text(core.created_at) }
            : {}),
          ...(trueFlag(legacy.following) ?? trueFlag(relationship.following)
            ? { viewerFollowing: true }
            : {}),
          ...(trueFlag(legacy.blocking) ?? trueFlag(relationship.blocking)
            ? { viewerBlocking: true }
            : {}),
          ...(trueFlag(legacy.muting) ?? trueFlag(relationship.muting)
            ? { viewerMuting: true }
            : {}),
          ...(trueFlag(legacy.follow_request_sent) ?? trueFlag(relationship.follow_request_sent)
            ? { viewerFollowRequestSent: true }
            : {}),
        });
      }
    }

    for (const child of Object.values(o)) walk(child, depth + 1);
  }

  walk(payload, 0);
  return [...out.values()];
}

function emitUsers(payload: unknown) {
  const users = collectUsers(payload);
  if (!users.length) return;
  window.dispatchEvent(
    new CustomEvent(GRAPHQL_USER_EVENT, {
      detail: JSON.stringify({ users: users.slice(0, 200) }),
    }),
  );
}

function shouldInspectUrl(url: unknown): boolean {
  return typeof url === "string" && GRAPHQL_URL_RE.test(url);
}

export default defineContentScript({
  matches: ["https://x.com/*", "https://twitter.com/*"],
  runAt: "document_start",
  world: "MAIN",
  main() {
    const originalFetch = window.fetch;
    window.fetch = async (...args) => {
      const response = await originalFetch(...args);
      const url =
        args[0] instanceof Request
          ? args[0].url
          : typeof args[0] === "string"
            ? args[0]
            : response.url;
      if (shouldInspectUrl(url)) {
        void response
          .clone()
          .json()
          .then(emitUsers)
          .catch(() => {});
      }
      return response;
    };

    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function open(
      method: string,
      url: string | URL,
      async?: boolean,
      username?: string | null,
      password?: string | null,
    ) {
      this.__mxgaGraphqlUrl = shouldInspectUrl(url) ? String(url) : undefined;
      const openFn = originalOpen as unknown as (...args: unknown[]) => void;
      if (async === undefined) return openFn.call(this, method, url);
      return openFn.call(this, method, url, async, username, password);
    };
    XMLHttpRequest.prototype.send = function send(body?: Document | XMLHttpRequestBodyInit | null) {
      if (this.__mxgaGraphqlUrl) {
        this.addEventListener("loadend", () => {
          try {
            if (typeof this.responseText === "string") emitUsers(JSON.parse(this.responseText));
          } catch {
            /* ignore non-JSON / opaque responses */
          }
        });
      }
      return originalSend.call(this, body);
    };
  },
});

declare global {
  interface XMLHttpRequest {
    __mxgaGraphqlUrl?: string;
  }
}
