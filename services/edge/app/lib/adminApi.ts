// Admin API client. Mirrors the endpoints the legacy console used; the
// ADMIN_TOKEN is tab-scoped: a closed tab must not leave a reusable admin
// credential on disk. Every access also removes the legacy localStorage copy.

const TOKEN_KEY = "xss_admin";

function removeLegacyPersistentToken() {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {}
}

export function getToken(): string {
  removeLegacyPersistentToken();
  try {
    return sessionStorage.getItem(TOKEN_KEY) || "";
  } catch {
    return "";
  }
}
export function setToken(t: string) {
  removeLegacyPersistentToken();
  try {
    sessionStorage.setItem(TOKEN_KEY, t);
  } catch {}
}
export function clearToken() {
  removeLegacyPersistentToken();
  try {
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {}
}

/** Thrown on 403 so callers can drop back to the unlock screen. */
export class AuthError extends Error {}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "x-admin-token": getToken(), ...(init?.headers || {}) },
  });
  if (res.status === 403) {
    clearToken();
    throw new AuthError("forbidden");
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

export interface Account {
  x_user_id?: string;
  handle: string;
  display_name?: string;
  avatar_url?: string;
  verdict_label?: string;
  confidence?: number;
  /** Human/AI-assigned spam category (porn|crypto|gambling|resource|marketing|other). */
  category?: string | null;
  reporters?: number;
  /** How this row entered the queue: 'report'/'block' = a user acted on it
   *  (manual 举报 / X 屏蔽 confirm); 'auto_scan'/'auto_keyword_mention' = the
   *  passive AI/rule pipeline. Drives the 来源 chip so a maintainer can tell a
   *  user report apart from an automated flag. */
  source?: string;
  account_created_at?: string;
  account_age_days?: number;
  followers_count?: number;
  following_count?: number;
  published_at?: number;
  last_scored?: number;
  last_decided_at?: number;
  last_decided_by?: string;
  reasons?: string;
  /** The X post / 发言 that triggered the verdict — shown in review rows so
   *  the content itself can be judged for spam. */
  evidence_text?: string;
  // agent staging fields
  agent_label?: string;
  agent_confidence?: number;
  agent_id?: string;
  agent_at?: number;
  agent_signals?: string;
  agent_reasons?: string;
  agent_evidence?: string;
}

export interface Stats {
  queue: number;
  blacklist: number;
  whitelist: number;
  agent_pending: number;
  agent_blacklist: number;
  agent_whitelist: number;
  reports?: number;
  /** Pending self-service whitelist applications (白名单申请 tab chip). */
  whitelist_requests?: number;
}

export interface Rule {
  id: number;
  pattern: string;
  field: string;
  action: string;
  verdict_label: string;
  /** Spam category stamped onto matched accounts. null = 按判定标签推断。 */
  category?: string | null;
  note?: string;
  enabled: number | boolean;
  hit_count?: number;
  last_hit_at?: number;
}

export interface WhitelistRequest {
  id: number;
  x_user_id?: string | null;
  handle: string;
  gh_age_days?: number | null;
  note?: string | null;
  status: string;
  created_at: number;
  decided_at?: number | null;
  /** Current accounts-table state of the applicant — lets the panel flag
   *  "this handle is already on the public blacklist" before approving. */
  account_status?: string | null;
  account_verdict_label?: string | null;
  account_category?: string | null;
  /** Avatar of the applicant's accounts row, when we have one. */
  avatar_url?: string | null;
}

export interface LogEntry {
  at: number;
  action: string;
  actor?: string;
  handle?: string;
  note?: string;
}

export interface ListResult {
  list: Account[];
  nextBefore: number | null;
  /** Rows matching the filter set — only computed when the request asks (`total=1`). */
  total?: number | null;
  offset?: number;
  appliedFilters?: { sort?: string } & Record<string, unknown>;
}
export interface QueueResult {
  queue: Account[];
  nextBefore: number | null;
  total?: number | null;
  offset?: number;
  appliedFilters?: Record<string, unknown>;
}

export type Item = { handle: string; xUserId?: string };
export type AgentItem = { handle: string; x_user_id?: string };

export const api = {
  stats: () => req<Stats>("/v1/admin/stats"),
  queue: (qs: string) => req<QueueResult>(`/v1/admin/queue${qs}`),
  blacklist: (qs: string) => req<ListResult>(`/v1/admin/blacklist${qs}`),
  whitelist: (qs: string) => req<ListResult>(`/v1/admin/whitelist${qs}`),
  agentList: (qs: string) => req<{ list: Account[]; nextBefore: number | null }>(`/v1/admin/agent-list${qs}`),
  log: (qs: string) => req<{ log: LogEntry[]; nextCursor: number | null }>(`/v1/admin/log${qs}`),
  rules: () => req<{ rules: Rule[] }>("/v1/admin/keyword-rules"),

  decide: (handle: string, xUserId: string | undefined | null, action: string) =>
    req<{ ok: boolean }>("/v1/admin/decide", {
      method: "POST",
      headers: { "content-type": "application/json" },
      // List endpoints return x_user_id: null for accounts without a numeric
      // id; coerce null/"" to undefined so JSON.stringify drops the key
      // (the API's zod schema accepts undefined but rejects null).
      body: JSON.stringify({ handle, xUserId: xUserId || undefined, action }),
    }),
  decideByFilter: (body: {
    /** 'categorize' only stamps the category — status is untouched. */
    action: "approve" | "reject" | "remove" | "whitelist" | "categorize";
    /** Which partition the filters select from (default 'queue'). */
    scope?: "queue" | "blacklist";
    category?: string;
    dryRun?: boolean;
    filters: Record<string, string>;
  }) =>
    req<{
      ok: boolean;
      dryRun?: boolean;
      matched: number;
      processed?: number;
      truncated?: boolean;
      cap?: number;
      error?: string;
    }>("/v1/admin/decide-by-filter", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  decideBatch: (action: string, items: Item[], category?: string) =>
    req<{ ok: boolean; error?: string }>("/v1/admin/decide-batch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, items, category }),
    }),
  categoryBatch: (category: string, items: Item[]) =>
    req<{ ok: boolean; error?: string }>("/v1/admin/category-batch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ category, items }),
    }),
  agentPromote: (handle: string, xUserId: string | undefined, target: string) =>
    req<{ ok: boolean }>("/v1/admin/agent-promote", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(xUserId ? { handle, x_user_id: xUserId, target } : { handle, target }),
    }),
  agentPromoteBatch: (target: string, items: AgentItem[]) =>
    req<{ ok: boolean }>("/v1/admin/agent-promote-batch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target, items }),
    }),
  whitelistAdd: (handle: string, xUserId: string | undefined, note: string) =>
    req<{ ok: boolean; error?: string }>("/v1/admin/whitelist", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ handle, xUserId: xUserId || undefined, note }),
    }),
  whitelistRemove: (handle: string, xUserId?: string) =>
    req<{ ok: boolean }>(
      `/v1/admin/whitelist?handle=${encodeURIComponent(handle)}${xUserId ? `&xUserId=${encodeURIComponent(xUserId)}` : ""}`,
      { method: "DELETE" },
    ),
  whitelistRequests: (status = "pending") =>
    req<{ list: WhitelistRequest[] }>(
      `/v1/admin/whitelist-requests?status=${encodeURIComponent(status)}`,
    ),
  whitelistRequestApprove: (id: number) =>
    req<{ ok: boolean; status?: string }>(`/v1/admin/whitelist-requests/${id}/approve`, {
      method: "POST",
    }),
  whitelistRequestReject: (id: number) =>
    req<{ ok: boolean; status?: string }>(`/v1/admin/whitelist-requests/${id}/reject`, {
      method: "POST",
    }),
  whitelistRemoveBatch: (items: Item[]) =>
    req<{ ok: boolean; error?: string }>("/v1/admin/whitelist-batch", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ items }),
    }),
  ruleCreate: (body: Record<string, string | undefined>) =>
    req<{ ok: boolean; id?: number; error?: string; detail?: string }>("/v1/admin/keyword-rules", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  ruleToggle: (id: number, enabled: boolean) =>
    req<{ ok: boolean }>(`/v1/admin/keyword-rules/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled }),
    }),
  ruleUpdate: (id: number, patch: Record<string, string | null | undefined>) =>
    req<{ ok: boolean; error?: string; detail?: string }>(`/v1/admin/keyword-rules/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    }),
  ruleDelete: (id: number) =>
    req<{ ok: boolean }>(`/v1/admin/keyword-rules/${id}`, { method: "DELETE" }),
  rulesApply: (scope: "queue" | "all" = "queue") =>
    req<{
      ok: boolean;
      matched: number;
      legitMatched?: number;
      legitTruncated?: boolean;
      queueTruncated?: boolean;
      scanned?: { queue: number; legit: number };
      perRule?: { id: number; hits: number }[];
      error?: string;
    }>("/v1/admin/keyword-rules/apply-to-queue", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scope }),
    }),
};

