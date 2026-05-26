export interface GraphqlUserSnapshot {
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

export interface KnownUser {
  bio?: string;
  userId?: string;
  followersCount?: number;
  followingCount?: number;
  accountAgeDays?: number;
  displayName?: string;
  avatarUrl?: string;
  viewerFollowing?: true;
  viewerBlocking?: true;
  viewerMuting?: true;
  viewerFollowRequestSent?: true;
  viewerIsSelf?: true;
}

const graphqlUserCache = new Map<string, KnownUser>();

function normalizeHandle(handle: string | undefined): string | undefined {
  return handle?.trim().replace(/^@+/, "").toLowerCase() || undefined;
}

function numericId(v: unknown): string | undefined {
  return typeof v === "string" && /^\d+$/.test(v) ? v : undefined;
}

export function ingestGraphqlUsers(users: GraphqlUserSnapshot[]): boolean {
  let changed = false;
  for (const user of users) {
    const handle = normalizeHandle(user.handle);
    const userId = numericId(user.userId);
    if (!handle || !userId) continue;
    const created = user.createdAt ? Date.parse(user.createdAt) : NaN;
    const next: KnownUser = {
      userId,
      ...(user.bio !== undefined ? { bio: user.bio } : {}),
      ...(user.followersCount !== undefined ? { followersCount: user.followersCount } : {}),
      ...(user.followingCount !== undefined ? { followingCount: user.followingCount } : {}),
      ...(user.displayName ? { displayName: user.displayName } : {}),
      ...(user.avatarUrl ? { avatarUrl: user.avatarUrl } : {}),
      ...(user.viewerFollowing ? { viewerFollowing: true as const } : {}),
      ...(user.viewerBlocking ? { viewerBlocking: true as const } : {}),
      ...(user.viewerMuting ? { viewerMuting: true as const } : {}),
      ...(user.viewerFollowRequestSent ? { viewerFollowRequestSent: true as const } : {}),
      ...(Number.isNaN(created)
        ? {}
        : { accountAgeDays: Math.max(0, Math.round((Date.now() - created) / 86_400_000)) }),
    };
    const prev = graphqlUserCache.get(handle);
    if (JSON.stringify(prev) !== JSON.stringify(next)) {
      graphqlUserCache.set(handle, next);
      changed = true;
    }
  }
  return changed;
}

export function readGraphqlUser(handle: string | undefined): KnownUser {
  const key = normalizeHandle(handle);
  return key ? (graphqlUserCache.get(key) ?? {}) : {};
}
