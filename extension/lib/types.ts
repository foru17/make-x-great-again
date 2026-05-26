export type Label = "spam" | "porn_bot" | "likely_spam" | "uncertain" | "legit";

export interface Verdict {
  label: Label;
  confidence: number;
  reasons: string[];
}

export interface CurationRecord {
  userId: string;
  handle: string;
  verdict: Verdict;
  reviewStatus: string;
  model: string;
}

/** Signals scraped passively from the rendered DOM. */
export interface Signals {
  isProfile: boolean;
  userId?: string;
  handle: string;
  displayName: string;
  bio: string;
  hasDefaultAvatar: boolean;
  avatarUrl?: string;
  recentTweets: string[];
  triggeringComment?: string;
  threadTopic?: string;
  accountAgeDays?: number;
  followersCount?: number;
  followingCount?: number;
  viewerFollowing?: boolean;
  viewerBlocking?: boolean;
  viewerMuting?: boolean;
  viewerFollowRequestSent?: boolean;
  viewerIsSelf?: boolean;
}

export type BgRequest =
  | { type: "health" }
  | { type: "records" }
  | { type: "stats" }
  | { type: "whitelist_status" }
  | { type: "whitelist_refresh" }
  | { type: "lookup"; userId: string }
  | { type: "classify"; signals: Omit<Signals, "isProfile"> }
  | { type: "report_spam"; signals: Omit<Signals, "isProfile"> }
  | { type: "confirm_spam"; signals: Omit<Signals, "isProfile"> }
  | { type: "gh_start" }
  | { type: "gh_poll"; deviceCode: string }
  | { type: "gh_status" }
  | { type: "gh_logout" };

export interface BgResponse {
  ok: boolean;
  data?: unknown;
  error?: string;
}