/** Split a Set of "uid|handle" keys into {handle,xUserId} items, chunked at 100. */
export function selToItems(keys: string[]): Item[] {
  return keys.map((k) => {
    const [uid, h] = k.split("|");
    return uid ? { handle: h, xUserId: uid } : { handle: h };
  });
}
export function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}
export const BATCH_CHUNK = 100;
export const rowKey = (a: Account) => `${a.x_user_id || ""}|${a.handle}`;

// Sort vocabulary. Every list tab draws its options from here so the same
// ordering never shows up as "粉丝 多→少" in one tab and "粉丝数 多→少" in the next.
const ACCOUNT_SORT: { value: string; label: string }[] = [
  { value: "created_desc", label: "注册时间 新→旧" },
  { value: "created_asc", label: "注册时间 旧→新" },
  { value: "followers_desc", label: "粉丝数 多→少" },
  { value: "followers_asc", label: "粉丝数 少→多" },
  { value: "following_desc", label: "关注数 多→少" },
  { value: "following_asc", label: "关注数 少→多" },
];
const UPDATED_SORT = { value: "time_desc", label: "更新时间 新→旧" };

/** 黑名单 / 白名单 — decided rows, newest decision first by default. */
export const SORT_OPTIONS: { value: string; label: string }[] = [UPDATED_SORT, ...ACCOUNT_SORT];

/** 待审队列 — adds the triage-only orderings (风险/把握/举报). */
export const QUEUE_SORT_OPTIONS: { value: string; label: string }[] = [
  { value: "severity", label: "风险等级（默认）" },
  { value: "conf_desc", label: "把握 高→低" },
  { value: "conf_asc", label: "把握 低→高" },
  { value: "rep_desc", label: "举报数 多→少" },
  ...ACCOUNT_SORT,
  UPDATED_SORT,
];
